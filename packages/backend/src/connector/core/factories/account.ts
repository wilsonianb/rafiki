import { Factory } from 'rosie'
import Faker from 'faker'
import {
  MockIncomingAccount,
  MockOutgoingAccount
} from '../test/mocks/accounting-service'

const assetCode = Faker.finance.currencyCode().toString().toUpperCase()
const assetScale = Faker.datatype.number(6)

const accountAttrs = {
  id: Faker.datatype.uuid,
  asset: { code: assetCode, scale: assetScale, unit: Faker.datatype.number() },
  balance: 0n
}

const outgoingAttrs = {
  ...accountAttrs,
  handlePayment: () => () => Promise.resolve()
}

export const IncomingAccountFactory = Factory.define<MockIncomingAccount>(
  'IncomingAccountFactory'
).attrs(accountAttrs)

export const OutgoingAccountFactory = Factory.define<MockOutgoingAccount>(
  'OutgoingAccountFactory'
).attrs(outgoingAttrs)

export const IncomingPeerFactory = Factory.define<MockIncomingAccount>(
  'IncomingPeerFactory'
)
  .extend(IncomingAccountFactory)
  .attrs({
    http: () => ({
      incoming: {
        authTokens: [Faker.datatype.string(32)]
      }
    }),
    maxPacketAmount: BigInt(Faker.datatype.number())
  })
  .attr('staticIlpAddress', ['id'], (id: string) => {
    return `test.${id}`
  })

export const OutgoingPeerFactory = Factory.define<MockOutgoingAccount>(
  'OutgoingPeerFactory'
)
  .extend(OutgoingAccountFactory)
  .attrs({
    http: () => ({
      outgoing: {
        authToken: Faker.datatype.string(32),
        endpoint: Faker.internet.url()
      }
    })
  })
  .attr('staticIlpAddress', ['id'], (id: string) => {
    return `test.${id}`
  })

export const InvoiceAccountFactory = Factory.define<MockOutgoingAccount>(
  'InvoiceAccountFactory'
)
  .extend(OutgoingAccountFactory)
  .option('amount', BigInt(0))
  .attrs({
    active: true
  })

export const AccountFactory = Factory.define<MockOutgoingAccount>(
  'AccountFactory'
).extend(OutgoingAccountFactory)
