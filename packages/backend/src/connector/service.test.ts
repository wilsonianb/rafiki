import { Transaction } from 'knex'
import { Model } from 'objection'
import { WorkerUtils, makeWorkerUtils } from 'graphile-worker'

import { createTestApp, TestContainer } from '../tests/app'
import { resetGraphileDb } from '../tests/graphileDb'
import { GraphileProducer } from '../messaging/graphileProducer'
import { Config } from '../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../'
import { AppServices } from '../app'
import { ConnectorService } from './service'

describe('Connector Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let trx: Transaction
  let workerUtils: WorkerUtils
  let connectorService: ConnectorService
  const messageProducer = new GraphileProducer()
  const mockMessageProducer = {
    send: jest.fn()
  }

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      deps.bind('messageProducer', async () => mockMessageProducer)
      appContainer = await createTestApp(deps)
      workerUtils = await makeWorkerUtils({
        connectionString: appContainer.connectionUrl
      })
      await workerUtils.migrate()
      messageProducer.setUtils(workerUtils)
    }
  )

  beforeEach(
    async (): Promise<void> => {
      trx = await appContainer.knex.transaction()
      Model.knex(trx)
      connectorService = await deps.use('connectorService')
    }
  )

  afterEach(
    async (): Promise<void> => {
      await trx.rollback()
      await trx.destroy()
    }
  )

  afterAll(
    async (): Promise<void> => {
      await resetGraphileDb(appContainer.knex)
      await appContainer.shutdown()
      await workerUtils.release()
    }
  )

  describe('IlpAccount', (): void => {
    test.skip('Can get an ilp account', async (): Promise<void> => {
      const response = await connectorService.getIlpAccount('')
      expect(response.id).toEqual('')
    })

    test.skip('Can create an ilp account', async (): Promise<void> => {
      const response = await connectorService.createIlpAccount()
      expect(response.code).toEqual('200')
    })

    test.skip('Can create an ilp sub account', async (): Promise<void> => {
      const response = await connectorService.createIlpSubAccount('')
      expect(response.code).toEqual('200')
    })
  })
})
