import { Errors } from 'ilp-packet'
import { createContext } from '../../utils'
import { RafikiContext } from '../..'
import {
  IlpRejectFactory,
  IlpFulfillFactory,
  PeerAccountFactory,
  RafikiServicesFactory
} from '../../factories'
import { createOutgoingLiquidityCheckMiddleware } from '../../middleware/liquidity-check'
const { T04_INSUFFICIENT_LIQUIDITY } = Errors.codes

describe('Liquidity Check Middleware', function () {
  const services = RafikiServicesFactory.build()
  const alice = PeerAccountFactory.build({ id: 'alice' })
  const bob = PeerAccountFactory.build({ id: 'bob' })
  const ctx = createContext<unknown, RafikiContext>()
  ctx.services = services
  ctx.accounts = {
    get incoming() {
      return alice
    },
    get outgoing() {
      return bob
    }
  }
  const middleware = createOutgoingLiquidityCheckMiddleware()

  beforeEach(() => {
    ctx.response.reject = undefined
    ctx.response.fulfill = undefined
  })

  test('logs error for T04 rejects that are due to maximum balance exceeded', async () => {
    const T04Reject = IlpRejectFactory.build({
      code: T04_INSUFFICIENT_LIQUIDITY,
      message: 'exceeded maximum balance.',
      triggeredBy: 'test.rafiki.bob'
    })
    const next = jest.fn().mockImplementation(async () => {
      ctx.response.reject = T04Reject
    })

    await expect(middleware(ctx, next)).resolves.toBeUndefined()

    expect(services.logger.error).toHaveBeenCalledWith(
      'Liquidity Check Error',
      {
        peerId: 'bob',
        triggerBy: 'test.rafiki.bob',
        message: 'exceeded maximum balance.'
      }
    )
  })

  test('does not log error for T04 rejects that are not due to maximum balance exceeded', async () => {
    const T04Reject = IlpRejectFactory.build({
      code: T04_INSUFFICIENT_LIQUIDITY,
      message: 'not a max balance error',
      triggeredBy: 'test.rafiki.bob'
    })
    const next = jest.fn().mockImplementation(async () => {
      ctx.response.reject = T04Reject
    })

    await expect(middleware(ctx, next)).resolves.toBeUndefined()

    expect(services.logger.error).toBeCalledTimes(0)
  })

  test('does not log error if response is a fulfill', async () => {
    const fulfill = IlpFulfillFactory.build()
    const next = jest.fn().mockImplementation(async () => {
      ctx.response.fulfill = fulfill
    })

    await expect(middleware(ctx, next)).resolves.toBeUndefined()

    expect(services.logger.error).toBeCalledTimes(0)
  })
  test('does not log error if response is a not a T04 reject', async () => {
    const T04Reject = IlpRejectFactory.build({
      code: 'F01',
      message: 'peer unreachable.',
      triggeredBy: 'test.rafiki.bob'
    })
    const next = jest.fn().mockImplementation(async () => {
      ctx.response.reject = T04Reject
    })

    await expect(middleware(ctx, next)).resolves.toBeUndefined()

    expect(services.logger.error).toBeCalledTimes(0)
  })
})
