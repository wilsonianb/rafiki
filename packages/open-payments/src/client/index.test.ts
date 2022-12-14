import nock from 'nock'

import { BaseDeps } from './'
import {
  defaultAxiosInstance,
  mockOpenApiResponseValidators,
  silentLogger
} from '../test/helpers'

const axiosInstance = defaultAxiosInstance
const logger = silentLogger
const url = 'http://localhost:1000'
const accessToken = 'accessToken'
const openApiValidators = mockOpenApiResponseValidators()

interface GetArgs {
  url: string
  accessToken?: string
}

interface GetTestsOptions<T> {
  resource: T
  get: (
    deps: BaseDeps,
    args: GetArgs,
    validateOpenApiResponse: ResponseValidator<T>
  ) => Promise<T>
}

export const getTests = <T>({ resource, get }: GetTestsOptions<T>): void => {
  describe('common get tests', (): void => {
    test('returns resource if passes validation', async (): Promise<void> => {
      const scope = nock(url).get('/').reply(200, resource)

      await expect(
        get(
          {
            axiosInstance,
            logger
          },
          {
            url,
            accessToken
          },
          openApiValidators.successfulValidator
        )
      ).resolves.toStrictEqual(resource)
      scope.done()
    })

    test('throws if resource does not pass open api validation', async (): Promise<void> => {
      const scope = nock(url).get('/').reply(200, resource)

      await expect(() =>
        get(
          {
            axiosInstance,
            logger
          },
          {
            url,
            accessToken
          },
          openApiValidators.failedValidator
        )
      ).rejects.toThrowError()
      scope.done()
    })
  })
}

interface PostArgs<T = undefined> {
  url: string
  body?: T
  accessToken: string
}

interface CreateTestsOptions<T> {
  resource: T
  create: (
    deps: BaseDeps,
    args: PostArgs,
    validateOpenApiResponse: ResponseValidator<T>
  ) => Promise<T>
}

export const createTests = <T>({
  resource,
  create
}: CreateTestsOptions<T>): void => {
  describe('common create tests', (): void => {
    test('returns resource if passes validation', async (): Promise<void> => {
      const scope = nock(url).post('/').reply(200, resource)

      await expect(
        create(
          {
            axiosInstance,
            logger
          },
          {
            url,
            accessToken: 'accessToken',
            body: {
              key: 'value'
            }
          },
          openApiValidators.successfulValidator
        )
      ).resolves.toEqual(resource)
      scope.done()
    })

    test('throws if resource does not pass open api validation', async (): Promise<void> => {
      const scope = nock(url).post('/').reply(200, resource)

      await expect(() =>
        create(
          {
            axiosInstance,
            logger
          },
          {
            url,
            accessToken,
            body: {
              key: 'value'
            }
          },
          openApiValidators.failedValidator
        )
      ).rejects.toThrowError()
      scope.done()
    })
  })
}

test.todo('test suite must contain at least one test')
