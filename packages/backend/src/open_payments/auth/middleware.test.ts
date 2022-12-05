import { faker } from '@faker-js/faker'
import { v4 as uuid } from 'uuid'

import { createAuthMiddleware } from './middleware'
import { AccessType, AccessAction } from './grant'
import { AuthService } from './service'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { Body, RequestMethod } from 'node-mocks-http'
import { HttpMethod } from 'openapi'
import { createTestApp, TestContainer } from '../../tests/app'
import { createPaymentPointer } from '../../tests/paymentPointer'
import { truncateTables } from '../../tests/tableManager'
import { setup, SetupOptions } from '../payment_pointer/model.test'
import { HttpSigContext, JWKWithRequired, TokenInfo } from 'auth'
import { generateTestKeys, generateSigHeaders } from 'auth/src/tests/signature'

type AppMiddleware = (
  ctx: HttpSigContext,
  next: () => Promise<void>
) => Promise<void>

describe('Auth Middleware', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let middleware: AppMiddleware
  let authService: AuthService
  let ctx: HttpSigContext
  let next: jest.MockedFunction<() => Promise<void>>
  const token = 'OS9M2PMHKUR64TB8N6BW7OZB8CDFONP219RP1LT0'
  let generatedKeyPair: {
    keyId: string
    publicKey: JWKWithRequired
    privateKey: JWKWithRequired
  }
  let requestPath: string
  let requestAuthorization: string
  let requestBody: Body
  let requestUrl: string
  let requestMethod: RequestMethod
  let requestSignatureHeaders: {
    sigInput: string
    signature: string
    contentDigest?: string
  }
  let requestJwk: JWKWithRequired

  function setupHttpSigContext(options: SetupOptions): HttpSigContext {
    const context = setup(options)
    if (
      !context.headers['signature'] ||
      !context.request.headers['signature']
    ) {
      throw new Error('missing signature header')
    }
    if (
      !context.headers['signature-input'] ||
      !context.request.headers['signature-input']
    ) {
      throw new Error('missing signature-input header')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return context as any
  }

  const createTokenInfo = (access?: TokenInfo['access']): TokenInfo => ({
    active: true,
    grant: uuid(),
    client: faker.internet.url(),
    access: access ?? [
      {
        type: AccessType.IncomingPayment,
        actions: [AccessAction.Read]
      }
    ]
  })
  async function prepareTest(includeBody: boolean) {
    requestSignatureHeaders = await generateSigHeaders({
      privateKey: generatedKeyPair.privateKey,
      keyId: generatedKeyPair.keyId,
      url: requestUrl,
      method: requestMethod,
      optionalComponents: {
        body: includeBody ? requestBody : undefined,
        authorization: requestAuthorization
      }
    })
    requestJwk = generatedKeyPair.publicKey

    ctx = setupHttpSigContext({
      reqOpts: {
        headers: {
          Accept: 'application/json',
          Authorization: `GNAP ${token}`,
          Signature: `sig1=:${requestSignatureHeaders.signature}:`,
          'Signature-Input': requestSignatureHeaders.sigInput,
          'Content-Digest': includeBody
            ? requestSignatureHeaders.contentDigest
            : undefined,
          'Content-Length': includeBody
            ? JSON.stringify(requestBody).length.toString()
            : undefined
        },
        method: requestMethod,
        body: includeBody ? requestBody : undefined,
        url: requestUrl
      },
      paymentPointer: await createPaymentPointer(deps)
    })
    ctx.container = deps
    next = jest.fn()
  }

  beforeAll(async (): Promise<void> => {
    deps = await initIocContainer(Config)
    appContainer = await createTestApp(deps)
    middleware = createAuthMiddleware({
      type: AccessType.IncomingPayment,
      action: AccessAction.Read
    })
    authService = await deps.use('authService')
    generatedKeyPair = await generateTestKeys()
    requestMethod = HttpMethod.POST.toUpperCase() as RequestMethod
    requestBody = {
      access_token: token
    }
    requestAuthorization = `GNAP ${token}`
    requestUrl = Config.authServerGrantUrl + requestPath //'http://127.0.0.1:3006/introspect'
  })

  beforeEach(async (): Promise<void> => {
    await prepareTest(true)
  })

  afterAll(async (): Promise<void> => {
    await truncateTables(await deps.use('knex'))
    await appContainer.shutdown()
  })

  test.each`
    authorization             | description
    ${undefined}              | ${'missing'}
    ${'Bearer NOT-GNAP'}      | ${'invalid'}
    ${'GNAP'}                 | ${'missing'}
    ${'GNAP multiple tokens'} | ${'invalid'}
  `(
    'returns 401 for $description access token',
    async ({ authorization }): Promise<void> => {
      ctx.request.headers.authorization = authorization
      await expect(middleware(ctx, next)).resolves.toBeUndefined()
      expect(ctx.status).toBe(401)
      expect(ctx.message).toEqual('Unauthorized')
      expect(ctx.response.get('WWW-Authenticate')).toBe(
        `GNAP as_uri=${Config.authServerGrantUrl}`
      )
      expect(next).not.toHaveBeenCalled()
    }
  )

  test('returns 401 for unsuccessful token introspection', async (): Promise<void> => {
    const introspectSpy = jest
      .spyOn(authService, 'introspect')
      .mockResolvedValueOnce(undefined)
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(introspectSpy).toHaveBeenCalledWith(token)
    expect(ctx.status).toBe(401)
    expect(ctx.message).toEqual('Invalid Token')
    expect(ctx.response.get('WWW-Authenticate')).toBe(
      `GNAP as_uri=${Config.authServerGrantUrl}`
    )
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 403 for unauthorized request', async (): Promise<void> => {
    const tokenInfo = createTokenInfo([
      {
        type: AccessType.OutgoingPayment,
        actions: [AccessAction.Create],
        identifier: ctx.paymentPointer.url
      }
    ])
    const introspectSpy = jest
      .spyOn(authService, 'introspect')
      .mockResolvedValueOnce(tokenInfo)
    await expect(middleware(ctx, next)).rejects.toMatchObject({
      status: 403,
      message: 'Insufficient Grant'
    })
    expect(introspectSpy).toHaveBeenCalledWith(token)
    expect(next).not.toHaveBeenCalled()
  })

  test.each`
    limitAccount
    ${false}
    ${true}
  `(
    'sets the context grant and calls next (limitAccount: $limitAccount)',
    async ({ limitAccount }): Promise<void> => {
      const limits = {
        receiveAmount: {
          value: BigInt(500),
          assetCode: 'EUR',
          assetScale: 2
        },
        sendAmount: {
          value: BigInt(811),
          assetCode: 'USD',
          assetScale: 2
        },
        receiver:
          'https://wallet2.example/bob/incoming-payments/aa9da466-12ba-4760-9aa0-8c06061f333b'
      }
      const tokenInfo = createTokenInfo([
        {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Read],
          identifier: limitAccount ? ctx.paymentPointer.url : undefined
        },
        {
          type: AccessType.OutgoingPayment,
          actions: [AccessAction.Create, AccessAction.Read],
          identifier: ctx.paymentPointer.url,
          interval: 'R/2022-03-01T13:00:00Z/P1M',
          limits
        }
      ])
      const next = jest.fn()
      const introspectSpy = jest
        .spyOn(authService, 'introspect')
        .mockResolvedValueOnce(tokenInfo)
      await expect(middleware(ctx, next)).resolves.toBeUndefined()
      expect(introspectSpy).toHaveBeenCalledWith(token)
      expect(next).toHaveBeenCalled()
      expect(ctx.client).toEqual(tokenInfo.client)
      expect(ctx.grant).toEqual({
        id: tokenInfo.grant,
        limits
      })
    }
  )

  test('bypasses token introspection for configured DEV_ACCESS_TOKEN', async (): Promise<void> => {
    ctx.headers.authorization = `GNAP ${Config.devAccessToken}`
    const introspectSpy = jest.spyOn(authService, 'introspect')
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(introspectSpy).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  test('returns 200 with valid http signature without body', async (): Promise<void> => {
    await prepareTest(false)
    const tokenInfo = createTokenInfo([
      {
        type: AccessType.IncomingPayment,
        actions: [AccessAction.Read],
        identifier: ctx.paymentPointer.url
      }
    ])
    const introspectSpy = jest
      .spyOn(authService, 'introspect')
      .mockResolvedValueOnce(tokenInfo)
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(introspectSpy).toHaveBeenCalledWith(token)
    expect(next).toHaveBeenCalled()
    expect(ctx.client).toEqual(tokenInfo.client)
    expect(ctx.grant).toEqual({
      id: tokenInfo.grant
    })
  })

  test('returns 200 with valid http signature with body', async (): Promise<void> => {
    const tokenInfo = createTokenInfo([
      {
        type: AccessType.IncomingPayment,
        actions: [AccessAction.Read],
        identifier: ctx.paymentPointer.url
      }
    ])
    const introspectSpy = jest
      .spyOn(authService, 'introspect')
      .mockResolvedValueOnce(tokenInfo)
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(introspectSpy).toHaveBeenCalledWith(token)
    expect(next).toHaveBeenCalled()
    expect(ctx.client).toEqual(tokenInfo.client)
    expect(ctx.grant).toEqual({
      id: tokenInfo.grant
    })
  })

  test('returns 401 for invalid http signature without body', async (): Promise<void> => {
    ctx = setupHttpSigContext({
      reqOpts: {
        headers: {
          Accept: 'application/json',
          Authorization: `GNAP ${token}`,
          Signature: 'aaaaaaaaaa=',
          'Signature-Input': requestSignatureHeaders.sigInput
        },
        method: requestMethod,
        url: requestUrl
      },
      paymentPointer: await createPaymentPointer(deps)
    })
    ctx.container = deps
    const tokenInfo = createTokenInfo([
      {
        type: AccessType.IncomingPayment,
        actions: [AccessAction.Read],
        identifier: ctx.paymentPointer.url
      }
    ])
    const introspectSpy = jest
      .spyOn(authService, 'introspect')
      .mockResolvedValueOnce(tokenInfo)
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(introspectSpy).toHaveBeenCalledWith(token)
    expect(ctx.headers.signature).toBe('aaaaaaaaaa=')
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 401 for invalid http signature with body', async (): Promise<void> => {
    ctx = setupHttpSigContext({
      reqOpts: {
        headers: {
          Accept: 'application/json',
          Authorization: `GNAP ${token}`,
          Signature: 'aaaaaaaaaa=',
          'Signature-Input': requestSignatureHeaders.sigInput,
          'Content-Digest': requestSignatureHeaders.contentDigest,
          'Content-Length': JSON.stringify(requestBody).length.toString()
        },
        method: requestMethod,
        body: requestBody,
        url: requestUrl
      },
      paymentPointer: await createPaymentPointer(deps)
    })
    ctx.container = deps
    const tokenInfo = createTokenInfo([
      {
        type: AccessType.IncomingPayment,
        actions: [AccessAction.Read],
        identifier: ctx.paymentPointer.url
      }
    ])
    const introspectSpy = jest
      .spyOn(authService, 'introspect')
      .mockResolvedValueOnce(tokenInfo)
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(introspectSpy).toHaveBeenCalledWith(token)
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  // test client.paymentPointer.getKeys
  // test('returns 401 for invalid key type without body', async (): Promise<void> => {
  //   await prepareTest(false)
  //   // mockKeyInfo.jwk.kty = 'EC'
  //   const grant = mockGrant({
  //     access: [
  //       {
  //         type: AccessType.IncomingPayment,
  //         actions: [AccessAction.Read],
  //         identifier: ctx.paymentPointer.url
  //       }
  //     ]
  //   })
  //   const scope = mockAuthServer(grant.toTokenInfo())
  //   await expect(middleware(ctx, next)).resolves.toBeUndefined()
  //   expect(ctx.status).toBe(401)
  //   expect(next).not.toHaveBeenCalled()
  //   scope.done()
  // })

  // test('returns 401 for invalid key type with body', async (): Promise<void> => {
  //   // mockKeyInfo.jwk.kty = 'EC'
  //   const grant = mockGrant({
  //     access: [
  //       {
  //         type: AccessType.IncomingPayment,
  //         actions: [AccessAction.Read],
  //         identifier: ctx.paymentPointer.url
  //       }
  //     ]
  //   })
  //   const scope = mockAuthServer(grant.toTokenInfo())
  //   await expect(middleware(ctx, next)).resolves.toBeUndefined()
  //   expect(ctx.status).toBe(401)
  //   expect(next).not.toHaveBeenCalled()
  //   scope.done()
  // })

  test('returns 401 if any signature keyid does not match the jwk key id without body', async (): Promise<void> => {
    await prepareTest(false)
    const tokenInfo = createTokenInfo([
      {
        type: AccessType.IncomingPayment,
        actions: [AccessAction.Read],
        identifier: ctx.paymentPointer.url
      }
    ])
    const introspectSpy = jest
      .spyOn(authService, 'introspect')
      .mockResolvedValueOnce(tokenInfo)
    ctx.request.headers['signature-input'] = ctx.request.headers[
      'signature-input'
    ].replace('gnap-key', 'mismatched-key')
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(introspectSpy).toHaveBeenCalledWith(token)
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('returns 401 if any signature keyid does not match the jwk key id with body', async (): Promise<void> => {
    const tokenInfo = createTokenInfo([
      {
        type: AccessType.IncomingPayment,
        actions: [AccessAction.Read],
        identifier: ctx.paymentPointer.url
      }
    ])
    const introspectSpy = jest
      .spyOn(authService, 'introspect')
      .mockResolvedValueOnce(tokenInfo)
    ctx.request.headers['signature-input'] = ctx.request.headers[
      'signature-input'
    ].replace('gnap-key', 'mismatched-key')
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(introspectSpy).toHaveBeenCalledWith(token)
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  // should this be in its own middleware?
  test('returns 401 if content-digest does not match the body', async (): Promise<void> => {
    ctx = setupHttpSigContext({
      reqOpts: {
        headers: {
          Accept: 'application/json',
          Authorization: `GNAP ${token}`,
          Signature: `sig1=:${requestSignatureHeaders.signature}:`,
          'Signature-Input': requestSignatureHeaders.sigInput,
          'Content-Digest': 'aaaaaaaaaa=',
          'Content-Length': JSON.stringify(requestBody).length.toString()
        },
        method: requestMethod,
        body: requestBody,
        url: requestUrl
      },
      paymentPointer: await createPaymentPointer(deps)
    })
    ctx.container = deps
    const tokenInfo = createTokenInfo([
      {
        type: AccessType.IncomingPayment,
        actions: [AccessAction.Read],
        identifier: ctx.paymentPointer.url
      }
    ])
    const introspectSpy = jest
      .spyOn(authService, 'introspect')
      .mockResolvedValueOnce(tokenInfo)
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(introspectSpy).toHaveBeenCalledWith(token)
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
