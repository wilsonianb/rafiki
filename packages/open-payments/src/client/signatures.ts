import { sign, KeyLike } from 'crypto'
import {
  httpis as httpsig,
  Algorithm,
  Component,
  RequestLike,
  Signer
} from 'http-message-signatures'

interface SignOptions extends RequestLike {
  privateKey: KeyLike
  keyId: string
  accessToken?: string
  components: Component[]
}

// interface SignatureHeaders {
//   Signature: string
//   'Signature-Input': string
//   Authorization?: string
//   // TODO:
//   // 'Content-Type'?: string
//   // 'Content-Length'?: string
//   // 'Content-Digest'?: string
// }

const BASE_COMPONENTS = ['@method', '@target-uri']

const createSigner = (privateKey: KeyLike): Signer => {
  const signer = async (data: Buffer) => sign(null, data, privateKey)
  signer.alg = 'ed25519' as Algorithm
  return signer
}

const createSignatureHeaders = async (
  options: SignOptions
): Promise<RequestLike['headers']> => {
  const { headers } = await httpsig.sign(options, {
    components: options.components,
    parameters: {
      created: Math.floor(Date.now() / 1000)
    },
    keyId: options.keyId,
    signer: createSigner(options.privateKey),
    format: 'httpbis'
  })
  return headers
}

interface GetSignOptions {
  url: string
  privateKey: KeyLike
  keyId: string
  accessToken: string
}

// interface GetSignatureHeaders {
//   Signature: string
//   'Signature-Input': string
//   Authorization: string
// }

export const createGetSignatureHeaders = async (
  options: GetSignOptions
): Promise<RequestLike['headers']> =>
  createSignatureHeaders({
    ...options,
    method: 'GET',
    headers: {
      Authorization: `GNAP ${options.accessToken}`
    },
    components: [...BASE_COMPONENTS, 'authorization']
  })

// TODO:
// interface PostSignOptions extends GetSignOptions {
//   // This will be optional for grant requests
//   accessToken?: string
//   body: any
// }

// export const createPostSignatureHeaders = async (options: PostSignOptions): Promise<RequestLike['headers']> =>
//   // TODO: content digest
//   createSignatureHeaders({
//     ...options,
//     method: 'POST',
//     headers: {
//       Authorization: `GNAP ${options.accessToken}`
//     },
//     components: [...BASE_COMPONENTS, 'authorization', 'content-digest', 'content-length', 'content-type']
//   })
