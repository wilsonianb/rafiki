import axios, { AxiosInstance } from 'axios'
import { sign, KeyObject } from 'crypto'
import { httpis as httpsig, Algorithm, Signer } from 'http-message-signatures'
import { ValidateFunction } from 'openapi'
import { ClientDeps } from '.'

export interface GetArgs {
  url: string
  privateKey?: never
  keyId?: never
  accessToken?: never
}

export interface AuthGetArgs {
  url: string
  privateKey: KeyObject
  keyId: string
  accessToken: string
}

const COMPONENTS = ['@method', '@target-uri']
const GET_COMPONENTS = [...COMPONENTS, 'authorization']

const createSigner = (privateKey: KeyObject): Signer => {
  const signer = async (data: Buffer) => sign(null, data, privateKey)
  signer.alg = 'ed25519' as Algorithm
  return signer
}

export const get = async <T>(
  clientDeps: Pick<ClientDeps, 'axiosInstance' | 'logger'>,
  args: GetArgs | AuthGetArgs,
  openApiResponseValidator: ValidateFunction<T>
): Promise<T> => {
  const { axiosInstance, logger } = clientDeps
  const { url, accessToken } = args

  const headers = accessToken
    ? {
        Authorization: `GNAP ${accessToken}`
      }
    : {}

  if (args.privateKey) {
    const { headers: httpsigHeaders } = await httpsig.sign(
      {
        method: 'GET',
        url,
        headers
      },
      {
        components: GET_COMPONENTS,
        parameters: {
          created: Math.floor(Date.now() / 1000)
        },
        keyId: args.keyId,
        signer: createSigner(args.privateKey),
        format: 'httpbis'
      }
    )
    headers['Signature'] = httpsigHeaders['Signature']
    headers['Signature-Input'] = httpsigHeaders['Signature-Input']
  }

  try {
    const { data } = await axiosInstance.get(url, {
      headers
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
