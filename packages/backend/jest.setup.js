// eslint-disable-next-line @typescript-eslint/no-var-requires
const { knex } = require('knex')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GenericContainer, Wait } = require('testcontainers')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tmp = require('tmp')

const POSTGRES_PORT = 5432

const TIGERBEETLE_CLUSTER_ID = 0
const TIGERBEETLE_PORT = 3004
const TIGERBEETLE_DIR = '/var/lib/tigerbeetle'
const TIGERBEETLE_CONTAINER_LOG =
  process.env.TIGERBEETLE_CONTAINER_LOG === 'true'
//TODO @jason: https://github.com/interledger/rafiki/issues/518
//TODO @jason const TIGERBEETLE_FILE = `${TIGERBEETLE_DIR}/cluster_${TIGERBEETLE_CLUSTER_ID}_replica_0.tigerbeetle`

const REDIS_PORT = 6379

module.exports = async (globalConfig) => {
  const workers = globalConfig.maxWorkers

  const setupDatabase = async () => {
    if (!process.env.DATABASE_URL) {
      const postgresContainer = await new GenericContainer('postgres:15')
        .withExposedPorts(POSTGRES_PORT)
        .withBindMounts([
          {
            source: __dirname + '/scripts/init.sh',
            target: '/docker-entrypoint-initdb.d/init.sh'
          }
        ])
        .withEnvironment({
          POSTGRES_PASSWORD: 'password'
        })
        .start()

      process.env.DATABASE_URL = `postgresql://postgres:password@localhost:${postgresContainer.getMappedPort(
        POSTGRES_PORT
      )}/testing`

      global.__BACKEND_POSTGRES__ = postgresContainer
    }

    const db = knex({
      client: 'postgresql',
      connection: process.env.DATABASE_URL,
      pool: {
        min: 2,
        max: 10
      },
      migrations: {
        tableName: 'knex_migrations'
      }
    })

    // node pg defaults to returning bigint as string. This ensures it parses to bigint
    db.client.driver.types.setTypeParser(
      db.client.driver.types.builtins.INT8,
      'text',
      BigInt
    )
    await db.migrate.latest({
      directory: __dirname + '/migrations'
    })

    for (let i = 1; i <= workers; i++) {
      const workerDatabaseName = `testing_${i}`

      await db.raw(`DROP DATABASE IF EXISTS ${workerDatabaseName}`)
      await db.raw(`CREATE DATABASE ${workerDatabaseName} TEMPLATE testing`)
    }

    global.__BACKEND_KNEX__ = db
  }

  const setupTigerbeetle = async () => {
    if (!process.env.TIGERBEETLE_REPLICA_ADDRESSES) {
      const { name: tigerbeetleDir } = tmp.dirSync({ unsafeCleanup: true })

      const tbContFormat = await new GenericContainer(
        'ghcr.io/tigerbeetledb/tigerbeetle@sha256:ea026bec8d80e56109b7dca636d70153ebdf4875d56e4f8783aa1500872527a2'
      )
        .withExposedPorts(TIGERBEETLE_PORT)
        .withBindMounts([
          {
            source: tigerbeetleDir,
            target: TIGERBEETLE_DIR
          }
        ])
        .withAddedCapabilities('IPC_LOCK')
        .withCommand([
          'init',
          '--cluster=' + TIGERBEETLE_CLUSTER_ID,
          '--replica=0',
          '--directory=' + TIGERBEETLE_DIR
        ])
        .withWaitStrategy(Wait.forLogMessage(/initialized data file/))
        .start()

      const streamTbFormat = await tbContFormat.logs()
      if (TIGERBEETLE_CONTAINER_LOG) {
        streamTbFormat
          .on('data', (line) => console.log(line))
          .on('err', (line) => console.error(line))
          .on('end', () => console.log('Stream closed for [tb-format]'))
      }

      // Give TB a chance to startup (no message currently to notify allocation is complete):
      await new Promise((f) => setTimeout(f, 1000))

      const tbContStart = await new GenericContainer(
        'ghcr.io/tigerbeetledb/tigerbeetle@sha256:ea026bec8d80e56109b7dca636d70153ebdf4875d56e4f8783aa1500872527a2'
      )
        .withExposedPorts(TIGERBEETLE_PORT)
        .withAddedCapabilities('IPC_LOCK')
        .withBindMounts([
          {
            source: tigerbeetleDir,
            target: TIGERBEETLE_DIR
          }
        ])
        .withCommand([
          'start',
          '--cluster=' + TIGERBEETLE_CLUSTER_ID,
          '--replica=0',
          '--addresses=0.0.0.0:' + TIGERBEETLE_PORT,
          '--directory=' + TIGERBEETLE_DIR
        ])
        .withWaitStrategy(Wait.forLogMessage(/listening on/))
        .start()

      const streamTbStart = await tbContStart.logs()
      if (TIGERBEETLE_CONTAINER_LOG) {
        streamTbStart
          .on('data', (line) => console.log(line))
          .on('err', (line) => console.error(line))
          .on('end', () => console.log('Stream closed for [tb-start]'))
      }

      process.env.TIGERBEETLE_CLUSTER_ID = TIGERBEETLE_CLUSTER_ID
      process.env.TIGERBEETLE_REPLICA_ADDRESSES = `[${tbContStart.getMappedPort(
        TIGERBEETLE_PORT
      )}]`
      global.__BACKEND_TIGERBEETLE__ = tbContStart
    }
  }

  const setupRedis = async () => {
    if (!process.env.REDIS_URL) {
      const redisContainer = await new GenericContainer('redis:7')
        .withExposedPorts(REDIS_PORT)
        .start()

      global.__BACKEND_REDIS__ = redisContainer
      process.env.REDIS_URL = `redis://localhost:${redisContainer.getMappedPort(
        REDIS_PORT
      )}`
    }
  }

  await Promise.all([setupDatabase(), setupTigerbeetle(), setupRedis()])
}
