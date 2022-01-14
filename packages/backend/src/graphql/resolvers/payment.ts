import { isPaymentError, PaymentError } from '@interledger/pay'
import {
  MutationResolvers,
  Payment as SchemaPayment,
  PaymentResolvers,
  PaymentConnectionResolvers,
  PaymentState as SchemaPaymentState,
  AccountResolvers,
  PaymentType as SchemaPaymentType,
  QueryResolvers,
  ResolversTypes
} from '../generated/graphql'
import { Payment } from '../../open_payments/payment/model'
import { ApolloContext } from '../../app'

export const getPayment: QueryResolvers<ApolloContext>['payment'] = async (
  parent,
  args,
  ctx
): ResolversTypes['Payment'] => {
  const paymentService = await ctx.container.use('paymentService')
  const payment = await paymentService.get(args.id)
  if (!payment) throw new Error('payment does not exist')
  return paymentToGraphql(payment)
}

export const getOutcome: PaymentResolvers<ApolloContext>['outcome'] = async (
  parent,
  args,
  ctx
): ResolversTypes['PaymentOutcome'] => {
  if (!parent.id) throw new Error('missing id')
  const paymentService = await ctx.container.use('paymentService')
  const payment = await paymentService.get(parent.id)
  if (!payment) throw new Error('payment does not exist')

  const accountingService = await ctx.container.use('accountingService')
  const totalSent = await accountingService.getTotalSent(payment.id)
  if (totalSent === undefined) throw new Error('payment account does not exist')
  return {
    amountSent: totalSent
  }
}

const clientErrors: { [key in PaymentError]: boolean } = {
  InvalidPaymentPointer: true,
  InvalidCredentials: true,
  InvalidSlippage: false,
  UnknownSourceAsset: true,
  UnknownPaymentTarget: true,
  InvalidSourceAmount: true,
  InvalidDestinationAmount: true,
  UnenforceableDelivery: true,
  InvalidQuote: false,

  // QueryFailed can be either a client or server error: an invalid invoice URL, or failed query.
  QueryFailed: true,
  InvoiceAlreadyPaid: false,
  ConnectorError: false,
  EstablishmentFailed: false,
  UnknownDestinationAsset: false,
  DestinationAssetConflict: false,
  ExternalRateUnavailable: false,
  RateProbeFailed: false,
  InsufficientExchangeRate: false,
  IdleTimeout: false,
  ClosedByReceiver: false,
  IncompatibleReceiveMax: false,
  ReceiverProtocolViolation: false,
  MaxSafeEncryptionLimit: false
}

export const createPayment: MutationResolvers<ApolloContext>['createPayment'] = async (
  parent,
  args,
  ctx
): ResolversTypes['PaymentResponse'] => {
  const paymentService = await ctx.container.use('paymentService')
  return paymentService
    .create(args.input)
    .then((payment: Payment) => ({
      code: '200',
      success: true,
      payment: paymentToGraphql(payment)
    }))
    .catch((err: Error | PaymentError) => ({
      code: isPaymentError(err) && clientErrors[err] ? '400' : '500',
      success: false,
      message: typeof err === 'string' ? err : err.message
    }))
}

export const createInvoicePayment: MutationResolvers<ApolloContext>['createInvoicePayment'] = async (
  parent,
  args,
  ctx
): ResolversTypes['PaymentResponse'] => {
  const paymentService = await ctx.container.use('paymentService')
  return paymentService
    .create(args.input)
    .then((payment: Payment) => ({
      code: '200',
      success: true,
      payment: paymentToGraphql(payment)
    }))
    .catch((err: Error | PaymentError) => ({
      code: isPaymentError(err) && clientErrors[err] ? '400' : '500',
      success: false,
      message: typeof err === 'string' ? err : err.message
    }))
}

export const getAccountPayments: AccountResolvers<ApolloContext>['payments'] = async (
  parent,
  args,
  ctx
): ResolversTypes['PaymentConnection'] => {
  if (!parent.id) throw new Error('missing account id')
  const paymentService = await ctx.container.use('paymentService')
  const payments = await paymentService.getAccountPage(parent.id, args)
  return {
    edges: payments.map((payment: Payment) => ({
      cursor: payment.id,
      node: paymentToGraphql(payment)
    }))
  }
}

export const getPaymentPageInfo: PaymentConnectionResolvers<ApolloContext>['pageInfo'] = async (
  parent,
  args,
  ctx
): ResolversTypes['PageInfo'] => {
  const logger = await ctx.container.use('logger')
  const paymentService = await ctx.container.use('paymentService')
  logger.info({ edges: parent.edges }, 'getPageInfo parent edges')

  const edges = parent.edges
  if (edges == null || typeof edges == 'undefined' || edges.length == 0)
    return {
      hasPreviousPage: false,
      hasNextPage: false
    }

  const firstEdge = edges[0].cursor
  const lastEdge = edges[edges.length - 1].cursor

  const firstPayment = await paymentService.get(edges[0].node.id)
  if (!firstPayment) throw 'payment does not exist'

  let hasNextPagePayments, hasPreviousPagePayments
  try {
    hasNextPagePayments = await paymentService.getAccountPage(
      firstPayment.accountId,
      {
        after: lastEdge,
        first: 1
      }
    )
  } catch (e) {
    hasNextPagePayments = []
  }
  try {
    hasPreviousPagePayments = await paymentService.getAccountPage(
      firstPayment.accountId,
      {
        before: firstEdge,
        last: 1
      }
    )
  } catch (e) {
    hasPreviousPagePayments = []
  }

  return {
    endCursor: lastEdge,
    hasNextPage: hasNextPagePayments.length == 1,
    hasPreviousPage: hasPreviousPagePayments.length == 1,
    startCursor: firstEdge
  }
}

export function paymentToGraphql(
  payment: Payment
): Omit<SchemaPayment, 'outcome' | 'account'> {
  return {
    id: payment.id,
    accountId: payment.accountId,
    state: SchemaPaymentState[payment.state],
    error: payment.error ?? undefined,
    stateAttempts: payment.stateAttempts,
    intent: payment.intent,
    quote: payment.quote && {
      ...payment.quote,
      targetType: SchemaPaymentType[payment.quote.targetType],
      timestamp: payment.quote.timestamp.toISOString(),
      activationDeadline: payment.quote.activationDeadline.toISOString(),
      minExchangeRate: payment.quote.minExchangeRate.valueOf(),
      lowExchangeRateEstimate: payment.quote.lowExchangeRateEstimate.valueOf(),
      highExchangeRateEstimate: payment.quote.highExchangeRateEstimate.valueOf()
    },
    destinationAccount: payment.destinationAccount,
    createdAt: new Date(+payment.createdAt).toISOString()
  }
}
