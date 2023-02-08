import { AppContext } from '../../app'

export function createPaymentPointerMiddleware() {
  return async (
    ctx: AppContext,
    next: () => Promise<unknown>
  ): Promise<void> => {
    ctx.state.paymentPointerUrl = `https://${ctx.request.host}/${ctx.params.paymentPointerPath}`
    const config = await ctx.container.use('config')
    if (ctx.state.paymentPointerUrl !== config.paymentPointerUrl) {
      const paymentPointerService = await ctx.container.use(
        'paymentPointerService'
      )
      const paymentPointer = await paymentPointerService.getByUrl(
        ctx.state.paymentPointerUrl
      )
      if (!paymentPointer) {
        ctx.throw(404)
      }
      ctx.state.paymentPointer = paymentPointer
    }
    await next()
  }
}
