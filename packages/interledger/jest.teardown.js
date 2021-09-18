module.exports = async () => {
  await global.__INTERLEDGER_KNEX__.migrate.rollback(
    { directory: __dirname + '/migrations' },
    true
  )
  await global.__INTERLEDGER_KNEX__.destroy()
  if (global.__INTERLEDGER_POSTGRES__) {
    await global.__INTERLEDGER_POSTGRES__.stop()
  }
  if (global.__INTERLEDGER_TIGERBEETLE__) {
    await global.__INTERLEDGER_TIGERBEETLE__.stop()
  }
  if (global.__CONNECTOR_REDIS__) {
    await global.__CONNECTOR_REDIS__.stop()
  }
}
