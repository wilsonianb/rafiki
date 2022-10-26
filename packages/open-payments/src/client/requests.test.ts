/* eslint-disable @typescript-eslint/no-empty-function */
import { createAxiosInstance, get } from './requests'
import { generateKeyPairSync } from 'crypto'
import nock from 'nock'
import { silentLogger } from '../test/helpers'

describe('requests', (): void => {
  const logger = silentLogger

  describe('createAxiosInstance', (): void => {
    test('sets timeout properly', async (): Promise<void> => {
      expect(
        createAxiosInstance({ requestTimeoutMs: 1000 }).defaults.timeout
      ).toBe(1000)
    })
    test('sets Content-Type header properly', async (): Promise<void> => {
      expect(
        createAxiosInstance({ requestTimeoutMs: 0 }).defaults.headers.common[
          'Content-Type'
        ]
      ).toBe('application/json')
    })
  })

  describe('get', (): void => {
    const axiosInstance = createAxiosInstance({ requestTimeoutMs: 0 })
    const baseUrl = 'http://localhost:1000'
    const successfulValidator = (data: unknown): data is unknown => true
    const failedValidator = (data: unknown): data is unknown => false

    beforeAll(() => {
      jest.spyOn(axiosInstance, 'get')
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    test('sets headers properly if accessToken provided', async (): Promise<void> => {
      nock(baseUrl).get('/incoming-payment').reply(200)

      const keyId = 'myId'

      // https://github.com/nock/nock/issues/2200#issuecomment-1280957462
      jest
        .useFakeTimers({
          doNotFake: [
            'nextTick',
            'setImmediate',
            'clearImmediate',
            'setInterval',
            'clearInterval',
            'setTimeout',
            'clearTimeout'
          ]
        })
        .setSystemTime(new Date())

      await get(
        { axiosInstance, logger },
        {
          url: `${baseUrl}/incoming-payment`,
          accessToken: 'accessToken',
          privateKey: generateKeyPairSync('ed25519').privateKey,
          keyId
        },
        successfulValidator
      )

      expect(axiosInstance.get).toHaveBeenCalledWith(
        `${baseUrl}/incoming-payment`,
        {
          headers: {
            Authorization: 'GNAP accessToken',
            Signature: expect.stringMatching(/sig1=:([a-zA-Z0-9+/]){86}==:/),
            'Signature-Input': `sig1=("@method" "@target-uri" "authorization");created=${Math.floor(
              Date.now() / 1000
            )};keyid="${keyId}";alg="ed25519"`
          }
        }
      )

      // TODO: verify signature
    })

    test('sets headers properly if accessToken is not provided', async (): Promise<void> => {
      nock(baseUrl).get('/incoming-payment').reply(200)

      await get(
        { axiosInstance, logger },
        {
          url: `${baseUrl}/incoming-payment`
        },
        successfulValidator
      )

      expect(axiosInstance.get).toHaveBeenCalledWith(
        `${baseUrl}/incoming-payment`,
        {
          headers: {}
        }
      )
    })

    test('throws if response validator function fails', async (): Promise<void> => {
      nock(baseUrl).get('/incoming-payment').reply(200)

      await expect(
        get(
          { axiosInstance, logger },
          {
            url: `${baseUrl}/incoming-payment`
          },
          failedValidator
        )
      ).rejects.toThrow(/Failed to validate OpenApi response/)
    })
  })
})
