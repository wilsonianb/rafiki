import axios, { AxiosInstance } from 'axios'
import { KeyLike } from 'crypto'
import { ValidateFunction } from 'openapi'
import { ClientDeps } from '.'
import { createGetSignatureHeaders } from './signatures'

export interface GetArgs {
  url: string
  privateKey?: never
  keyId?: never
  accessToken?: never
}

export interface AuthGetArgs {
  url: string
  privateKey: KeyLike
  keyId: string
  accessToken: string
}

export const get = async <T>(
  clientDeps: Pick<ClientDeps, 'axiosInstance' | 'logger'>,
  args: GetArgs | AuthGetArgs,
  openApiResponseValidator: ValidateFunction<T>
): Promise<T> => {
  const { axiosInstance, logger } = clientDeps
  const { url } = args

  try {
    const { data } = await axiosInstance.get(url, {
      headers: args.privateKey
        ? await createGetSignatureHeaders(args as AuthGetArgs)
        : // ? {
          //     ...(await createGetSignatureHeaders(args as AuthGetArgs))
          //   }
          {}
    })

    if (!openApiResponseValidator(data)) {
      const errorMessage = 'Failed to validate OpenApi response'
      logger.error({ data: JSON.stringify(data), url }, errorMessage)

      throw new Error(errorMessage)
    }

    return data
  } catch (error) {
    const errorMessage = `Error when making Open Payments GET request: ${
      error?.message ? error.message : 'Unknown error'
    }`
    logger.error({ url }, errorMessage)

    throw new Error(errorMessage)
  }
}

export const createAxiosInstance = (args: {
  requestTimeoutMs: number
}): AxiosInstance => {
  const axiosInstance = axios.create({
    timeout: args.requestTimeoutMs
  })

  axiosInstance.defaults.headers.common['Content-Type'] = 'application/json'

  return axiosInstance
}
