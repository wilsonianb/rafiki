import { HttpMethod } from 'openapi'
import { ClientDeps } from '.'
import { IncomingPayment, getPath } from '../types'
import { get, AuthGetArgs } from './requests'

export interface IncomingPaymentRoutes {
  get(args: AuthGetArgs): Promise<IncomingPayment>
}

export const createIncomingPaymentRoutes = (
  clientDeps: ClientDeps
): IncomingPaymentRoutes => {
  const { axiosInstance, openApi, logger } = clientDeps

  const getIncomingPaymentValidator =
    openApi.createResponseValidator<IncomingPayment>({
      path: getPath('/incoming-payments/{id}'),
      method: HttpMethod.GET
    })

  return {
    get: (args: AuthGetArgs) =>
      get({ axiosInstance, logger }, args, getIncomingPaymentValidator)
  }
}
