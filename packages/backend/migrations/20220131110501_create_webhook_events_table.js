exports.up = function (knex) {
  return knex.schema.createTable('webhookEvents', function (table) {
    table.uuid('id').notNullable().primary()

    table.string('type').notNullable()
    table.integer('attempts').notNullable().defaultTo(0)
    table.string('data').notNullable()

    // Open payments account id
    // table.uuid('accountId').notNullable()
    // table.foreign('accountId').references('accounts.id')
    // table.boolean('active').notNullable()
    // table.bigInteger('amount').notNullable()
    table.number('statusCode').nullable()

    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.timestamp('updatedAt').defaultTo(knex.fn.now())

    // table.index(['accountId', 'createdAt', 'id'])

    // table.index('processAt')
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('webhookEvents')
}
