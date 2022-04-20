exports.up = function (knex) {
  return knex.schema.createTable('outgoingPayments', function (table) {
    table.uuid('id').notNullable().primary()

    table.string('state').notNullable().index() // OutgoingPaymentState
    table.string('error').nullable()
    table.integer('stateAttempts').notNullable().defaultTo(0)
    table.string('description').nullable()
    table.string('externalRef').nullable()

    table.string('receivingAccount').nullable()
    table.string('_receivingPayment').nullable()
    table.bigInteger('sendAmountValue').nullable()
    table.bigInteger('receiveAmountValue').nullable()
    table.string('receiveAmountAssetCode').nullable()
    table.integer('receiveAmountAssetScale').nullable()

    // Open payments account corresponding to wallet account
    // from which to request funds for payment
    table.uuid('accountId').notNullable()
    table.foreign('accountId').references('accounts.id')

    table.uuid('assetId').notNullable()
    table.foreign('assetId').references('assets.id')

    table.uuid('quoteId').nullable()
    table.foreign('quoteId').references('quotes.id')

    table.timestamp('createdAt').defaultTo(knex.fn.now())
    table.timestamp('updatedAt').defaultTo(knex.fn.now())

    table.index(['accountId', 'createdAt', 'id'])
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('outgoingPayments')
}
