exports.up = function (knex) {
  return knex.schema.createTable('tokens', function (table) {
    table.uuid('id').notNullable().primary()
    table.string('token').notNullable().unique().index()
    table.uuid('ilpAccountSettingsId').notNullable()
    table
      .foreign('ilpAccountSettingsId')
      .references('ilpAccountSettings.id')
      .onDelete('CASCADE')

    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.timestamp('updatedAt').defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('tokens')
}
