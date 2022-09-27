import jestOpenAPI from 'jest-openapi'
import base64url from 'base64url'
import { Knex } from 'knex'
import { v4 as uuid } from 'uuid'

import { Amount } from '../../amount'
import { PaymentPointer } from '../../payment_pointer/model'
import { createTestApp, TestContainer } from '../../../tests/app'
import { Config, IAppConfig } from '../../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../..'
import {
  AppServices,
  ReadContext,
  CreateContext,
  CompleteContext,
  ListContext
} from '../../../app'
import { truncateTables } from '../../../tests/tableManager'
import { IncomingPayment, IncomingPaymentJSON } from './model'
import { IncomingPaymentRoutes, CreateBody, MAX_EXPIRY } from './routes'
import { createIncomingPayment } from '../../../tests/incomingPayment'
import { createPaymentPointer } from '../../../tests/paymentPointer'
import { listTests, setup } from '../../../shared/routes.test'
import { AccessAction, AccessType, Grant } from '../../auth/grant'
import { GrantReference as GrantModel } from '../../grantReference/model'

describe('Incoming Payment Routes', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let config: IAppConfig
  let incomingPaymentRoutes: IncomingPaymentRoutes

  beforeAll(async (): Promise<void> => {
    config = Config
    deps = await initIocContainer(config)
    appContainer = await createTestApp(deps)
    knex = await deps.use('knex')
    jestOpenAPI(await deps.use('openApi'))
  })

  const asset = {
    code: 'USD',
    scale: 2
  }
  let paymentPointer: PaymentPointer
  let expiresAt: Date
  let incomingAmount: Amount
  let description: string
  let externalRef: string
  let grantRef: GrantModel

  beforeEach(async (): Promise<void> => {
    config = await deps.use('config')
    incomingPaymentRoutes = await deps.use('incomingPaymentRoutes')

    expiresAt = new Date(Date.now() + 30_000)
    paymentPointer = await createPaymentPointer(deps, {
      asset
    })
    incomingAmount = {
      value: BigInt('123'),
      assetScale: asset.scale,
      assetCode: asset.code
    }
    description = 'hello world'
    externalRef = '#123'
    grantRef = await GrantModel.query().insert({
      id: uuid(),
      clientId: uuid()
    })
  })

  afterEach(async (): Promise<void> => {
    await truncateTables(knex)
  })

  afterAll(async (): Promise<void> => {
    await appContainer.shutdown()
  })

  describe('get', (): void => {
    let incomingPayment: IncomingPayment
    let grant: Grant
    beforeEach(async (): Promise<void> => {
      incomingPayment = await createIncomingPayment(deps, {
        paymentPointerId: paymentPointer.id,
        grantId: grantRef.id,
        description,
        expiresAt,
        incomingAmount,
        externalRef
      })
      grant = new Grant({
        active: true,
        grant: grantRef.id,
        clientId: grantRef.clientId,
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.Read]
          }
        ]
      })
    })

    describe.each`
      withGrant | description
      ${false}  | ${'without grant'}
      ${true}   | ${'with grant'}
    `('$description', ({ withGrant }): void => {
      test.each`
        id           | clientId     | paymentPointerId | description
        ${uuid()}    | ${undefined} | ${undefined}     | ${'unknown incoming payment'}
        ${undefined} | ${uuid()}    | ${undefined}     | ${'conflicting clientId'}
        ${undefined} | ${undefined} | ${uuid()}        | ${'conflicting payment pointer'}
      `(
        'returns 404 on $description',
        async ({ id, clientId, paymentPointerId }): Promise<void> => {
          if (clientId) {
            grant = new Grant({
              ...grant,
              clientId
            })
          }
          if (paymentPointerId) {
            paymentPointer.id = paymentPointerId
          }
          const ctx = setup<ReadContext>({
            reqOpts: {
              headers: { Accept: 'application/json' }
            },
            params: {
              id: id || incomingPayment.id
            },
            paymentPointer,
            grant: withGrant || clientId ? grant : undefined
          })
          await expect(incomingPaymentRoutes.get(ctx)).rejects.toMatchObject({
            status: 404,
            message: 'Not Found'
          })
        }
      )

      test('returns 200 with an open payments incoming payment', async (): Promise<void> => {
        const ctx = setup<ReadContext>({
          reqOpts: {
            headers: { Accept: 'application/json' },
            method: 'GET',
            url: `/incoming-payments/${incomingPayment.id}`
          },
          params: {
            id: incomingPayment.id
          },
          paymentPointer,
          grant: withGrant ? grant : undefined
        })
        await expect(incomingPaymentRoutes.get(ctx)).resolves.toBeUndefined()
        expect(ctx.response).toSatisfyApiSpec()

        const sharedSecret = (
          (ctx.response.body as Record<string, unknown>)[
            'ilpStreamConnection'
          ] as Record<string, unknown>
        )['sharedSecret']

        expect(ctx.body).toEqual({
          id: incomingPayment.url,
          paymentPointer: paymentPointer.url,
          completed: false,
          incomingAmount: {
            value: '123',
            assetCode: asset.code,
            assetScale: asset.scale
          },
          description: incomingPayment.description,
          expiresAt: expiresAt.toISOString(),
          createdAt: incomingPayment.createdAt.toISOString(),
          updatedAt: incomingPayment.updatedAt.toISOString(),
          receivedAmount: {
            value: '0',
            assetCode: asset.code,
            assetScale: asset.scale
          },
          externalRef: '#123',
          ilpStreamConnection: {
            id: `${config.openPaymentsUrl}/connections/${incomingPayment.connectionId}`,
            ilpAddress: expect.stringMatching(
              /^test\.rafiki\.[a-zA-Z0-9_-]{95}$/
            ),
            sharedSecret,
            assetCode: asset.code,
            assetScale: asset.scale
          }
        })
        const sharedSecretBuffer = Buffer.from(sharedSecret as string, 'base64')
        expect(sharedSecretBuffer).toHaveLength(32)
        expect(sharedSecret).toEqual(base64url(sharedSecretBuffer))
      })
    })
  })
  describe.each`
    withGrant | description
    ${false}  | ${'without grant'}
    ${true}   | ${'with grant'}
  `('create - $description', ({ withGrant }): void => {
    test('returns error on distant-future expiresAt', async (): Promise<void> => {
      const ctx = setup<CreateContext<CreateBody>>({
        reqOpts: { body: {} },
        paymentPointer
      })
      ctx.request.body['expiresAt'] = new Date(
        Date.now() + MAX_EXPIRY + 1000
      ).toISOString()
      await expect(incomingPaymentRoutes.create(ctx)).rejects.toHaveProperty(
        'message',
        'expiry too high'
      )
    })

    test.each`
      incomingAmount                                     | description  | externalRef  | expiresAt
      ${{ value: '2', assetCode: 'USD', assetScale: 2 }} | ${'text'}    | ${'#123'}    | ${new Date(Date.now() + 30_000).toISOString()}
      ${undefined}                                       | ${undefined} | ${undefined} | ${undefined}
    `(
      'returns the incoming payment on success',
      async ({
        incomingAmount,
        description,
        externalRef,
        expiresAt
      }): Promise<void> => {
        const grant = withGrant
          ? new Grant({
              active: true,
              grant: grantRef.id,
              clientId: grantRef.clientId,
              access: [
                {
                  type: AccessType.IncomingPayment,
                  actions: [AccessAction.Create]
                }
              ]
            })
          : undefined
        const ctx = setup<CreateContext<CreateBody>>({
          reqOpts: {
            body: {
              incomingAmount,
              description,
              externalRef,
              expiresAt
            },
            method: 'POST',
            url: `/incoming-payments`
          },
          paymentPointer,
          grant
        })
        await expect(incomingPaymentRoutes.create(ctx)).resolves.toBeUndefined()
        expect(ctx.response).toSatisfyApiSpec()
        const incomingPaymentId = (
          (ctx.response.body as Record<string, unknown>)['id'] as string
        )
          .split('/')
          .pop()
        const connectionId = (
          (
            (ctx.response.body as Record<string, unknown>)[
              'ilpStreamConnection'
            ] as Record<string, unknown>
          )['id'] as string
        )
          .split('/')
          .pop()
        expect(ctx.response.body).toEqual({
          id: `${paymentPointer.url}/incoming-payments/${incomingPaymentId}`,
          paymentPointer: paymentPointer.url,
          incomingAmount,
          description,
          expiresAt: expiresAt || expect.any(String),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          receivedAmount: {
            value: '0',
            assetCode: asset.code,
            assetScale: asset.scale
          },
          externalRef,
          completed: false,
          ilpStreamConnection: {
            id: `${config.openPaymentsUrl}/connections/${connectionId}`,
            ilpAddress: expect.stringMatching(
              /^test\.rafiki\.[a-zA-Z0-9_-]{95}$/
            ),
            sharedSecret: expect.any(String),
            assetCode: asset.code,
            assetScale: asset.scale
          }
        })
      }
    )
  })

  describe('complete', (): void => {
    let incomingPayment: IncomingPayment
    beforeEach(async (): Promise<void> => {
      incomingPayment = await createIncomingPayment(deps, {
        paymentPointerId: paymentPointer.id,
        description,
        expiresAt,
        incomingAmount,
        externalRef
      })
    })
    test('returns 200 with an updated open payments incoming payment', async (): Promise<void> => {
      const ctx = setup<CompleteContext>({
        reqOpts: {
          headers: { Accept: 'application/json' },
          method: 'POST',
          url: `/incoming-payments/${incomingPayment.id}/complete`
        },
        params: {
          id: incomingPayment.id
        },
        paymentPointer
      })
      ctx.paymentPointer = paymentPointer
      await expect(incomingPaymentRoutes.complete(ctx)).resolves.toBeUndefined()
      // Delete undefined ilpStreamConnection to satisfy toSatisfyApiSpec
      expect(
        (ctx.body as IncomingPaymentJSON).ilpStreamConnection
      ).toBeUndefined()
      delete (ctx.body as IncomingPaymentJSON).ilpStreamConnection
      expect(ctx.response).toSatisfyApiSpec()
      expect(ctx.body).toEqual({
        id: incomingPayment.url,
        paymentPointer: paymentPointer.url,
        incomingAmount: {
          value: '123',
          assetCode: asset.code,
          assetScale: asset.scale
        },
        description: incomingPayment.description,
        expiresAt: expiresAt.toISOString(),
        createdAt: incomingPayment.createdAt.toISOString(),
        updatedAt: expect.any(String),
        receivedAmount: {
          value: '0',
          assetCode: asset.code,
          assetScale: asset.scale
        },
        externalRef: '#123',
        completed: true
      })
    })
  })

  describe('list', (): void => {
    let grant: Grant
    beforeEach(async (): Promise<void> => {
      grant = new Grant({
        active: true,
        grant: grantRef.id,
        clientId: grantRef.clientId,
        access: [
          {
            type: AccessType.IncomingPayment,
            actions: [AccessAction.List]
          }
        ]
      })
    })
    describe.each`
      withGrant | description
      ${false}  | ${'without grant'}
      ${true}   | ${'with grant'}
    `('$description', ({ withGrant }): void => {
      listTests({
        getPaymentPointer: () => paymentPointer,
        getGrant: () => (withGrant ? grant : undefined),
        getUrl: () => `/incoming-payments`,
        createItem: async (index: number) => {
          const payment = await createIncomingPayment(deps, {
            paymentPointerId: paymentPointer.id,
            grantId: withGrant ? grantRef.id : undefined,
            description: `p${index}`,
            expiresAt
          })
          return {
            id: payment.url,
            paymentPointer: paymentPointer.url,
            receivedAmount: {
              value: '0',
              assetCode: asset.code,
              assetScale: asset.scale
            },
            description: payment.description,
            completed: false,
            expiresAt: expiresAt.toISOString(),
            createdAt: payment.createdAt.toISOString(),
            updatedAt: payment.updatedAt.toISOString(),
            ilpStreamConnection: `${config.openPaymentsUrl}/connections/${payment.connectionId}`
          }
        },
        list: (ctx: ListContext) => incomingPaymentRoutes.list(ctx)
      })

      test('returns 500 for unexpected error', async (): Promise<void> => {
        const incomingPaymentService = await deps.use('incomingPaymentService')
        jest
          .spyOn(incomingPaymentService, 'getPaymentPointerPage')
          .mockRejectedValueOnce(new Error('unexpected'))
        const ctx = setup<ListContext>({
          reqOpts: {
            headers: { Accept: 'application/json' }
          },
          paymentPointer,
          grant: withGrant ? grant : undefined
        })
        await expect(incomingPaymentRoutes.list(ctx)).rejects.toMatchObject({
          status: 500,
          message: `Error trying to list incoming payments`
        })
      })
    })
  })
})
