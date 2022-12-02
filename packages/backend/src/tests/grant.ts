import { faker } from '@faker-js/faker'
import { v4 as uuid } from 'uuid'

import {
  AccessAction,
  AccessType,
  Grant,
  GrantOptions
} from '../open_payments/auth/grant'

export const mockGrant = (overrides?: Partial<GrantOptions>): Grant =>
  new Grant({
    grant: uuid(),
    client: faker.internet.url(),
    access: [
      {
        type: AccessType.IncomingPayment,
        actions: [AccessAction.ReadAll]
      }
    ],
    ...overrides
  })
