import {
  createIntrospectionRoutes,
  introspectToken,
  validateTokenInfo
} from './introspection'
import { OpenAPI, HttpMethod, createOpenAPI } from 'openapi'
import {
  defaultAxiosInstance,
  mockOpenApiResponseValidators,
  mockTokenInfo,
  silentLogger
} from '../test/helpers'
import nock from 'nock'
import path from 'path'

describe('introspection', (): void => {
  let openApi: OpenAPI

  beforeAll(async () => {
    openApi = await createOpenAPI(
      path.resolve(__dirname, '../openapi/token-introspection.yaml')
    )
  })

  const axiosInstance = defaultAxiosInstance
  const logger = silentLogger
  const baseUrl = 'http://localhost:1000'
  const openApiValidators = mockOpenApiResponseValidators()

  describe('createIntrospectionRoutes', (): void => {
    test('creates introspectOpenApiValidator properly', async (): Promise<void> => {
      jest.spyOn(openApi, 'createResponseValidator')

      createIntrospectionRoutes({
        axiosInstance,
        openApi,
        logger
      })
      expect(openApi.createResponseValidator).toHaveBeenCalledWith({
        path: '/',
        method: HttpMethod.POST
      })
    })
  })

  describe('introspectToken', (): void => {
    const access_token = 'OS9M2PMHKUR64TB8N6BW7OZB8CDFONP219RP1LT0'
    test('returns token info if passes validation', async (): Promise<void> => {
      const tokenInfo = mockTokenInfo()

      const scope = nock(baseUrl).post('/').reply(200, tokenInfo)
      // const scope = nock(baseUrl)
      //   .matchHeader('Signature', /sig1=:([a-zA-Z0-9+/]){86}==:/)
      //   .matchHeader(
      //     'Signature-Input',
      //     `sig1=("@method" "@target-uri" "content-digest" "content-length" "content-type");created=${Math.floor(
      //       Date.now() / 1000
      //     )};keyid="${keyId}";alg="ed25519"`
      //   )
      //   .matchHeader('Content-Digest', /sha-512=:([a-zA-Z0-9+/]){86}==:/)
      //   .matchHeader('Content-Length', 11)
      //   .matchHeader('Content-Type', 'application/json')
      //   .post('/grant', body)
      //   // TODO: verify signature
      //   .reply(status, body)

      await expect(
        introspectToken(
          {
            axiosInstance,
            logger
          },
          {
            access_token
          },
          openApiValidators.successfulValidator
        )
      ).resolves.toStrictEqual(tokenInfo)
      scope.done()
    })

    // test.todo('throws if token info does not pass validation', async (): Promise<void> => {
    //   const incomingPayment = mockIncomingPayment({
    //     incomingAmount: {
    //       assetCode: 'USD',
    //       assetScale: 2,
    //       value: '5'
    //     },
    //     receivedAmount: {
    //       assetCode: 'USD',
    //       assetScale: 2,
    //       value: '10'
    //     }
    //   })

    //   nock(baseUrl).get('/incoming-payments').reply(200, incomingPayment)

    //   await expect(() =>
    //     getIncomingPayment(
    //       {
    //         axiosInstance,
    //         logger
    //       },
    //       {
    //         url: `${baseUrl}/incoming-payments`,
    //         accessToken: 'accessToken'
    //       },
    //       openApiValidators.successfulValidator
    //     )
    //   ).rejects.toThrowError()
    // })

    test('throws if token info does not pass open api validation', async (): Promise<void> => {
      const scope = nock(baseUrl).post('/').reply(200, mockTokenInfo())

      await expect(() =>
        introspectToken(
          {
            axiosInstance,
            logger
          },
          {
            access_token
          },
          openApiValidators.failedValidator
        )
      ).rejects.toThrowError()
      scope.done()
    })
  })

  describe('validateTokenInfo', (): void => {
    // test('throws if receiving amount asset scale is different that ilp connection asset scale', async (): Promise<void> => {
    //   const ilpStreamConnection = mockILPStreamConnection({
    //     assetCode: 'USD',
    //     assetScale: 1
    //   })
    //   const incomingPayment = mockIncomingPayment({
    //     incomingAmount: {
    //       assetCode: 'USD',
    //       assetScale: 2,
    //       value: '5'
    //     },
    //     receivedAmount: {
    //       assetCode: 'USD',
    //       assetScale: 2,
    //       value: '0'
    //     },
    //     ilpStreamConnection
    //   })
    //   expect(() => validateIncomingPayment(incomingPayment)).toThrow(
    //     'Stream connection asset information does not match incoming payment asset information'
    //   )
    // })
  })
})
