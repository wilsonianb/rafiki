import {
  ResolversTypes,
  MutationResolvers,
  LiquidityError,
  LiquidityMutationResponse
} from '../generated/graphql'
import { TransferError } from '../../accounting/errors'
import { AssetAccount } from '../../accounting/service'
import { ApolloContext } from '../../app'

export const addAccountLiquidity: MutationResolvers<ApolloContext>['addAccountLiquidity'] = async (
  parent,
  args,
  ctx
): ResolversTypes['LiquidityMutationResponse'] => {
  try {
    const accountingService = await ctx.container.use('accountingService')
    const account = await accountingService.getAccount(args.input.accountId)
    if (!account) {
      return responses[LiquidityError.UnknownAccount]
    }
    const error = await accountingService.createTransfer({
      id: args.input.id,
      sourceAccount: {
        asset: {
          unit: account.asset.unit,
          account: AssetAccount.Settlement
        }
      },
      destinationAccount: account,
      amount: args.input.amount
    })
    if (error) {
      return errorToResponse(error)
    }
    return {
      code: '200',
      success: true,
      message: 'Added account liquidity'
    }
  } catch (error) {
    ctx.logger.error(
      {
        input: args.input,
        error
      },
      'error adding account liquidity'
    )
    return {
      code: '400',
      message: 'Error trying to add account liquidity',
      success: false
    }
  }
}

export const addAssetLiquidity: MutationResolvers<ApolloContext>['addAssetLiquidity'] = async (
  parent,
  args,
  ctx
): ResolversTypes['LiquidityMutationResponse'] => {
  try {
    const assetService = await ctx.container.use('assetService')
    const asset = await assetService.getById(args.input.assetId)
    if (!asset) {
      return responses[LiquidityError.UnknownAsset]
    }
    const accountingService = await ctx.container.use('accountingService')
    const error = await accountingService.createTransfer({
      id: args.input.id,
      sourceAccount: {
        asset: {
          unit: asset.unit,
          account: AssetAccount.Settlement
        }
      },
      destinationAccount: {
        asset: {
          unit: asset.unit,
          account: AssetAccount.Liquidity
        }
      },
      amount: args.input.amount
    })
    if (error) {
      return errorToResponse(error)
    }
    return {
      code: '200',
      success: true,
      message: 'Added asset liquidity'
    }
  } catch (error) {
    ctx.logger.error(
      {
        input: args.input,
        error
      },
      'error adding asset liquidity'
    )
    return {
      code: '400',
      message: 'Error trying to add asset liquidity',
      success: false
    }
  }
}

export const addPeerLiquidity: MutationResolvers<ApolloContext>['addPeerLiquidity'] = async (
  parent,
  args,
  ctx
): ResolversTypes['LiquidityMutationResponse'] => {
  try {
    const peerService = await ctx.container.use('peerService')
    const peer = await peerService.get(args.input.peerId)
    if (!peer) {
      return responses[LiquidityError.UnknownPeer]
    }
    const accountingService = await ctx.container.use('accountingService')
    const error = await accountingService.createTransfer({
      id: args.input.id,
      sourceAccount: {
        asset: {
          unit: peer.asset.unit,
          account: AssetAccount.Settlement
        }
      },
      destinationAccount: peer,
      amount: args.input.amount
    })
    if (error) {
      return errorToResponse(error)
    }
    return {
      code: '200',
      success: true,
      message: 'Added peer liquidity'
    }
  } catch (error) {
    ctx.logger.error(
      {
        input: args.input,
        error
      },
      'error adding peer liquidity'
    )
    return {
      code: '400',
      message: 'Error trying to add peer liquidity',
      success: false
    }
  }
}

export const createAccountLiquidityWithdrawal: MutationResolvers<ApolloContext>['createAccountLiquidityWithdrawal'] = async (
  parent,
  args,
  ctx
): ResolversTypes['LiquidityMutationResponse'] => {
  try {
    const accountingService = await ctx.container.use('accountingService')
    const account = await accountingService.getAccount(args.input.accountId)
    if (!account) {
      return responses[LiquidityError.UnknownAccount]
    }
    const error = await accountingService.createTransfer({
      id: args.input.id,
      sourceAccount: account,
      destinationAccount: {
        asset: {
          unit: account.asset.unit,
          account: AssetAccount.Settlement
        }
      },
      amount: args.input.amount,
      timeout: BigInt(60e9) // 1 minute
    })
    if (error) {
      return errorToResponse(error)
    }
    return {
      code: '200',
      success: true,
      message: 'Created account liquidity withdrawal'
    }
  } catch (error) {
    ctx.logger.error(
      {
        input: args.input,
        error
      },
      'error creating account liquidity withdrawal'
    )
    return {
      code: '400',
      message: 'Error trying to create account liquidity withdrawal',
      success: false
    }
  }
}

export const createAssetLiquidityWithdrawal: MutationResolvers<ApolloContext>['createAssetLiquidityWithdrawal'] = async (
  parent,
  args,
  ctx
): ResolversTypes['LiquidityMutationResponse'] => {
  try {
    const assetService = await ctx.container.use('assetService')
    const asset = await assetService.getById(args.input.assetId)
    if (!asset) {
      return responses[LiquidityError.UnknownAsset]
    }
    const accountingService = await ctx.container.use('accountingService')
    const error = await accountingService.createTransfer({
      id: args.input.id,
      sourceAccount: {
        asset: {
          unit: asset.unit,
          account: AssetAccount.Liquidity
        }
      },
      destinationAccount: {
        asset: {
          unit: asset.unit,
          account: AssetAccount.Settlement
        }
      },
      amount: args.input.amount,
      timeout: BigInt(60e9) // 1 minute
    })
    if (error) {
      return errorToResponse(error)
    }
    return {
      code: '200',
      success: true,
      message: 'Created asset liquidity withdrawal'
    }
  } catch (error) {
    ctx.logger.error(
      {
        input: args.input,
        error
      },
      'error creating asset liquidity withdrawal'
    )
    return {
      code: '400',
      message: 'Error trying to create asset liquidity withdrawal',
      success: false
    }
  }
}

export const createPeerLiquidityWithdrawal: MutationResolvers<ApolloContext>['createPeerLiquidityWithdrawal'] = async (
  parent,
  args,
  ctx
): ResolversTypes['LiquidityMutationResponse'] => {
  try {
    const peerService = await ctx.container.use('peerService')
    const peer = await peerService.get(args.input.peerId)
    if (!peer) {
      return responses[LiquidityError.UnknownPeer]
    }
    const accountingService = await ctx.container.use('accountingService')
    const error = await accountingService.createTransfer({
      id: args.input.id,
      sourceAccount: peer,
      destinationAccount: {
        asset: {
          unit: peer.asset.unit,
          account: AssetAccount.Settlement
        }
      },
      amount: args.input.amount,
      timeout: BigInt(60e9) // 1 minute
    })
    if (error) {
      return errorToResponse(error)
    }
    return {
      code: '200',
      success: true,
      message: 'Created peer liquidity withdrawal'
    }
  } catch (error) {
    ctx.logger.error(
      {
        input: args.input,
        error
      },
      'error creating peer liquidity withdrawal'
    )
    return {
      code: '400',
      message: 'Error trying to create peer liquidity withdrawal',
      success: false
    }
  }
}

export const finalizeLiquidityWithdrawal: MutationResolvers<ApolloContext>['finalizeLiquidityWithdrawal'] = async (
  parent,
  args,
  ctx
): ResolversTypes['LiquidityMutationResponse'] => {
  const accountingService = await ctx.container.use('accountingService')
  const error = await accountingService.commitTransfer(args.withdrawalId)
  if (error) {
    return errorToResponse(error)
  }
  return {
    code: '200',
    success: true,
    message: 'Finalized Withdrawal'
  }
}

export const rollbackLiquidityWithdrawal: MutationResolvers<ApolloContext>['rollbackLiquidityWithdrawal'] = async (
  parent,
  args,
  ctx
): ResolversTypes['LiquidityMutationResponse'] => {
  const accountingService = await ctx.container.use('accountingService')
  const error = await accountingService.rollbackTransfer(args.withdrawalId)
  if (error) {
    return errorToResponse(error)
  }
  return {
    code: '200',
    success: true,
    message: 'Rolled Back Withdrawal'
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
const isLiquidityError = (o: any): o is LiquidityError =>
  Object.values(LiquidityError).includes(o)

const errorToResponse = (error: TransferError): LiquidityMutationResponse => {
  if (!isLiquidityError(error)) {
    throw new Error(error)
  }
  return responses[error]
}

const responses: {
  [key in LiquidityError]: LiquidityMutationResponse
} = {
  [LiquidityError.AlreadyCommitted]: {
    code: '409',
    message: 'Withdrawal already finalized',
    success: false,
    error: LiquidityError.AlreadyCommitted
  },
  [LiquidityError.AlreadyRolledBack]: {
    code: '409',
    message: 'Withdrawal already rolled back',
    success: false,
    error: LiquidityError.AlreadyRolledBack
  },
  [LiquidityError.InsufficientBalance]: {
    code: '403',
    message: 'Insufficient balance',
    success: false,
    error: LiquidityError.InsufficientBalance
  },
  [LiquidityError.InvalidId]: {
    code: '400',
    message: 'Invalid id',
    success: false,
    error: LiquidityError.InvalidId
  },
  [LiquidityError.TransferExists]: {
    code: '409',
    message: 'Transfer exists',
    success: false,
    error: LiquidityError.TransferExists
  },
  [LiquidityError.UnknownAccount]: {
    code: '404',
    message: 'Unknown account',
    success: false,
    error: LiquidityError.UnknownAccount
  },
  [LiquidityError.UnknownAsset]: {
    code: '404',
    message: 'Unknown asset',
    success: false,
    error: LiquidityError.UnknownAsset
  },
  [LiquidityError.UnknownPeer]: {
    code: '404',
    message: 'Unknown peer',
    success: false,
    error: LiquidityError.UnknownPeer
  },
  [LiquidityError.UnknownTransfer]: {
    code: '404',
    message: 'Unknown withdrawal',
    success: false,
    error: LiquidityError.UnknownTransfer
  }
}
