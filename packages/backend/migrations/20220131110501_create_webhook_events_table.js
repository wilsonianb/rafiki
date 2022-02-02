exports.up = function (knex) {
  return knex.schema.createTable('webhookEvents', function (table) {
    table.uuid('id').notNullable().primary()

    table.string('type').notNullable()
    table.integer('attempts').notNullable().defaultTo(0)
    table.string('data').notNullable()
    table.number('statusCode').nullable()
    table.boolean('false').notNullable().defaultTo(false)

    table.timestamp('processAt').nullable()

    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.timestamp('updatedAt').defaultTo(knex.fn.now())

    table.index('processAt')
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('webhookEvents')
}
