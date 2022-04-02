import { Resolvers } from '../generated/graphql'
import { getAccount, createAccount, triggerAccountEvents } from './account'
import {
  getAsset,
  getAssets,
  getAssetsConnectionPageInfo,
  createAsset,
  updateAssetWithdrawalThreshold
} from './asset'
import {
  getAccountIncomingPayments,
  getPageInfo,
  getReceivedAmount
} from './incoming_payment'
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
    asset: getAsset,
    assets: getAssets,
    outgoingPayment: getOutgoingPayment,
    peer: getPeer,
    peers: getPeers
  },
  Account: {
    incomingPayments: getAccountIncomingPayments,
    outgoingPayments: getAccountOutgoingPayments
  },
  AssetsConnection: {
    pageInfo: getAssetsConnectionPageInfo
  },
  IncomingPaymentConnection: {
    pageInfo: getPageInfo
  },
  IncomingPayment: {
    receivedAmount: getReceivedAmount
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
    triggerAccountEvents,
    createAsset,
    updateAssetWithdrawalThreshold,
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
