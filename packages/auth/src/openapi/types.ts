import {
  components as RSComponents,
  external as RSExternal,
  operations as RSOperations
} from './generated/resource-server-types'

export type TokenInfo = RSComponents['schemas']['token-info']
export type Access = RSComponents['schemas']['token-info']['access'][number]
export type AccessLimits =
  RSExternal['schemas.yaml']['components']['schemas']['limits-outgoing']
export type Introspection =
  RSOperations['post-introspect']['responses']['200']['content']['application/json']
