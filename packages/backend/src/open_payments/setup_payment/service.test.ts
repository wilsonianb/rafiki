import nock from 'nock'
import { PaymentError } from '@interledger/pay'

import { SetupPaymentService } from './service'
import { createTestApp, TestContainer } from '../../tests/app'
import { Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { AssetOptions } from '../../asset/service'

describe('SetupPaymentService', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let setupPaymentService: SetupPaymentService

  beforeAll(async (): Promise<void> => {
    deps = await initIocContainer(Config)
    appContainer = await createTestApp(deps)
  })

  beforeEach(async (): Promise<void> => {
    setupPaymentService = await deps.use('setupPaymentService')
  })

  afterEach(async (): Promise<void> => {
    jest.restoreAllMocks()
  })

  afterAll(async (): Promise<void> => {
    await appContainer.shutdown()
  })

  const asset: AssetOptions = {
    scale: 9,
    code: 'USD'
  }

  const incomingAmount = {
    value: '123',
    assetCode: asset.code,
    assetScale: asset.scale
  }

  const receivedAmount = {
    value: '0',
    assetCode: asset.code,
    assetScale: asset.scale
  }
  const testHost = 'https://example.com'
  const paymentPointerPath = '/setup-payment-account-id'
  const paymentPointer = `${testHost}${paymentPointerPath}`
  const incomingPaymentId = 'setup-payment-incoming-payment-id'
  const incomingPaymentPath = `/incoming-payments/${incomingPaymentId}`
  const incomingPaymentRecord = {
    id: `${paymentPointer}${incomingPaymentPath}`,
    paymentPointer,
    incomingAmount,
    receivedAmount,
    description: 'description string',
    completed: false,
    expiresAt: '2023-03-12T23:20:50.52Z',
    createdAt: '2022-03-12T23:20:50.52Z',
    updatedAt: '2022-03-12T23:20:50.52Z',
    externalRef: 'INV2022-02-0137',
    ilpStreamConnection: {
      id: 'http://openpayments.guide/connections/ff394f02-7b7b-45e2-b645-51d04e7c345c',
      ilpAddress: 'g.ilp.iwuyge987y.98y08y',
      sharedSecret: '6jR5iNIVRvqeasJeCty6C+YB5X9FhSOUPCL/5nha5Vs='
    }
  }
  const invalidIncomingPaymentRecord = {
    id: `${paymentPointer}${incomingPaymentPath}`,
    paymentPointer,
    incomingAmount,
    completed: false,
    description: 'description string',
    expiresAt: '2023-03-12T23:20:50.52Z',
    createdAt: '2022-03-12T23:20:50.52Z',
    updatedAt: '2022-03-12T23:20:50.52Z',
    externalRef: 'INV2022-02-0137',
    ilpStreamConnection: {
      id: 'http://openpayments.guide/connections/ff394f02-7b7b-45e2-b645-51d04e7c345c',
      ilpAddress: 'g.ilp.iwuyge987y.98y08y',
      sharedSecret: '6jR5iNIVRvqeasJeCty6C+YB5X9FhSOUPCL/5nha5Vs='
    }
  }

  describe(' get failure', (): void => {
    beforeEach(async (): Promise<void> => {
      nock(testHost)
        .get(`${paymentPointerPath}${incomingPaymentPath}`)
        .reply(200, () => invalidIncomingPaymentRecord)
        .persist()
    })
    afterEach(async (): Promise<void> => {
      nock.cleanAll()
    })
    it('fails when the supplied URL is invalid', async () => {
      await expect(
        async () =>
          await setupPaymentService.queryIncomingPayment(
            'ftsgjsfjgdj',
            'hkfjkcjk'
          )
      ).rejects.toThrow(PaymentError.QueryFailed)
    })
    it('fails when the returned data is invalid', async () => {
      await expect(
        async () =>
          await setupPaymentService.queryIncomingPayment(
            `${paymentPointer}${incomingPaymentPath}`,
            'hkfjkcjk'
          )
      ).rejects.toThrow(PaymentError.QueryFailed)
    })
  })

  describe(' get success', (): void => {
    beforeEach(async (): Promise<void> => {
      nock(testHost)
        .get(`${paymentPointerPath}${incomingPaymentPath}`)
        .reply(200, () => incomingPaymentRecord)
        .persist()
    })
    afterEach(async (): Promise<void> => {
      nock.cleanAll()
    })
    it('gets the incoming payment record', async () => {
      await expect(
        await setupPaymentService.queryIncomingPayment(
          `${paymentPointer}${incomingPaymentPath}`,
          'hkfjkcjk'
        )
      ).toEqual(incomingPaymentRecord)
    })
  })
})
