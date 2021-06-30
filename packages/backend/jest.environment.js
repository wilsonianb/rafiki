// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Knex = require('knex')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GenericContainer } = require('testcontainers')
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
      directory: './packages/backend/migrations'
    })
    this.global.__KNEX__ = knex
    this.global.__POSTGRES__ = postgresContainer

    const redisContainer = await new GenericContainer('redis')
      .withExposedPorts(6379)
      .start()

    this.global.__REDIS__ = redisContainer
    this.global.__REDIS_URL__ = `redis://localhost:${redisContainer.getMappedPort(
      6379
    )}`
  }

  async teardown() {
    await this.global.__KNEX__.migrate.rollback(
      { directory: './packages/backend/migrations' },
      true
    )
    await this.global.__KNEX__.destroy()
    await this.global.__POSTGRES__.stop()
    await this.global.__REDIS__.stop()
    await super.teardown()
  }

  getVmContext() {
    return super.getVmContext()
  }
}

module.exports = CustomEnvironment
