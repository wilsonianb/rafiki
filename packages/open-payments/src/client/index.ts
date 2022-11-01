import { KeyLike } from 'crypto'
import { createOpenAPI, OpenAPI } from 'openapi'
import createLogger, { Logger } from 'pino'
import config from '../config'
import {
  createIncomingPaymentRoutes,
  IncomingPaymentRoutes
} from './incoming-payment'
import {
  createILPStreamConnectionRoutes,
  ILPStreamConnectionRoutes
} from './ilp-stream-connection'
import {
  createPaymentPointerRoutes,
  PaymentPointerRoutes
} from './payment-pointer'
import { createAxiosInstance } from './requests'
import { AxiosInstance } from 'axios'

export interface CreateOpenPaymentClientArgs {
  requestTimeoutMs?: number
  logger?: Logger
  privateKey: KeyLike
  keyId: string
}

export interface ClientDeps {
  axiosInstance: AxiosInstance
  openApi: OpenAPI
  logger: Logger
}

export interface OpenPaymentsClient {
  incomingPayment: IncomingPaymentRoutes
  ilpStreamConnection: ILPStreamConnectionRoutes
  paymentPointer: PaymentPointerRoutes
}

export const createClient = async (
  args: CreateOpenPaymentClientArgs
): Promise<OpenPaymentsClient> => {
  const axiosInstance = createAxiosInstance({
    privateKey: args.privateKey,
    keyId: args.keyId,
    requestTimeoutMs:
      args?.requestTimeoutMs ?? config.DEFAULT_REQUEST_TIMEOUT_MS
  })
  const openApi = await createOpenAPI(config.OPEN_PAYMENTS_OPEN_API_URL)
  const logger = args?.logger ?? createLogger()
  const deps = { axiosInstance, openApi, logger }

  return {
    incomingPayment: createIncomingPaymentRoutes(deps),
    ilpStreamConnection: createILPStreamConnectionRoutes(deps),
    paymentPointer: createPaymentPointerRoutes(deps)
  }
}
