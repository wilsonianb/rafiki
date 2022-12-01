import {
  components as RSComponents,
  operations as RSOperations
} from './generated/resource-server-types'

export type TokenInfo = RSComponents['schemas']['token-info']
export type Introspection =
  RSOperations['post-introspect']['responses']['200']['content']['application/json']
