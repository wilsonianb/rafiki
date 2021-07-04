// eslint-disable-next-line @typescript-eslint/no-var-requires
const Knex = require('knex')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GenericContainer } = require('testcontainers')

const POSTGRES_PORT = 5432

module.exports = async () => {
  const postgresContainer = await new GenericContainer('postgres')
    .withExposedPorts(POSTGRES_PORT)
    .withBindMount(
      __dirname + '/scripts/init.sh',
      '/docker-entrypoint-initdb.d/init.sh'
    )
    .withEnv('POSTGRES_PASSWORD', 'password')
    .start()

  const POSTGRES_URL = `postgresql://postgres:password@localhost:${postgresContainer.getMappedPort(
    POSTGRES_PORT
  )}/testing`

  const knex = Knex({
    client: 'postgresql',
    connection: POSTGRES_URL,
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  })

  // node pg defaults to returning bigint as string. This ensures it parses to bigint
  knex.client.driver.types.setTypeParser(
    knex.client.driver.types.builtins.INT8,
    'text',
    BigInt
  )
  await knex.migrate.latest({
    directory: __dirname + '/migrations'
  })
  process.env.POSTGRES_URL = POSTGRES_URL
  global.__ACCOUNTS_KNEX__ = knex
  global.__ACCOUNTS_POSTGRES__ = postgresContainer
}
