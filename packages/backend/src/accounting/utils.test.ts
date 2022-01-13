import { v4 as uuid } from 'uuid'

import { uuidToBigInt, bigIntToUuid } from './utils'

describe('Accounting utils', (): void => {
  describe('uuidToBigInt / bigIntToUuid', (): void => {
    test('Can convert between uuid and bigint', async (): Promise<void> => {
      const id = uuid()
      expect(bigIntToUuid(uuidToBigInt(id))).toEqual(id)
    })
  })
})
