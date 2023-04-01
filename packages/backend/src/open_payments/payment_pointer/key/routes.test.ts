import jestOpenAPI from 'jest-openapi'
import { generateJwk } from '@interledger/http-signature-utils'
import { v4 as uuid } from 'uuid'

import { createContext } from '../../../tests/context'
import { createTestApp, TestContainer } from '../../../tests/app'
import { Config } from '../../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../..'
import { AppServices, PaymentPointerKeysContext } from '../../../app'
import { truncateTables } from '../../../tests/tableManager'
import { PaymentPointerKeyRoutes } from './routes'
import { PaymentPointerKeyService } from './service'
import { createPaymentPointer } from '../../../tests/paymentPointer'

const TEST_KEY = generateJwk({ keyId: uuid() })

describe('Payment Pointer Keys Routes', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let paymentPointerKeyService: PaymentPointerKeyService
  let paymentPointerKeyRoutes: PaymentPointerKeyRoutes
  const mockMessageProducer = {
    send: jest.fn()
  }

  beforeAll(async (): Promise<void> => {
    deps = await initIocContainer(Config)
    deps.bind('messageProducer', async () => mockMessageProducer)
    appContainer = await createTestApp(deps)
    const { resourceServerSpec } = await deps.use('openApi')
    jestOpenAPI(resourceServerSpec)
    paymentPointerKeyService = await deps.use('paymentPointerKeyService')
  })

  beforeEach(async (): Promise<void> => {
    paymentPointerKeyRoutes = await deps.use('paymentPointerKeyRoutes')
  })

  afterEach(async (): Promise<void> => {
    await truncateTables(appContainer.knex)
  })

  afterAll(async (): Promise<void> => {
    await appContainer.shutdown()
  })

  describe('getKeys', (): void => {
    test('returns 200 with all keys for a payment pointer', async (): Promise<void> => {
      const paymentPointer = await createPaymentPointer(deps)

      const keyOption = {
        paymentPointerId: paymentPointer.id,
        jwk: TEST_KEY
      }
      const key = await paymentPointerKeyService.create(keyOption)

      const ctx = createContext<PaymentPointerKeysContext>({
        headers: { Accept: 'application/json' },
        url: `/jwks.json`
      })
      ctx.state.paymentPointer = paymentPointer
      ctx.state.paymentPointerUrl = paymentPointer.url

      await expect(
        paymentPointerKeyRoutes.getKeysByPaymentPointerId(ctx)
      ).resolves.toBeUndefined()
      expect(ctx.response).toSatisfyApiSpec()
      expect(ctx.body).toEqual({
        keys: [key.jwk]
      })
    })

    test('returns 200 with empty array if no keys for a payment pointer', async (): Promise<void> => {
      const paymentPointer = await createPaymentPointer(deps)

      const ctx = createContext<PaymentPointerKeysContext>({
        headers: { Accept: 'application/json' },
        url: `/jwks.json`
      })
      ctx.state.paymentPointer = paymentPointer
      ctx.state.paymentPointerUrl = paymentPointer.url

      await expect(
        paymentPointerKeyRoutes.getKeysByPaymentPointerId(ctx)
      ).resolves.toBeUndefined()
      expect(ctx.body).toEqual({
        keys: []
      })
    })

    test('returns 200 with backend key', async (): Promise<void> => {
      const config = await deps.use('config')
      const jwk = generateJwk({
        privateKey: config.privateKey,
        keyId: config.keyId
      })

      const ctx = createContext<PaymentPointerKeysContext>({
        headers: { Accept: 'application/json' },
        url: '/jwks.json'
      })
      ctx.state.paymentPointerUrl = config.paymentPointerUrl

      await expect(
        paymentPointerKeyRoutes.getKeysByPaymentPointerId(ctx)
      ).resolves.toBeUndefined()
      expect(ctx.body).toEqual({
        keys: [jwk]
      })
    })

    test('returns 404 if payment pointer does not exist', async (): Promise<void> => {
      const ctx = createContext<PaymentPointerKeysContext>({
        headers: { Accept: 'application/json' },
        url: `/jwks.json`
      })
      ctx.state.paymentPointer = undefined

      await expect(
        paymentPointerKeyRoutes.getKeysByPaymentPointerId(ctx)
      ).rejects.toHaveProperty('status', 404)
    })
  })
})
