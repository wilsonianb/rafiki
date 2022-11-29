exports.up = function (knex) {
  return knex.schema.createTable('grantReferences', function (table) {
    table.string('id').notNullable().primary()
    table.string('client').notNullable()
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('grantReferences')
}
