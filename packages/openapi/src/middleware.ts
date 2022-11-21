import { OpenAPI, RequestOptions, isValidationError } from './'

import Koa from 'koa'

export function createValidatorMiddleware<T extends Koa.ParameterizedContext>(
  spec: OpenAPI,
  options: RequestOptions
): (ctx: Koa.Context, next: () => Promise<unknown>) => Promise<void> {
  const validateRequest = spec.createRequestValidator<T['request']>(options)
  const validateResponse =
    process.env.NODE_ENV !== 'production' &&
    spec.createResponseValidator(options)

  return async (
    ctx: Koa.Context,
    next: () => Promise<unknown>
  ): Promise<void> => {
    ctx.assert(ctx.accepts('application/json'), 406, 'must accept json')
    try {
      if (validateRequest(ctx.request)) {
        await next()
        if (validateResponse && !validateResponse(ctx.response)) {
          throw new Error('unreachable')
        }
      } else {
        throw new Error('unreachable')
      }
    } catch (err) {
      if (err instanceof Koa.HttpError) {
        ctx.throw(err.status, err.message)
      } else if (isValidationError(err)) {
        ctx.throw(err.status ?? 500, err.errors[0])
      } else {
        ctx.throw(500)
      }
    }
  }
}
