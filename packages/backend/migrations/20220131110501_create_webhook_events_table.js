exports.up = function (knex) {
  return knex.schema.createTable('webhookEvents', function (table) {
    table.uuid('id').notNullable().primary()

    table.string('type').notNullable()
    table.json('data').notNullable()

    table.uuid('withdrawalAccountId').nullable()
    table.foreign('withdrawalAccountId').references('accounts.id')
    table.uuid('withdrawalAssetId').nullable()
    table.foreign('withdrawalAssetId').references('assets.id')
    table.bigInteger('withdrawalAmount').nullable()

    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.timestamp('updatedAt').defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('webhookEvents')
}
