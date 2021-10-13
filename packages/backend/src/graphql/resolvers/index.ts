import { Resolvers } from '../generated/graphql'
import {
  getAccount,
  getAccounts,
  getAccountsConnectionPageInfo,
  getBalance,
  createAccount,
  updateAccount,
  deleteAccount
} from './account'
import {
  createAsset,
  getAsset,
  getAssets,
  getAssetsConnectionPageInfo
} from './asset'
import { getAccountInvoices, getPageInfo } from './invoice'
import {
  getOutgoingPayment,
  createOutgoingPayment,
  approveOutgoingPayment,
  requoteOutgoingPayment,
  cancelOutgoingPayment,
  getOutcome
} from './outgoing_payment'
import {
  addAccountLiquidity,
  addAssetLiquidity,
  createAccountLiquidityWithdrawal,
  createAssetLiquidityWithdrawal,
  finalizeLiquidityWithdrawal,
  rollbackLiquidityWithdrawal
} from './liquidity'
import { GraphQLBigInt } from '../scalars'

export const resolvers: Resolvers = {
  UInt64: GraphQLBigInt,
  Query: {
    account: getAccount,
    accounts: getAccounts,
    asset: getAsset,
    assets: getAssets,
    outgoingPayment: getOutgoingPayment
    // webhook: getWebhook
  },
  Account: {
    balance: getBalance,
    invoices: getAccountInvoices
    // webhooks: getWebhooks,
  },
  AccountsConnection: {
    pageInfo: getAccountsConnectionPageInfo
  },
  AssetsConnection: {
    pageInfo: getAssetsConnectionPageInfo
  },
  InvoiceConnection: {
    pageInfo: getPageInfo
  },
  OutgoingPayment: {
    outcome: getOutcome
  },
  WebhooksConnection: {
    // pageInfo: getWebhooksConnectionPageInfo
  },
  Mutation: {
    createAccount: createAccount,
    updateAccount: updateAccount,
    deleteAccount: deleteAccount,
    createAsset: createAsset,
    createOutgoingPayment,
    approveOutgoingPayment,
    requoteOutgoingPayment,
    cancelOutgoingPayment,
    // createWebhook: createWebhook,
    // updateWebhook: updateWebhook,
    // deleteWebhook: deleteWebhook,
    addAccountLiquidity: addAccountLiquidity,
    addAssetLiquidity: addAssetLiquidity,
    createAccountLiquidityWithdrawal: createAccountLiquidityWithdrawal,
    createAssetLiquidityWithdrawal: createAssetLiquidityWithdrawal,
    finalizeLiquidityWithdrawal: finalizeLiquidityWithdrawal,
    rollbackLiquidityWithdrawal: rollbackLiquidityWithdrawal
  }
}
