import { sign, KeyLike } from 'crypto'
import {
  httpis as httpsig,
  Algorithm,
  RequestLike,
  Signer
} from 'http-message-signatures'

interface SignOptions {
  request: RequestLike
  privateKey: KeyLike
  keyId: string
}

interface SignatureHeaders {
  Signature: string
  'Signature-Input': string
}

const createSigner = (privateKey: KeyLike): Signer => {
  const signer = async (data: Buffer) => sign(null, data, privateKey)
  signer.alg = 'ed25519' as Algorithm
  return signer
}

export const createSignatureHeaders = async ({
  request,
  privateKey,
  keyId
}: SignOptions): Promise<SignatureHeaders> => {
  const components = ['@method', '@target-uri']
  if (request.headers['Authorization']) {
    components.push('authorization')
  }
  if (request.body) {
    // TODO: 'content-digest'
    components.push('content-length', 'content-type')
  }
  const { headers } = await httpsig.sign(request, {
    components,
    parameters: {
      created: Math.floor(Date.now() / 1000)
    },
    keyId,
    signer: createSigner(privateKey),
    format: 'httpbis'
  })
  return {
    Signature: headers['Signature'] as string,
    'Signature-Input': headers['Signature-Input'] as string
  }
}
