import $RefParser from '@apidevtools/json-schema-ref-parser'
import assert from 'assert'
import { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types'

export const HttpMethod = {
  ...OpenAPIV3.HttpMethods
}
export type HttpMethod = OpenAPIV3.HttpMethods

export async function createOpenAPI(spec: string): Promise<OpenAPI> {
  return new OpenAPIImpl(
    (await $RefParser.dereference(spec)) as OpenAPIV3_1.Document
  )
}

interface Paths<T = unknown, P = unknown> {
  [pattern: string]: OpenAPIV3_1.PathItemObject<T> & P
}

export interface OpenAPI {
  paths: Paths
  hasPath: (path: PropertyKey) => path is keyof this['paths']
}

class OpenAPIImpl implements OpenAPI {
  constructor(spec: OpenAPIV3_1.Document) {
    assert.ok(spec.paths)
    this.paths = spec.paths as Paths
  }
  public paths: Paths
  public hasPath(path: PropertyKey): path is keyof this['paths'] {
    return path in this.paths
  }
}
