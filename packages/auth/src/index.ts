import path from 'path'
import { EventEmitter } from 'events'
import createLogger from 'pino'
import { knex } from 'knex'
import { Model } from 'objection'
import { Ioc, IocContract } from '@adonisjs/fold'

import { App, AppServices } from './app'
import { Config } from './config/app'
import { createClientService } from './client/service'
import { createAccessService } from './access/service'
import { createGrantService } from './grant/service'
import { createAccessTokenService } from './accessToken/service'
import { createAccessTokenRoutes } from './accessToken/routes'
import { createGrantRoutes } from './grant/routes'
import { createOpenAPI } from 'openapi'
import { createUnauthenticatedClient as createOpenPaymentsClient } from 'open-payments'

const container = initIocContainer(Config)
const app = new App(container)

export function initIocContainer(
  config: typeof Config
): IocContract<AppServices> {
  const container: IocContract<AppServices> = new Ioc()

  container.singleton('config', async () => config)
  container.singleton('logger', async (deps: IocContract<AppServices>) => {
    const config = await deps.use('config')
    const logger = createLogger({
      level: config.logLevel
    })
    return logger
  })

  container.singleton('knex', async (deps: IocContract<AppServices>) => {
    const logger = await deps.use('logger')
    const config = await deps.use('config')
    logger.info({ msg: 'creating knex' })
    const db = knex({
      client: 'postgresql',
      connection: config.databaseUrl,
      pool: {
        min: 2,
        max: 10
      },
      migrations: {
        directory: './',
        tableName: 'auth_knex_migrations'
      }
    })
    // node pg defaults to returning bigint as string. This ensures it parses to bigint
    db.client.driver.types.setTypeParser(
      db.client.driver.types.builtins.INT8,
      'text',
      BigInt
    )
    return db
  })

  container.singleton('closeEmitter', async () => new EventEmitter())

  container.singleton('openPaymentsClient', async (deps) => {
    const logger = await deps.use('logger')
    return createOpenPaymentsClient({ logger })
  })

  container.singleton(
    'accessService',
    async (deps: IocContract<AppServices>) => {
      return createAccessService({
        logger: await deps.use('logger'),
        knex: await deps.use('knex')
      })
    }
  )

  container.singleton(
    'clientService',
    async (deps: IocContract<AppServices>) => {
      return createClientService({
        logger: await deps.use('logger'),
        openPaymentsClient: await deps.use('openPaymentsClient')
      })
    }
  )

  container.singleton(
    'grantService',
    async (deps: IocContract<AppServices>) => {
      return createGrantService({
        logger: await deps.use('logger'),
        accessService: await deps.use('accessService'),
        knex: await deps.use('knex')
      })
    }
  )

  container.singleton('grantRoutes', async (deps: IocContract<AppServices>) => {
    return createGrantRoutes({
      grantService: await deps.use('grantService'),
      clientService: await deps.use('clientService'),
      accessTokenService: await deps.use('accessTokenService'),
      accessService: await deps.use('accessService'),
      logger: await deps.use('logger'),
      config: await deps.use('config')
    })
  })

  container.singleton('openApi', async () => {
    const authServerSpec = await createOpenAPI(
      path.resolve(__dirname, './openapi/auth-server.yaml')
    )
    const idpSpec = await createOpenAPI(
      path.resolve(__dirname, './openapi/id-provider.yaml')
    )
    const tokenIntrospectionSpec = await createOpenAPI(
      path.resolve(__dirname, './openapi/token-introspection.yaml')
    )
    return {
      authServerSpec,
      idpSpec,
      tokenIntrospectionSpec
    }
  })

  container.singleton(
    'accessTokenService',
    async (deps: IocContract<AppServices>) => {
      return await createAccessTokenService({
        logger: await deps.use('logger'),
        config: await deps.use('config'),
        knex: await deps.use('knex'),
        clientService: await deps.use('clientService')
      })
    }
  )
  container.singleton(
    'accessTokenRoutes',
    async (deps: IocContract<AppServices>) => {
      return createAccessTokenRoutes({
        config: await deps.use('config'),
        logger: await deps.use('logger'),
        accessTokenService: await deps.use('accessTokenService'),
        clientService: await deps.use('clientService')
      })
    }
  )

  return container
}

export const gracefulShutdown = async (
  container: IocContract<AppServices>,
  app: App
): Promise<void> => {
  const logger = await container.use('logger')
  logger.info('shutting down.')
  await app.shutdown()
  const knex = await container.use('knex')
  await knex.destroy()
}

export const start = async (
  container: IocContract<AppServices>,
  app: App
): Promise<void> => {
  let shuttingDown = false
  const logger = await container.use('logger')
  process.on('SIGINT', async (): Promise<void> => {
    logger.info('received SIGINT attempting graceful shutdown')
    try {
      if (shuttingDown) {
        logger.warn(
          'received second SIGINT during graceful shutdown, exiting forcefully.'
        )
        process.exit(1)
      }

      shuttingDown = true

      // Graceful shutdown
      await gracefulShutdown(container, app)
      logger.info('completed graceful shutdown.')
      process.exit(0)
    } catch (err) {
      const errInfo =
        err && typeof err === 'object' && err['stack'] ? err['stack'] : err
      logger.error({ error: errInfo }, 'error while shutting down')
      process.exit(1)
    }
  })

  process.on('SIGTERM', async (): Promise<void> => {
    logger.info('received SIGTERM attempting graceful shutdown')

    try {
      // Graceful shutdown
      await gracefulShutdown(container, app)
      logger.info('completed graceful shutdown.')
      process.exit(0)
    } catch (err) {
      const errInfo =
        err && typeof err === 'object' && err['stack'] ? err['stack'] : err
      logger.error({ error: errInfo }, 'error while shutting down')
      process.exit(1)
    }
  })

  // Do migrations
  const knex = await container.use('knex')
  // Needs a wrapped inline function
  await callWithRetry(async () => {
    await knex.migrate.latest({
      directory: __dirname + '/../migrations'
    })
  })

  Model.knex(knex)

  const config = await container.use('config')
  await app.boot()
  app.listen(config.port)
  logger.info(`Auth server listening on ${app.getPort()}`)
}

// If this script is run directly, start the server
if (!module.parent) {
  start(container, app).catch(async (e): Promise<void> => {
    const errInfo = e && typeof e === 'object' && e.stack ? e.stack : e
    const logger = await container.use('logger')
    logger.error(errInfo)
  })
}

// Used for running migrations in a try loop with exponential backoff
const callWithRetry: CallableFunction = async (
  fn: CallableFunction,
  depth = 0
) => {
  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))

  try {
    return await fn()
  } catch (e) {
    if (depth > 7) {
      throw e
    }
    await wait(2 ** depth * 30)

    return callWithRetry(fn, depth + 1)
  }
}
