import assert from 'assert'
import nock, { Definition } from 'nock'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'
import { Context } from 'koa'
import {
  generateTestKeys,
  createHeaders,
  Headers,
  TestKeys
} from 'http-signature-utils'

import { createAuthMiddleware } from './middleware'
import { GrantJSON, AccessType, AccessAction } from './grant'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { Body, RequestMethod } from 'node-mocks-http'
import { HttpMethod, RequestValidator } from 'openapi'
import { createTestApp, TestContainer } from '../../tests/app'
import { createPaymentPointer } from '../../tests/paymentPointer'
import { truncateTables } from '../../tests/tableManager'
import { setup, SetupOptions } from '../payment_pointer/model.test'
import { KeyInfo, TokenInfo, TokenInfoJSON } from './service'

type AppMiddleware = (ctx: Context, next: () => Promise<void>) => Promise<void>

type IntrospectionBody = {
  access_token: string
  resource_server: string
}

describe('Auth Middleware', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let authServerIntrospectionUrl: URL
  let middleware: AppMiddleware
  let ctx: Context
  let next: jest.MockedFunction<() => Promise<void>>
  let validateRequest: RequestValidator<IntrospectionBody>
  let mockKeyInfo: KeyInfo
  const token = 'OS9M2PMHKUR64TB8N6BW7OZB8CDFONP219RP1LT0'
  let testKeys: TestKeys
  let requestAuthorization: string
  let requestBody: Body
  let requestUrl: string
  let requestMethod: RequestMethod
  let requestSignatureHeaders: Headers

  function setupHttpSigContext(options: SetupOptions): Context {
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
    const request = {
      url: requestUrl,
      method: requestMethod,
      headers: { authorization: requestAuthorization },
      body: includeBody ? JSON.stringify(requestBody) : undefined
    }
    requestSignatureHeaders = await createHeaders({
      request,
      privateKey: testKeys.privateKey,
      keyId: testKeys.publicKey.kid
    })

    ctx = setupHttpSigContext({
      reqOpts: {
        headers: {
          Accept: 'application/json',
          Authorization: `GNAP ${token}`,
          ...requestSignatureHeaders
        },
        method: requestMethod,
        body: includeBody ? requestBody : undefined,
        url: requestUrl
      },
      paymentPointer: await createPaymentPointer(deps)
    })
    ctx.container = deps
    next = jest.fn()
    mockKeyInfo = {
      jwk: testKeys.publicKey,
      proof: 'httpsig'
    }
  }

  beforeAll(async (): Promise<void> => {
    deps = await initIocContainer(Config)
    appContainer = await createTestApp(deps)
    authServerIntrospectionUrl = new URL(Config.authServerIntrospectionUrl)
    middleware = createAuthMiddleware({
      type: AccessType.IncomingPayment,
      action: AccessAction.Read
    })
    const { tokenIntrospectionSpec } = await deps.use('openApi')
    validateRequest = tokenIntrospectionSpec.createRequestValidator({
      path: '/',
      method: HttpMethod.POST
    })
    testKeys = generateTestKeys()
    requestMethod = HttpMethod.POST.toUpperCase() as RequestMethod
    requestBody = {
      access_token: token,
      proof: 'httpsig',
      resource_server: 'test'
    }
    requestAuthorization = `GNAP ${token}`
    requestUrl = Config.authServerGrantUrl + `/introspect` //'http://127.0.0.1:3006/introspect'
  })

  beforeEach(async (): Promise<void> => {
    await prepareTest(true)
  })

  afterAll(async (): Promise<void> => {
    await truncateTables(await deps.use('knex'))
    await appContainer.shutdown()
  })

  function mockAuthServer(
    grant: GrantJSON | TokenInfoJSON | string | undefined = undefined
  ): nock.Scope {
    return nock(authServerIntrospectionUrl.origin)
      .post(
        authServerIntrospectionUrl.pathname,
        function (this: Definition, body) {
          assert.ok(
            validateRequest({
              ...this,
              body
            })
          )
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
    const scope = mockAuthServer({
      active: true,
      client_id: uuid(),
      grant: uuid(),
      access: [
        {
          type: AccessType.OutgoingPayment,
          actions: [AccessAction.Create],
          identifier: ctx.paymentPointer.url
        }
      ]
    })
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
      const grant = new TokenInfo(
        {
          active: true,
          clientId: uuid(),
          grant: uuid(),
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
        },
        mockKeyInfo
      )
      const scope = mockAuthServer(grant.toJSON())
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
    const grant = new TokenInfo(
      {
        active: true,
        clientId: uuid(),
        grant: uuid(),
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read],
            identifier: ctx.paymentPointer.url
          }
        ]
      },
      mockKeyInfo
    )
    const scope = mockAuthServer(grant.toJSON())
    await expect(middleware(ctx, next)).resolves.not.toThrow()
    expect(next).toHaveBeenCalled()
    scope.done()
  })

  test('returns 200 with valid http signature with body', async (): Promise<void> => {
    const grant = new TokenInfo(
      {
        active: true,
        clientId: uuid(),
        grant: uuid(),
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read],
            identifier: ctx.paymentPointer.url
          }
        ]
      },
      mockKeyInfo
    )
    const scope = mockAuthServer(grant.toJSON())
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
          'Signature-Input': requestSignatureHeaders['Signature-Input']
        },
        method: requestMethod,
        url: requestUrl
      },
      paymentPointer: await createPaymentPointer(deps)
    })
    ctx.container = deps
    const grant = new TokenInfo(
      {
        active: true,
        clientId: uuid(),
        grant: uuid(),
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read],
            identifier: ctx.paymentPointer.url
          }
        ]
      },
      mockKeyInfo
    )
    const scope = mockAuthServer(grant.toJSON())
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
          'Signature-Input': requestSignatureHeaders['Signature-Input'],
          'Content-Digest': requestSignatureHeaders['Content-Digest'],
          'Content-Length': JSON.stringify(requestBody).length.toString()
        },
        method: requestMethod,
        body: requestBody,
        url: requestUrl
      },
      paymentPointer: await createPaymentPointer(deps)
    })
    ctx.container = deps
    const grant = new TokenInfo(
      {
        active: true,
        clientId: uuid(),
        grant: uuid(),
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read],
            identifier: ctx.paymentPointer.url
          }
        ]
      },
      mockKeyInfo
    )
    const scope = mockAuthServer(grant.toJSON())
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

  test('returns 401 for invalid key type without body', async (): Promise<void> => {
    await prepareTest(false)
    mockKeyInfo.jwk.kty = 'EC' as 'OKP'
    const grant = new TokenInfo(
      {
        active: true,
        clientId: uuid(),
        grant: uuid(),
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read],
            identifier: ctx.paymentPointer.url
          }
        ]
      },
      mockKeyInfo
    )
    const scope = mockAuthServer(grant.toJSON())
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

  test('returns 401 for invalid key type with body', async (): Promise<void> => {
    mockKeyInfo.jwk.kty = 'EC' as 'OKP'
    const grant = new TokenInfo(
      {
        active: true,
        clientId: uuid(),
        grant: uuid(),
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read],
            identifier: ctx.paymentPointer.url
          }
        ]
      },
      mockKeyInfo
    )
    const scope = mockAuthServer(grant.toJSON())
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

  test('returns 401 if any signature keyid does not match the jwk key id without body', async (): Promise<void> => {
    await prepareTest(false)
    const grant = new TokenInfo(
      {
        active: true,
        clientId: uuid(),
        grant: uuid(),
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read],
            identifier: ctx.paymentPointer.url
          }
        ]
      },
      mockKeyInfo
    )
    const scope = mockAuthServer(grant.toJSON())
    let sigInput = ctx.request.headers['signature-input'] as string
    sigInput = sigInput.replace(
      /(keyid=")[0-9a-z-]{36}/g,
      '$1' + 'mismatched-key'
    )
    ctx.request.headers['signature-input'] = sigInput
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })

  test('returns 401 if any signature keyid does not match the jwk key id with body', async (): Promise<void> => {
    const grant = new TokenInfo(
      {
        active: true,
        clientId: uuid(),
        grant: uuid(),
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read],
            identifier: ctx.paymentPointer.url
          }
        ]
      },
      mockKeyInfo
    )
    const scope = mockAuthServer(grant.toJSON())
    let sigInput = ctx.request.headers['signature-input'] as string
    sigInput = sigInput.replace(
      /(keyid=")[0-9a-z-]{36}/g,
      '$1' + 'mismatched-key'
    )
    ctx.request.headers['signature-input'] = sigInput
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
          Signature: `sig1=:${requestSignatureHeaders['Signature']}:`,
          'Signature-Input': requestSignatureHeaders['Signature-Input'],
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
    const grant = new TokenInfo(
      {
        active: true,
        clientId: uuid(),
        grant: uuid(),
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read],
            identifier: ctx.paymentPointer.url
          }
        ]
      },
      mockKeyInfo
    )
    const scope = mockAuthServer(grant.toJSON())
    await expect(middleware(ctx, next)).resolves.toBeUndefined()
    expect(ctx.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
    scope.done()
  })
})
