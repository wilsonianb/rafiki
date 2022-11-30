import {
  components as RSComponents,
  paths as RSPaths,
  operations as RSOperations
} from './generated/resource-server-types'

export type TokenInfo =
  RSOperations['post-introspect']['responses']['200']['content']['application/json']
