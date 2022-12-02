import nock, { Definition } from 'nock'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'

import { createAuthMiddleware } from './middleware'
import { AccessType, AccessAction } from './grant'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { Body, RequestMethod } from 'node-mocks-http'
import { HttpMethod, RequestValidator } from 'openapi'
import { createTestApp, TestContainer } from '../../tests/app'
import { mockGrant } from '../../tests/grant'
import { createPaymentPointer } from '../../tests/paymentPointer'
import { truncateTables } from '../../tests/tableManager'
import { setup, SetupOptions } from '../payment_pointer/model.test'
import { HttpSigContext, JWKWithRequired, TokenInfo } from 'auth'
import { generateTestKeys, generateSigHeaders } from 'auth/src/tests/signature'

type AppMiddleware = (
  ctx: HttpSigContext,
  next: () => Promise<void>
) => Promise<void>

type IntrospectionBody = {
  access_token: string
  resource_server: string
}

describe('Auth Middleware', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let authServerIntrospectionUrl: URL
  let middleware: AppMiddleware
  let ctx: HttpSigContext
  let next: jest.MockedFunction<() => Promise<void>>
  let validateRequest: RequestValidator<IntrospectionBody>
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
    authServerIntrospectionUrl = new URL(Config.authServerIntrospectionUrl)
    middleware = createAuthMiddleware({
      type: AccessType.IncomingPayment,
      action: AccessAction.Read
    })
    const { authServerSpec } = await deps.use('openApi')
    requestPath = '/introspect'
    validateRequest = authServerSpec.createRequestValidator({
      path: requestPath,
      method: HttpMethod.POST
    })
    generatedKeyPair = await generateTestKeys()
    requestMethod = HttpMethod.POST.toUpperCase() as RequestMethod
    requestBody = {
      access_token: token,
      proof: 'httpsig',
      resource_server: 'test'
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

  function mockAuthServer(
    grant: TokenInfo | undefined = undefined
  ): nock.Scope {
    return nock(authServerIntrospectionUrl.origin)
      .post(
        authServerIntrospectionUrl.pathname,
        function (this: Definition, body) {
          validateRequest({
            ...this,
            body
          })
          expect(body.access_token).toEqual(token)
          return true
        }
      )
      .reply(grant ? 200 : 404, grant)
  }

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

  const inactiveGrant = {
    active: false,
    grant: uuid()
  }

  test.each`
    grant            | description
    ${undefined}     | ${'unknown token/grant'}
    ${'bad grant'}   | ${'invalid grant'}
    ${inactiveGrant} | ${'inactive grant'}
  `('Returns 401 for $description', async ({ grant }): Promise<void> => {
    const scope = mockAuthServer(grant)
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(ctx.message).toEqual('Invalid Token')
    expect(ctx.response.get('WWW-Authenticate')).toBe(
      `GNAP as_uri=${Config.authServerGrantUrl}`
    )
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

  test('returns 403 for unauthorized request', async (): Promise<void> => {
    const scope = mockAuthServer(
      mockGrant({
        access: [
          {
            type: AccessType.OutgoingPayment,
            actions: [AccessAction.Create],
            identifier: ctx.paymentPointer.url
          }
        ]
      }).toTokenInfo
    )
    await expect(middleware(ctx, next)).rejects.toMatchObject({
      status: 403,
      message: 'Insufficient Grant'
    })
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

  test.each`
    limitAccount
    ${false}
    ${true}
  `(
    'sets the context grant and calls next (limitAccount: $limitAccount)',
    async ({ limitAccount }): Promise<void> => {
      const grant = mockGrant({
        access: [
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
            limits: {
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
          }
        ]
      })
      const scope = mockAuthServer(grant.toTokenInfo())
      const next = jest.fn()
      await expect(middleware(ctx, next)).resolves.toBeUndefined()
      expect(next).toHaveBeenCalled()
      expect(ctx.grant).toEqual(grant)
      scope.done()
    }
  )

  test('bypasses token introspection for configured DEV_ACCESS_TOKEN', async (): Promise<void> => {
    ctx.headers.authorization = `GNAP ${Config.devAccessToken}`
    const authService = await deps.use('authService')
    const introspectSpy = jest.spyOn(authService, 'introspect')
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(introspectSpy).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  test('returns 200 with valid http signature without body', async (): Promise<void> => {
    await prepareTest(false)
    const grant = mockGrant({
      access: [
        {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Read],
          identifier: ctx.paymentPointer.url
        }
      ]
    })
    const scope = mockAuthServer(grant.toTokenInfo())
    await expect(middleware(ctx, next)).resolves.not.toThrow()
    expect(next).toHaveBeenCalled()
    scope.done()
  })

  test('returns 200 with valid http signature with body', async (): Promise<void> => {
    const grant = mockGrant({
      access: [
        {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Read],
          identifier: ctx.paymentPointer.url
        }
      ]
    })
    const scope = mockAuthServer(grant.toTokenInfo())
    await expect(middleware(ctx, next)).resolves.not.toThrow()
    expect(next).toHaveBeenCalled()
    scope.done()
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
    const grant = mockGrant({
      access: [
        {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Read],
          identifier: ctx.paymentPointer.url
        }
      ]
    })
    const scope = mockAuthServer(grant.toTokenInfo())
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.headers.signature).toBe('aaaaaaaaaa=')
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
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
    const grant = mockGrant({
      access: [
        {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Read],
          identifier: ctx.paymentPointer.url
        }
      ]
    })
    const scope = mockAuthServer(grant.toTokenInfo())
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

  test('returns 401 for invalid key type without body', async (): Promise<void> => {
    await prepareTest(false)
    // mockKeyInfo.jwk.kty = 'EC'
    const grant = mockGrant({
      access: [
        {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Read],
          identifier: ctx.paymentPointer.url
        }
      ]
    })
    const scope = mockAuthServer(grant.toTokenInfo())
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

  test('returns 401 for invalid key type with body', async (): Promise<void> => {
    // mockKeyInfo.jwk.kty = 'EC'
    const grant = mockGrant({
      access: [
        {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Read],
          identifier: ctx.paymentPointer.url
        }
      ]
    })
    const scope = mockAuthServer(grant.toTokenInfo())
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

  test('returns 401 if any signature keyid does not match the jwk key id without body', async (): Promise<void> => {
    await prepareTest(false)
    const grant = mockGrant({
      access: [
        {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Read],
          identifier: ctx.paymentPointer.url
        }
      ]
    })
    const scope = mockAuthServer(grant.toTokenInfo())
    ctx.request.headers['signature-input'] = ctx.request.headers[
      'signature-input'
    ].replace('gnap-key', 'mismatched-key')
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

  test('returns 401 if any signature keyid does not match the jwk key id with body', async (): Promise<void> => {
    const grant = mockGrant({
      access: [
        {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Read],
          identifier: ctx.paymentPointer.url
        }
      ]
    })
    const scope = mockAuthServer(grant.toTokenInfo())
    ctx.request.headers['signature-input'] = ctx.request.headers[
      'signature-input'
    ].replace('gnap-key', 'mismatched-key')
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

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
    const grant = mockGrant({
      access: [
        {
          type: AccessType.IncomingPayment,
          actions: [AccessAction.Read],
          identifier: ctx.paymentPointer.url
        }
      ]
    })
    const scope = mockAuthServer(grant.toTokenInfo())
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })
})
