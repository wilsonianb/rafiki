import {
  components as RSComponents,
  external as RSExternal,
  operations as RSOperations
} from './generated/resource-server-types'

export type AccessLimits =
  RSExternal['schemas.yaml']['components']['schemas']['limits-outgoing']
export type Introspection =
  RSOperations['post-introspect']['requestBody']['content']['application/json']
export type TokenInfo =
  RSOperations['post-introspect']['responses']['200']['content']['application/json']
export type ActiveTokenInfo = RSComponents['schemas']['token-info']
