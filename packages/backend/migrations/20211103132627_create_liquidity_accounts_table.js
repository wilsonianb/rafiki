exports.up = function (knex) {
  return knex.schema.createTable('liquidityAccounts', function (table) {
    table.uuid('id').notNullable().primary()
    table.foreign('id').references('assets.id')

    // Account id tracking liquidity balance
    table.uuid('accountId').notNullable()
    table.foreign('accountId').references('accounts.id')

    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.timestamp('updatedAt').defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('liquidityAccounts')
}
