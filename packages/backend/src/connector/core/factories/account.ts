import { Factory } from 'rosie'
import Faker from 'faker'
import {
  MockAccountingService,
  MockAccount,
  MockInvoice,
  MockPayment,
  MockPeer
} from '../test/mocks/accounting-service'
import { Asset } from '../../../asset/model'

const assetCode = Faker.finance.currencyCode().toString().toUpperCase()
const assetScale = Faker.datatype.number(6)

const accountAttrs = {
  id: Faker.datatype.uuid,
  asset: ({
    id: Faker.datatype.uuid,
    code: assetCode,
    scale: assetScale,
    unit: Faker.datatype.number()
  } as unknown) as Asset,
  balance: 0n
}

const outgoingAttrs = {
  ...accountAttrs,
  handlePayment: (_accountingService: MockAccountingService) =>
    Promise.resolve(undefined)
}

export const OutgoingPeerFactory = Factory.define<MockPeer>(
  'OutgoingPeerFactory'
)
  .attrs(outgoingAttrs)
  .attr('http', {
    outgoing: {
      authToken: Faker.datatype.string(32),
      endpoint: Faker.internet.url()
    }
  })
  .attr('staticIlpAddress', ['id'], (id: string) => {
    return `test.${id}`
  })

export const IncomingPeerFactory = Factory.define<MockPeer>(
  'IncomingPeerFactory'
)
  .extend(OutgoingPeerFactory)
  .attrs({
    incomingAuthToken: Faker.datatype.string(32),
    maxPacketAmount: BigInt(Faker.datatype.number())
  })

export const InvoiceFactory = Factory.define<MockInvoice>('InvoiceFactory')
  .attrs(outgoingAttrs)
  .option('amount', BigInt(0))
  .attrs({
    active: true
  })

export const AccountFactory = Factory.define<MockAccount>(
  'AccountFactory'
).attrs(outgoingAttrs)

export const PaymentFactory = Factory.define<MockPayment>(
  'PaymentFactory'
).attrs(accountAttrs)
