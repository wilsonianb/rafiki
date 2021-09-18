import { v4 as uuid } from 'uuid'

import { BalanceService, BalanceError } from './service'
import { createTestServices, TestServices } from '../testsHelpers/services'

describe('Balance Service', (): void => {
  let balanceService: BalanceService
  let services: TestServices

  beforeAll(
    async (): Promise<void> => {
      services = createTestServices()
      balanceService = services.balanceService
    }
  )

  afterAll(
    async (): Promise<void> => {
      services.shutdown()
    }
  )

  describe('Balance', (): void => {
    test('A balance can be created and fetched', async (): Promise<void> => {
      const balances = [
        {
          id: uuid(),
          unit: 1
        },
        {
          id: uuid(),
          unit: 2,
          debitBalance: false
        },
        {
          id: uuid(),
          unit: 2,
          debitBalance: true
        }
      ]
      await expect(balanceService.create(balances)).resolves.toBeUndefined()
      const retrievedBalances = await balanceService.get(
        balances.map(({ id }) => id)
      )
      expect(retrievedBalances).toEqual(
        balances.map((balance) => ({
          ...balance,
          balance: 0n,
          debitBalance: !!balance.debitBalance
        }))
      )
    })

    test('Cannot create duplicate balance', async (): Promise<void> => {
      const id = uuid()
      const balances = [
        {
          id,
          unit: 1
        },
        {
          id,
          unit: 1
        },
        {
          id,
          unit: 2
        }
      ]
      await expect(balanceService.create(balances)).resolves.toEqual({
        index: 1,
        error: BalanceError.DuplicateBalance
      })
      await expect(balanceService.get([id])).resolves.toHaveLength(0)

      const balance = balances[0]
      await expect(balanceService.create([balance])).resolves.toBeUndefined()
      await expect(balanceService.get([id])).resolves.toHaveLength(1)
      await expect(balanceService.create([balance])).resolves.toEqual({
        index: 0,
        error: BalanceError.DuplicateBalance
      })
    })
  })
})
