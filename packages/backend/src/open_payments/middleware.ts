import Enforcer from 'openapi-enforcer'

import { AppContext } from '../app'

export function createValidationMiddleware() {
  return async (
    ctx: AppContext,
    next: () => Promise<unknown>
  ): Promise<void> => {
    try {
      const openapi = await Enforcer('./open-api-spec.yaml')

      // If the request is valid then the req object will contain the parsed and validated request.
      // If it is invalid then the error will contain details about what was wrong with the
      // request and these details are safe to return to the client that made the request.
      const [req, error] = openapi.request(
        ctx.request
        // {
        //   method: 'POST',
        //   path: '/tasks',
        //   // the body should be parsed by a JSON.parse() prior to passing in (if applicable).
        //   body: { task: 'Buy Milk', quantity: 2 }
        // }
      )

      if (error) {
        console.log(error)
        ctx.throw(400, 'Invalid request')
      } else {
        console.log(req)
      }
      await next()
    } catch (err) {
      console.log(err)
    }
  }
}
