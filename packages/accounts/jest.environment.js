// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Knex = require('knex')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GenericContainer, Wait } = require('testcontainers')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NodeEnvironment = require('jest-environment-node')

class CustomEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context)
  }

  async setup() {
    await super.setup()

    const postgresContainer = await new GenericContainer('postgres')
      .withExposedPorts(5432)
      .withBindMount(
        path.resolve(__dirname, 'scripts/init.sh'),
        '/docker-entrypoint-initdb.d/init.sh'
      )
      .withEnv('POSTGRES_PASSWORD', 'password')
      .start()

    this.global.__DATABASE_URL__ = `postgresql://postgres:password@localhost:${postgresContainer.getMappedPort(
      5432
    )}/testing`

    const knex = Knex({
      client: 'postgresql',
      connection: this.global.__DATABASE_URL__,
      pool: {
        min: 2,
        max: 10
      },
      migrations: {
        tableName: 'knex_migrations'
      }
    })

    // node pg defaults to returning bigint as string. This ensures it parses to bigint
    knex.client.driver.types.setTypeParser(20, 'text', BigInt)
    await knex.migrate.latest({
      directory: './packages/accounts/migrations'
    })
    this.global.__KNEX__ = knex
    this.global.__POSTGRES__ = postgresContainer

    const TIGERBEETLE_PORT = 3001
    const tigerbeetleContainer = await new GenericContainer(
      'wilsonianbcoil/tigerbeetle'
    )
      .withExposedPorts(TIGERBEETLE_PORT)
      .withCmd([
        '--cluster-id=0a5ca1ab1ebee11e',
        '--replica-index=0',
        '--replica-addresses=0.0.0.0:' + TIGERBEETLE_PORT
      ])
      .withWaitStrategy(Wait.forLogMessage(/listening on/))
      .start()

    this.global.__TIGERBEETLE_PORT__ = tigerbeetleContainer.getMappedPort(
      TIGERBEETLE_PORT
    )
    this.global.__TIGERBEETLE__ = tigerbeetleContainer
  }

  async teardown() {
    await this.global.__KNEX__.migrate.rollback(
      { directory: './packages/accounts/migrations' },
      true
    )
    await this.global.__KNEX__.destroy()
    await this.global.__POSTGRES__.stop()
    await this.global.__TIGERBEETLE__.stop()
    await super.teardown()
  }

  getVmContext() {
    return super.getVmContext()
  }
}

module.exports = CustomEnvironment
