import assert from 'assert'
import { Logger } from 'pino'
import Ajv2020, { ValidateFunction } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { OpenAPIV3_1 } from 'openapi-types'

interface ServiceDependencies {
  logger: Logger
  ajv: Ajv2020
  spec: OpenAPIV3_1.Document
}

export interface ValidatorService {
  create<T>(path: string, method: string): ValidateFunction<T>
}

export function createValidatorService(
  deps_: Omit<ServiceDependencies, 'ajv'>
): ValidatorService {
  const logger = deps_.logger.child({
    service: 'ValidatorService'
  })

  const ajv = new Ajv2020()
  addFormats(ajv)
  ajv.addFormat('uint64', (x) => {
    try {
      const value = BigInt(x)
      return value > BigInt(0)
    } catch (e) {
      return false
    }
  })

  const deps = {
    ...deps_,
    logger,
    ajv
  }

  return {
    create: <T>(path: string, method: string) =>
      createValidator<T>(deps, path, method)
  }
}

function createValidator<T>(
  deps: ServiceDependencies,
  path: string,
  method: string
): ValidateFunction<T> {
  // assert.ok(
  //   deps.spec.paths?.[path]?.[method]?.requestBody
  // )
  const requestBody = deps.spec.paths?.[path]?.[method]
    ?.requestBody as OpenAPIV3_1.RequestBodyObject
  assert.ok(requestBody?.content['application/json'].schema)

  return deps.ajv.compile<T>(requestBody.content['application/json'].schema)
}
