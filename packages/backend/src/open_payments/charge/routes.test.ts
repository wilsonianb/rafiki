import assert from 'assert'
import * as httpMocks from 'node-mocks-http'
import Knex from 'knex'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'
import { v4 as uuid } from 'uuid'

import { createContext } from '../../tests/context'
import { isCreateError } from '../mandate/errors'
import { MandateService } from '../mandate/service'
import { CreateError } from '../../outgoing_payment/errors'
import { PaymentState } from '../../outgoing_payment/model'
import { OutgoingPaymentService } from '../../outgoing_payment/service'
import { createTestApp, TestContainer } from '../../tests/app'
import { resetGraphileDb } from '../../tests/graphileDb'
import { GraphileProducer } from '../../messaging/graphileProducer'
import { Config, IAppConfig } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { PaymentFactory } from '../../tests/paymentFactory'
import { truncateTables } from '../../tests/tableManager'
import { randomAsset } from '../../tests/asset'
import { ChargeRoutes } from './routes'
import { AppContext } from '../../app'

describe('Charge Routes', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let workerUtils: WorkerUtils
  let mandateService: MandateService
  let outgoingPaymentService: OutgoingPaymentService
  let config: IAppConfig
  let chargeRoutes: ChargeRoutes
  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }

  beforeAll(
    async (): Promise<void> => {
      config = Config
      config.publicHost = 'https://wallet.example'
      deps = await initIocContainer(config)
      deps.bind('messageProducer', async () => mockMessageProducer)
      appContainer = await createTestApp(deps)
      workerUtils = await makeWorkerUtils({
        connectionString: appContainer.connectionUrl
      })
      await workerUtils.migrate()
      messageProducer.setUtils(workerUtils)
      knex = await deps.use('knex')
    }
  )

  const { code: assetCode, scale: assetScale } = randomAsset()
  let mandateId: string

  beforeEach(
    async (): Promise<void> => {
      mandateService = await deps.use('mandateService')
      outgoingPaymentService = await deps.use('outgoingPaymentService')
      config = await deps.use('config')
      chargeRoutes = await deps.use('chargeRoutes')

      const accountService = await deps.use('accountService')
      const { id: accountId } = await accountService.create({
        asset: randomAsset()
      })
      const mandate = await mandateService.create({
        accountId,
        amount: BigInt(100),
        assetCode,
        assetScale
      })
      assert.ok(!isCreateError(mandate))
      mandateId = mandate.id
    }
  )

  afterEach(
    async (): Promise<void> => {
      jest.restoreAllMocks()
      await truncateTables(knex)
    }
  )

  afterAll(
    async (): Promise<void> => {
      await resetGraphileDb(knex)
      await appContainer.shutdown()
      await workerUtils.release()
    }
  )

  describe('get', (): void => {
    let chargeId: string
    const invoice = 'http://wallet2.example/bob'

    beforeEach(
      async (): Promise<void> => {
        const paymentFactory = new PaymentFactory(deps)
        chargeId = (
          await paymentFactory.build({
            mandateId,
            invoiceUrl: invoice
          })
        ).id
      }
    )

    test('returns error on invalid id', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { chargeId: 'not_a_uuid' }
      )
      await expect(chargeRoutes.get(ctx)).rejects.toHaveProperty(
        'message',
        'invalid id'
      )
    })

    test('returns 406 for wrong Accept', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'test/plain' }
        },
        { chargeId: uuid() }
      )
      await expect(chargeRoutes.get(ctx)).rejects.toHaveProperty('status', 406)
    })

    test('returns 404 for nonexistent charge', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { chargeId: uuid() }
      )
      await expect(chargeRoutes.get(ctx)).rejects.toHaveProperty('status', 404)
    })

    test('returns 200 with an open payments charge', async (): Promise<void> => {
      const ctx = createContext(
        {
          headers: { Accept: 'application/json' }
        },
        { chargeId }
      )
      await expect(chargeRoutes.get(ctx)).resolves.toBeUndefined()
      expect(ctx.status).toBe(200)
      expect(ctx.response.get('Content-Type')).toBe(
        'application/json; charset=utf-8'
      )
      expect(ctx.body).toEqual({
        id: `https://wallet.example/charges/${chargeId}`,
        mandate: `https://wallet.example/mandates/${mandateId}`,
        invoice,
        status: PaymentState.Quoting
      })
    })
  })

  describe('create', (): void => {
    const invoice = 'http://wallet2.example/bob'

    function setup(
      reqOpts: Pick<httpMocks.RequestOptions, 'headers'>
    ): AppContext {
      const ctx = createContext(
        {
          headers: Object.assign(
            { Accept: 'application/json', 'Content-Type': 'application/json' },
            reqOpts.headers
          )
        },
        { mandateId }
      )
      ctx.request.body = {
        invoice
      }
      return ctx
    }

    test('returns error on invalid mandate id', async (): Promise<void> => {
      const ctx = setup({})
      ctx.params.mandateId = 'not_a_uuid'
      await expect(chargeRoutes.create(ctx)).rejects.toMatchObject({
        status: 400,
        message: 'invalid mandate id'
      })
    })

    test('returns error on unknown mandate', async (): Promise<void> => {
      const ctx = setup({})
      ctx.params.mandateId = uuid()
      await expect(chargeRoutes.create(ctx)).rejects.toMatchObject({
        status: 400,
        message: 'unknown mandate'
      })
    })

    test('returns error on invalid mandate', async (): Promise<void> => {
      const ctx = setup({})
      jest
        .spyOn(outgoingPaymentService, 'create')
        .mockResolvedValueOnce(CreateError.InvalidMandate)
      await expect(chargeRoutes.create(ctx)).rejects.toMatchObject({
        status: 400,
        message: 'invalid mandate'
      })
    })

    test('returns 406 on invalid Accept', async (): Promise<void> => {
      const ctx = setup({ headers: { Accept: 'text/plain' } })
      await expect(chargeRoutes.create(ctx)).rejects.toHaveProperty(
        'status',
        406
      )
    })

    test('returns error on invalid Content-Type', async (): Promise<void> => {
      const ctx = setup({ headers: { 'Content-Type': 'text/plain' } })
      await expect(chargeRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'must send json body'
      )
    })

    test('returns error on missing invoice', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['invoice'] = undefined
      await expect(chargeRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid invoice'
      )
    })

    test('returns error on invalid invoice', async (): Promise<void> => {
      const ctx = setup({})
      ctx.request.body['invoice'] = 123
      await expect(chargeRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'invalid invoice'
      )
    })

    test('returns the charge on success', async (): Promise<void> => {
      const paymentFactory = new PaymentFactory(deps)
      const charge = await paymentFactory.build({
        mandateId,
        invoiceUrl: invoice
      })
      jest.spyOn(outgoingPaymentService, 'create').mockResolvedValueOnce(charge)
      const ctx = setup({})
      await expect(chargeRoutes.create(ctx)).resolves.toBeUndefined()
      expect(ctx.response.status).toBe(201)
      expect(ctx.response.headers['location']).toBe(
        `${config.publicHost}/charges/${charge.id}`
      )
      expect(ctx.response.body).toEqual({
        id: `${config.publicHost}/charges/${charge.id}`,
        mandate: `${config.publicHost}/mandates/${mandateId}`,
        invoice,
        status: PaymentState.Quoting
      })
    })
  })
})
