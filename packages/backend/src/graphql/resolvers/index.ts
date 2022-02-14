import { Resolvers } from '../generated/graphql'
import { getAccount, createAccount } from './account'
import {
  eventResolveType,
  getEvents,
  getEventsConnectionPageInfo
} from './event'
import { getAccountInvoices, getPageInfo } from './invoice'
import {
  getOutgoingPayment,
  createOutgoingPayment,
  getOutcome,
  getAccountOutgoingPayments,
  getOutgoingPaymentPageInfo
} from './outgoing_payment'
import { createApiKey, deleteAllApiKeys, redeemApiKey } from './apiKey'
import {
  getPeer,
  getPeers,
  getPeersConnectionPageInfo,
  createPeer,
  updatePeer,
  deletePeer
} from './peer'
import {
  addAssetLiquidity,
  addPeerLiquidity,
  createAssetLiquidityWithdrawal,
  createPeerLiquidityWithdrawal,
  createAccountWithdrawal,
  finalizeLiquidityWithdrawal,
  rollbackLiquidityWithdrawal,
  depositEventLiquidity,
  withdrawEventLiquidity
} from './liquidity'
import { GraphQLBigInt } from '../scalars'
import { refreshSession, revokeSession } from './session'

export const resolvers: Resolvers = {
  UInt64: GraphQLBigInt,
  Query: {
    account: getAccount,
    events: getEvents,
    outgoingPayment: getOutgoingPayment,
    peer: getPeer,
    peers: getPeers
  },
  Account: {
    invoices: getAccountInvoices,
    outgoingPayments: getAccountOutgoingPayments
  },
  Event: {
    __resolveType: eventResolveType
  },
  EventsConnection: {
    pageInfo: getEventsConnectionPageInfo
  },
  InvoiceConnection: {
    pageInfo: getPageInfo
  },
  OutgoingPaymentConnection: {
    pageInfo: getOutgoingPaymentPageInfo
  },
  OutgoingPayment: {
    outcome: getOutcome
  },
  PeersConnection: {
    pageInfo: getPeersConnectionPageInfo
  },
  Mutation: {
    createAccount,
    createOutgoingPayment,
    createApiKey: createApiKey,
    redeemApiKey: redeemApiKey,
    deleteAllApiKeys: deleteAllApiKeys,
    refreshSession: refreshSession,
    revokeSession: revokeSession,
    createPeer: createPeer,
    updatePeer: updatePeer,
    deletePeer: deletePeer,
    addAssetLiquidity: addAssetLiquidity,
    addPeerLiquidity: addPeerLiquidity,
    createAssetLiquidityWithdrawal: createAssetLiquidityWithdrawal,
    createPeerLiquidityWithdrawal: createPeerLiquidityWithdrawal,
    createAccountWithdrawal,
    finalizeLiquidityWithdrawal: finalizeLiquidityWithdrawal,
    rollbackLiquidityWithdrawal: rollbackLiquidityWithdrawal,
    depositEventLiquidity,
    withdrawEventLiquidity
  }
}
