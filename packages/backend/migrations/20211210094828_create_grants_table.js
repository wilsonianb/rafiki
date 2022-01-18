exports.up = function (knex) {
  return knex.schema.createTable('grants', function (table) {
    table.uuid('id').notNullable().primary()

    table.bigInteger('amount').notNullable()
    table.string('assetCode').notNullable()
    table.integer('assetScale').notNullable()
    table.string('interval').nullable()
    table.bigInteger('balance').notNullable()
    table.timestamp('intervalEnd').nullable()

    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.timestamp('updatedAt').defaultTo(knex.fn.now())

    table.index('intervalEnd')
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('grants')
}
