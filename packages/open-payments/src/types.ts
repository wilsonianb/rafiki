import {
  OPEN_PAYMENTS_AS_OPEN_API_URL
} from './config'
import {
  components as RSComponents,
  paths as RSPaths,
  operations as RSOperations
} from './generated/resource-server-types'
import {
  components as ASComponents,
  external as ASExternal
  paths as ASPaths,
  operations as ASOperations
} from './generated/auth-server-types'

export const getRSPath = <P extends keyof RSPaths>(path: P): string =>
  path as string
export type IncomingPayment =
  RSComponents['schemas']['incoming-payment-with-connection']
export type ILPStreamConnection =
  RSComponents['schemas']['ilp-stream-connection']
export type OutgoingPayment = RSComponents['schemas']['outgoing-payment']
export type CreateOutgoingPaymentArgs =
  RSOperations['create-outgoing-payment']['requestBody']['content']['application/json']
export type PaymentPointer = RSComponents['schemas']['payment-pointer']
export type JWK = RSComponents['schemas']['json-web-key']
export type JWKS = RSComponents['schemas']['json-web-key-set']

export const getASPath = <P extends keyof ASPaths>(path: P): string =>
  path as string
export type NonInteractiveGrantRequest = {
  access_token: ASOperations['post-request']['requestBody']['content']['application/json']['access_token']
  client: ASOperations['post-request']['requestBody']['content']['application/json']['client']
}
export type NonInteractiveGrant = {
  access_token: ASComponents['schemas']['access_token']
  continue: ASComponents['schemas']['continue']
}
export type GrantRequest = {
  access_token: ASOperations['post-request']['requestBody']['content']['application/json']['access_token']
  client: ASOperations['post-request']['requestBody']['content']['application/json']['client']
  interact: ASOperations['post-request']['requestBody']['content']['application/json']['interact']
}
export type InteractiveGrant = {
  interact: ASComponents['schemas']['interact-response']
  continue: ASComponents['schemas']['continue']
}
export const isInteractiveGrant = (
  grant: InteractiveGrant | NonInteractiveGrant
): grant is InteractiveGrant => !!(grant as InteractiveGrant).interact

export const isNonInteractiveGrant = (
  grant: InteractiveGrant | NonInteractiveGrant
): grant is NonInteractiveGrant => !!(grant as NonInteractiveGrant).access_token

export type IncomingPaymentAccess = ASExternal[OPEN_PAYMENTS_AS_OPEN_API_URL]['components']['schemas']['access-incoming']
export type OutgoingPaymentAccess = ASExternal[OPEN_PAYMENTS_AS_OPEN_API_URL]['components']['schemas']['access-outgoing']
export type QuoteAccess = ASExternal[OPEN_PAYMENTS_AS_OPEN_API_URL]['components']['schemas']['access-quote']
