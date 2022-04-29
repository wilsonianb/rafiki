import assert from 'assert'
import Ajv2020, { ValidateFunction } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { convertParametersToJSONSchema } from 'openapi-jsonschema-parameters'
import { OpenAPIV3, OpenAPIV3_1, IJsonSchema } from 'openapi-types'

import { AppContext } from '../app'

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

type Response<T> = Omit<AppContext['response'], 'body'> & {
  body: T
}

type ResponseContext<T> = Omit<AppContext, 'response'> & {
  body: T
  response: Response<T>
}

export interface RequestValidators<CreateT, UpdateT = unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(ctx: any): ctx is CreateContext<CreateT>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  read(ctx: any): ctx is ReadContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update?(ctx: any): ctx is UpdateContext<UpdateT>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  list(ctx: any): ctx is ListContext
}

export interface ResponseValidators<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(ctx: any): ctx is ResponseContext<T>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  read(ctx: any): ctx is ResponseContext<T>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update?(ctx: any): ctx is ResponseContext<T>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  list(ctx: any): ctx is ResponseContext<T[]>
}

const ajv = new Ajv2020()
addFormats(ajv)
ajv.addFormat('uint64', (x) => {
  try {
    const value = BigInt(x)
    return value >= BigInt(0)
  } catch (e) {
    return false
  }
})

function createRequestValidator<T>(
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

export function createRequestValidators<CreateT, UpdateT = unknown>(
  openApi: OpenAPIV3_1.Document,
  path: string
): RequestValidators<CreateT, UpdateT> {
  const collectionPath = openApi.paths?.[path]
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

  const resourcePath = openApi.paths?.[`${path}/{id}`]
  assert.ok(resourcePath?.parameters)
  const params = getParametersSchema(
    resourcePath.parameters as OpenAPIV3_1.ParameterObject[]
  )

  const validateResourceParams = ajv.compile<ResourceParams>(params)

  const updateBody = resourcePath[OpenAPIV3.HttpMethods.PUT]
    ?.requestBody as OpenAPIV3_1.RequestBodyObject

  return {
    create: createRequestValidator<CreateContext<CreateT>>(
      ajv.compile<CollectionParams>(collectionParams),
      ajv.compile<CreateT>(createBody.content['application/json'].schema)
    ),
    read: createRequestValidator<ReadContext>(validateResourceParams),
    update:
      updateBody?.content['application/json'].schema &&
      createRequestValidator<UpdateContext<UpdateT>>(
        validateResourceParams,
        ajv.compile<UpdateT>(updateBody.content['application/json'].schema)
      ),
    list: createRequestValidator<ListContext>(
      ajv.compile<ListParams>({
        allOf: [collectionParams, listParams]
      })
    )
  }
}

function createResponseValidator<T>(responses: OpenAPIV3_1.ResponsesObject) {
  const code = Object.keys(responses).find((code) => code.startsWith('20'))
  assert.ok(code)
  const bodySchema = (responses[code] as OpenAPIV3_1.ResponseObject).content?.[
    'application/json'
  ].schema
  assert.ok(bodySchema)
  const validateBody = ajv.compile<T>(bodySchema)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ctx: any): ctx is ResponseContext<T> => {
    assert.equal(ctx.status.toString(), code)
    assert.equal(
      ctx.response.get('Content-Type'),
      'application/json; charset=utf-8'
    )
    if (!validateBody(ctx.response.body)) {
      const error = validateBody.errors?.[0]
      throw `${error?.instancePath.slice(1).replace('/', '.')} ${
        error?.message
      }`
    }
    return true
  }
}

export function createResponseValidators<T>(
  openApi: OpenAPIV3_1.Document,
  path: string
): ResponseValidators<T> {
  const collectionPath = openApi.paths?.[path]
  assert.ok(collectionPath)

  const resourcePath = openApi.paths?.[`${path}/{id}`]
  assert.ok(resourcePath)

  const createResponses = collectionPath[OpenAPIV3.HttpMethods.POST]?.responses
  assert.ok(createResponses)

  const readResponses = resourcePath[OpenAPIV3.HttpMethods.GET]?.responses
  assert.ok(readResponses)

  const updateResponses = resourcePath[OpenAPIV3.HttpMethods.PUT]
    ?.responses as OpenAPIV3_1.ResponsesObject

  const listResponses = collectionPath[OpenAPIV3.HttpMethods.GET]?.responses
  assert.ok(listResponses)

  return {
    create: createResponseValidator<T>(createResponses),
    read: createResponseValidator<T>(readResponses),
    update: updateResponses && createResponseValidator<T>(updateResponses),
    list: createResponseValidator<T[]>(listResponses)
  }
}
