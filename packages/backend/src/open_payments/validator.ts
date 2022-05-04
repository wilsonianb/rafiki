import assert from 'assert'
import { Logger } from 'pino'
import Ajv2020, { ValidateFunction } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { convertParametersToJSONSchema } from 'openapi-jsonschema-parameters'
import { OpenAPIV3, OpenAPIV3_1, IJsonSchema } from 'openapi-types'

import { AppContext } from '../app'

interface ServiceDependencies {
  logger: Logger
  ajv: Ajv2020
  spec: OpenAPIV3_1.Document
}

export interface ValidatorService {
  create<CreateT, UpdateT = unknown>(
    path: string
  ): PathValidators<CreateT, UpdateT>
}

interface CollectionParams {
  accountId: string
}

interface ListParams extends CollectionParams {
  cursor?: string
  first?: number
  last?: number
}

interface ResourceParams extends CollectionParams {
  id: string
}

type Request<T> = Omit<AppContext['request'], 'body'> & {
  body: T
}

type CreateContext<T> = Omit<AppContext, 'parameters' | 'request'> & {
  parameters: CollectionParams
  request: Request<T>
}

type ReadContext = Omit<AppContext, 'parameters'> & {
  parameters: ResourceParams
}

type UpdateContext<T> = Omit<AppContext, 'parameters' | 'request'> & {
  parameters: ResourceParams
  request: Request<T>
}

type ListContext = Omit<AppContext, 'parameters'> & {
  parameters: CollectionParams
}

export interface PathValidators<CreateT, UpdateT> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(ctx: any): ctx is CreateContext<CreateT>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  read(ctx: any): ctx is ReadContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update?(ctx: any): ctx is UpdateContext<UpdateT>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  list(ctx: any): ctx is ListContext
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
    create: <CreateT, UpdateT>(path: string) =>
      createPathValidators<CreateT, UpdateT>(deps, path)
  }
}

function createValidator<T>(
  validateParams: ValidateFunction,
  validateBody?: ValidateFunction
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ctx: any): ctx is T => {
    const throwValidateError = (validate: ValidateFunction): void => {
      const error = validate.errors?.[0]
      ctx.throw(
        400,
        `${error?.instancePath.slice(1).replace('/', '.')} ${error?.message}`
      )
    }
    ctx.assert(ctx.accepts('application/json'), 406, 'must accept json')
    if (!validateParams(ctx.params)) {
      throwValidateError(validateParams)
    }
    if (validateBody) {
      ctx.assert(
        ctx.get('Content-Type') === 'application/json',
        400,
        'must send json body'
      )

      if (!validateBody(ctx.request.body)) {
        throwValidateError(validateBody)
      }
    }
    return true
  }
}

const accountIdSchema = {
  type: 'object',
  properties: {
    accountId: {
      type: 'string',
      format: 'uuid'
    }
  }
}

function getParametersSchema(
  parameters: OpenAPIV3_1.ParameterObject[]
): IJsonSchema {
  const schemas = convertParametersToJSONSchema(parameters)
  const allOf: IJsonSchema[] = []
  return {
    allOf: ['path', 'query'].reduce((allOf, key) => {
      if (schemas[key]) {
        allOf.push({
          type: 'object',
          ...schemas[key]
        })
      }
      return allOf
    }, allOf)
  }
}

function createPathValidators<CreateT, UpdateT = unknown>(
  deps: ServiceDependencies,
  path: string
): PathValidators<CreateT, UpdateT> {
  const collectionPath = deps.spec.paths?.[path]
  assert.ok(collectionPath)
  // assert.ok(collectionPath?.parameters)
  // const collectionParams = convertParametersToJSONSchema(collectionPath.parameters)
  const collectionParams = accountIdSchema

  const createBody = collectionPath[OpenAPIV3.HttpMethods.POST]
    ?.requestBody as OpenAPIV3_1.RequestBodyObject
  assert.ok(createBody?.content['application/json'].schema)

  assert.ok(collectionPath[OpenAPIV3.HttpMethods.GET]?.parameters)
  const listParams = getParametersSchema(
    collectionPath[OpenAPIV3.HttpMethods.GET]
      ?.parameters as OpenAPIV3_1.ParameterObject[]
  )

  const resourcePath = deps.spec.paths?.[`${path}/{id}`]
  assert.ok(resourcePath?.parameters)
  const params = getParametersSchema(
    resourcePath.parameters as OpenAPIV3_1.ParameterObject[]
  )

  const validateResourceParams = deps.ajv.compile<ResourceParams>(params)

  const updateBody = resourcePath[OpenAPIV3.HttpMethods.PUT]
    ?.requestBody as OpenAPIV3_1.RequestBodyObject

  return {
    create: createValidator<CreateContext<CreateT>>(
      deps.ajv.compile<CollectionParams>(collectionParams),
      deps.ajv.compile<CreateT>(createBody.content['application/json'].schema)
    ),
    read: createValidator<ReadContext>(validateResourceParams),
    update:
      updateBody?.content['application/json'].schema &&
      createValidator<UpdateContext<UpdateT>>(
        validateResourceParams,
        deps.ajv.compile<UpdateT>(updateBody.content['application/json'].schema)
      ),
    list: createValidator<ListContext>(
      deps.ajv.compile<ListParams>({
        allOf: [collectionParams, listParams]
      })
    )
  }
}
