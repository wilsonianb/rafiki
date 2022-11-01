import { generateKeyPairSync } from 'crypto'
import createLogger from 'pino'
import { createAxiosInstance } from '../client/requests'
import { ILPStreamConnection, IncomingPayment } from '../types'
import base64url from 'base64url'
import { v4 as uuid } from 'uuid'
import { ResponseValidator } from 'openapi'

export const silentLogger = createLogger({
  level: 'silent'
})

export const keyId = 'default-key-id'

export const defaultAxiosInstance = createAxiosInstance({
  requestTimeoutMs: 0,
  keyId,
  privateKey: generateKeyPairSync('ed25519').privateKey
})

export const mockOpenApiResponseValidators = () => ({
  successfulValidator: ((data: unknown): data is unknown =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    true) as ResponseValidator<any>,
  failedValidator: ((data: unknown): data is unknown => {
    throw new Error('Failed to validate response')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as ResponseValidator<any>
})

export const mockILPStreamConnection = (
  overrides?: Partial<ILPStreamConnection>
): ILPStreamConnection => ({
  id: uuid(),
  sharedSecret: base64url('sharedSecret'),
  ilpAddress: 'ilpAddress',
  assetCode: 'USD',
  assetScale: 2,
  ...overrides
})

export const mockIncomingPayment = (
  overrides?: Partial<IncomingPayment>
): IncomingPayment => ({
  id: uuid(),
  paymentPointer: 'paymentPointer',
  completed: false,
  incomingAmount: {
    assetCode: 'USD',
    assetScale: 2,
    value: '10'
  },
  receivedAmount: {
    assetCode: 'USD',
    assetScale: 2,
    value: '0'
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ilpStreamConnection: mockILPStreamConnection(),
  ...overrides
})
