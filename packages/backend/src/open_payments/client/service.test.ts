import { IocContract } from '@adonisjs/fold'
import { faker } from '@faker-js/faker'
import { Knex } from 'knex'
import nock from 'nock'
import { URL } from 'url'
import { v4 as uuid } from 'uuid'

import { OpenPaymentsClientService } from './service'
import { createTestApp, TestContainer } from '../../tests/app'
import { Config } from '../../config/app'
import { initIocContainer } from '../..'
import { AppServices } from '../../app'
import { createIncomingPayment } from '../../tests/incomingPayment'
import { createPaymentPointer } from '../../tests/paymentPointer'
import { truncateTables } from '../../tests/tableManager'

describe('Open Payments Client Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let clientService: OpenPaymentsClientService
  let knex: Knex

  beforeAll(async (): Promise<void> => {
    deps = await initIocContainer(Config)
    appContainer = await createTestApp(deps)
    clientService = await deps.use('openPaymentsClientService')
    knex = await deps.use('knex')
  })

  afterEach(async (): Promise<void> => {
    jest.useRealTimers()
    await truncateTables(knex)
  })

  afterAll(async (): Promise<void> => {
    await appContainer.shutdown()
  })
  describe('incomingPayment.get', (): void => {
    test.each`
      incomingAmount | description  | externalRef
      ${undefined}   | ${undefined} | ${undefined}
      ${BigInt(123)} | ${'Test'}    | ${'#123'}
    `(
      'resolves incoming payment from Open Payments server',
      async ({ incomingAmount, description, externalRef }): Promise<void> => {
        const paymentPointer = await createPaymentPointer(deps, {
          mockServerPort: appContainer.openPaymentsPort
        })
        const incomingPayment = await createIncomingPayment(deps, {
          paymentPointerId: paymentPointer.id,
          description,
          incomingAmount: incomingAmount && {
            value: incomingAmount,
            assetCode: paymentPointer.asset.code,
            assetScale: paymentPointer.asset.scale
          },
          externalRef
        })
        const resolvedPayment = await clientService.incomingPayment.get(
          incomingPayment.url
        )
        paymentPointer.scope.isDone()
        expect(resolvedPayment).toEqual({
          ...incomingPayment.toJSON(),
          id: incomingPayment.url,
          paymentPointer: incomingPayment.paymentPointer.url,
          ilpStreamConnection: {
            id: `${Config.publicHost}/connections/${incomingPayment.connectionId}`,
            ilpAddress: expect.any(String),
            sharedSecret: expect.any(String),
            assetCode: incomingPayment.asset.code,
            assetScale: incomingPayment.asset.scale
          }
        })
      }
    )
    test.each`
      statusCode
      ${404}
      ${500}
    `(
      'returns undefined for unsuccessful request ($statusCode)',
      async ({ statusCode }): Promise<void> => {
        const incomingPaymentUrl = new URL(
          `${faker.internet.url()}/incoming-payments/${uuid()}`
        )
        const scope = nock(incomingPaymentUrl.host)
          .get(incomingPaymentUrl.pathname)
          .reply(statusCode)
        scope.isDone()
        await expect(
          clientService.incomingPayment.get(incomingPaymentUrl.href)
        ).resolves.toBeUndefined()
      }
    )
    test('returns undefined for invalid incoming payment response', async (): Promise<void> => {
      const incomingPaymentUrl = new URL(
        `${faker.internet.url()}/incoming-payments/${uuid()}`
      )
      const scope = nock(incomingPaymentUrl.host)
        .get(incomingPaymentUrl.pathname)
        .reply(200, () => ({
          validPayment: 0
        }))
      scope.isDone()
      await expect(
        clientService.incomingPayment.get(incomingPaymentUrl.href)
      ).resolves.toBeUndefined()
    })
  })
})
