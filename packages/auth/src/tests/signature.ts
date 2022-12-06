import { generateKeyPairSync, KeyLike, sign } from 'crypto'
import { v4 } from 'uuid'
import { createContentDigestHeader } from 'httpbis-digest-headers'
import { generateJwk, JWK } from 'open-payments'

export const SIGNATURE_METHOD = 'GET'
export const SIGNATURE_TARGET_URI = '/test'
export const KEY_REGISTRY_ORIGIN = 'https://openpayments.network'

export const TEST_CLIENT = {
  id: v4(),
  name: 'Test Client',
  email: 'bob@bob.com',
  image: 'a link to an image',
  uri: 'https://example.com'
}

export const TEST_CLIENT_DISPLAY = {
  name: TEST_CLIENT.name,
  uri: TEST_CLIENT.uri
}

export async function generateTestKeys(): Promise<{
  keyId: string
  publicKey: JWK
  privateKey: KeyLike
}> {
  const { privateKey } = generateKeyPairSync('ed25519')
  const keyId = v4()
  return {
    keyId,
    publicKey: generateJwk({
      keyId,
      privateKey
    }),
    privateKey
  }
}

export async function generateSigHeaders({
  privateKey,
  url,
  method,
  keyId,
  optionalComponents
}: {
  privateKey: KeyLike
  url: string
  method: string
  keyId: string
  optionalComponents?: {
    body?: unknown
    authorization?: string
  }
}): Promise<{
  sigInput: string
  signature: string
  contentDigest?: string
  contentLength?: string
  contentType?: string
}> {
  let sigInputComponents = 'sig1=("@method" "@target-uri"'
  const { body, authorization } = optionalComponents ?? {}
  if (body)
    sigInputComponents += ' "content-digest" "content-length" "content-type"'

  if (authorization) sigInputComponents += ' "authorization"'

  const sigInput = sigInputComponents + `);created=1618884473;keyid="${keyId}"`
  let challenge = `"@method": ${method}\n"@target-uri": ${url}\n`
  let contentDigest
  let contentLength
  let contentType
  if (body) {
    contentDigest = createContentDigestHeader(JSON.stringify(body), ['sha-512'])
    challenge += `"content-digest": ${contentDigest}\n`

    contentLength = Buffer.from(JSON.stringify(body), 'utf-8').length
    challenge += `"content-length": ${contentLength}\n`
    contentType = 'application/json'
    challenge += `"content-type": ${contentType}\n`
  }

  if (authorization) {
    challenge += `"authorization": ${authorization}\n`
  }

  challenge += `"@signature-params": ${sigInput.replace('sig1=', '')}`

  const signature = sign(null, Buffer.from(challenge), privateKey)

  return {
    signature: signature.toString('base64'),
    sigInput,
    contentDigest,
    contentLength,
    contentType
  }
}
