exports.up = function (knex) {
  return knex.schema.createTable('accounts', function (table) {
    table.uuid('id').notNullable().primary()
    table.uuid('assetId').notNullable()
    table.foreign('assetId').references('assets.id')

    table.bigInteger('balanceWithdrawalThreshold').nullable()

    table.timestamp('processAt').nullable()
    table.uuid('withdrawalId').nullable()
    table.integer('withdrawalAttempts').nullable()
    table.bigInteger('withdrawalAmount').nullable()
    table.uuid('withdrawalTransferId').nullable()

    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.timestamp('updatedAt').defaultTo(knex.fn.now())

    table.index('processAt')
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('accounts')
}
