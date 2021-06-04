import { Factory } from 'rosie'
import Faker from 'faker'
import { CreateOptions } from '../services'

const assetCode = Faker.finance.currencyCode().toString().toUpperCase()
const assetScale = Faker.datatype.number(6)

type MockIlpAccount = CreateOptions & { balance: bigint }
export const AccountFactory = Factory.define<MockIlpAccount>(
  'AccountFactory'
).attrs({
  accountId: Faker.datatype.uuid,
  disabled: false,
  asset: { code: assetCode, scale: assetScale },
  balance: 0n
})

export const PeerAccountFactory = Factory.define<MockIlpAccount>(
  'PeerAccountFactory'
)
  .extend(AccountFactory)
  .attrs({
    http: () => ({
      incoming: {
        authTokens: [Faker.datatype.string(32)]
      },
      outgoing: {
        authToken: Faker.datatype.string(32),
        endpoint: Faker.internet.url()
      }
    })
  })
  .attr('routing', ['accountId'], (id: string) => {
    return {
      staticIlpAddress: `test.${id}`
    }
  })
