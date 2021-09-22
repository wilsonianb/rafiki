import { createContext } from '../../utils'
import { RafikiContext, ZeroCopyIlpPrepare } from '../..'
import { createBalanceMiddleware } from '../../middleware'
import {
  AccountFactory,
  IlpPrepareFactory,
  IlpFulfillFactory,
  IlpRejectFactory,
  RafikiServicesFactory
} from '../../factories'

// TODO: make one peer to many account relationship
const aliceAccount = AccountFactory.build({ id: 'alice' })
const bobAccount = AccountFactory.build({ id: 'bob' })
const services = RafikiServicesFactory.build({})
const ctx = createContext<unknown, RafikiContext>()
ctx.accounts = {
  get incoming() {
    return aliceAccount
  },
  get outgoing() {
    return bobAccount
  }
}
ctx.services = services
const { accounts } = services

beforeEach(async () => {
  ctx.response.fulfill = undefined
  ctx.response.reject = undefined

  aliceAccount.balance = 100n
  bobAccount.balance = 0n

  await accounts.create(aliceAccount)
  await accounts.create(bobAccount)
})

describe('Balance Middleware', function () {
  const middleware = createBalanceMiddleware()

  it('fulfill response increments the balanceReceivable for the incoming peer and balancePayable for the outgoing peer', async () => {
    const prepare = IlpPrepareFactory.build({ amount: '100' })
    const fulfill = IlpFulfillFactory.build()
    ctx.request.prepare = new ZeroCopyIlpPrepare(prepare)
    const next = jest.fn().mockImplementation(() => {
      ctx.response.fulfill = fulfill
    })

    await expect(middleware(ctx, next)).resolves.toBeUndefined()

    const aliceBalance = await accounts.getBalance(aliceAccount.id)
    expect(aliceBalance).toEqual(BigInt(0))

    const bobBalance = await accounts.getBalance(bobAccount.id)
    expect(bobBalance).toEqual(BigInt(100))
  })

  test('reject response does not adjust the account balances', async () => {
    const prepare = IlpPrepareFactory.build({ amount: '100' })
    const reject = IlpRejectFactory.build()
    ctx.request.prepare = new ZeroCopyIlpPrepare(prepare)
    const next = jest.fn().mockImplementation(() => {
      ctx.response.reject = reject
    })

    await expect(middleware(ctx, next)).resolves.toBeUndefined()

    const aliceBalance = await accounts.getBalance(aliceAccount.id)
    expect(aliceBalance).toEqual(BigInt(100))

    const bobBalance = await accounts.getBalance(bobAccount.id)
    expect(bobBalance).toEqual(BigInt(0))
  })

  test('ignores 0 amount packets', async () => {
    const transferFundsSpy = jest.spyOn(services.transferService, 'create')
    const prepare = IlpPrepareFactory.build({ amount: '0' })
    const reject = IlpRejectFactory.build()
    ctx.request.prepare = new ZeroCopyIlpPrepare(prepare)
    const next = jest.fn().mockImplementation(() => {
      ctx.response.reject = reject
    })

    await expect(middleware(ctx, next)).resolves.toBeUndefined()

    const aliceBalance = await accounts.getBalance(aliceAccount.id)
    expect(aliceBalance).toEqual(BigInt(100))

    const bobBalance = await accounts.getBalance(bobAccount.id)
    expect(bobBalance).toEqual(BigInt(0))

    expect(transferFundsSpy).toHaveBeenCalledTimes(0)
  })

  test('insufficient balance does not adjust the account balances', async () => {
    const prepare = IlpPrepareFactory.build({ amount: '200' })
    const reject = IlpRejectFactory.build()
    ctx.request.prepare = new ZeroCopyIlpPrepare(prepare)
    const next = jest.fn().mockImplementation(() => {
      ctx.response.reject = reject
    })

    await expect(middleware(ctx, next)).resolves.toBeUndefined()

    const aliceBalance = await accounts.getBalance(aliceAccount.id)
    expect(aliceBalance).toEqual(BigInt(100))

    const bobBalance = await accounts.getBalance(bobAccount.id)
    expect(bobBalance).toEqual(BigInt(0))
  })
})
