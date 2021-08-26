import { ResolversTypes, MutationResolvers } from '../generated/graphql'
import { CreditError } from '../../accounts/types'

export const extendCredit: MutationResolvers['extendCredit'] = async (
  parent,
  args,
  ctx
): ResolversTypes['ExtendCreditMutationResponse'] => {
  try {
    const error = await ctx.accountsService.extendCredit(args.input)
    if (error) {
      return errorToResponse(error)
    }
    return {
      code: '200',
      success: true,
      message: 'Extended credit'
    }
  } catch (error) {
    ctx.logger('Error extending credit', {
      options: args.input,
      error
    })
    return {
      code: '400',
      message: 'Error trying to extend credit',
      success: false
    }
  }
}

export const revokeCredit: MutationResolvers['revokeCredit'] = async (
  parent,
  args,
  ctx
): ResolversTypes['RevokeCreditMutationResponse'] => {
  try {
    const error = await ctx.accountsService.revokeCredit(args.input)
    if (error) {
      return errorToResponse(error)
    }
    return {
      code: '200',
      success: true,
      message: 'Revoked credit'
    }
  } catch (error) {
    ctx.logger('Error revoking credit', {
      options: args.input,
      error
    })
    return {
      code: '400',
      message: 'Error trying to revoke credit',
      success: false
    }
  }
}

export const utilizeCredit: MutationResolvers['utilizeCredit'] = async (
  parent,
  args,
  ctx
): ResolversTypes['UtilizeCreditMutationResponse'] => {
  try {
    const error = await ctx.accountsService.utilizeCredit(args.input)
    if (error) {
      return errorToResponse(error)
    }
    return {
      code: '200',
      success: true,
      message: 'Utilized credit'
    }
  } catch (error) {
    ctx.logger('Error utilizing credit', {
      options: args.input,
      error
    })
    return {
      code: '400',
      message: 'Error trying to utilize credit',
      success: false
    }
  }
}

export const settleDebt: MutationResolvers['settleDebt'] = async (
  parent,
  args,
  ctx
): ResolversTypes['SettleDebtMutationResponse'] => {
  try {
    const error = await ctx.accountsService.settleDebt(args.input)
    if (error) {
      return errorToResponse(error)
    }
    return {
      code: '200',
      success: true,
      message: 'Settled debt'
    }
  } catch (error) {
    ctx.logger('Error settling debt', {
      options: args.input,
      error
    })
    return {
      code: '400',
      message: 'Error trying to settle debt',
      success: false
    }
  }
}

const errorToResponse = (
  error: CreditError
): {
  code: string
  message: string
  success: boolean
} => {
  switch (error) {
    case CreditError.InsufficientBalance:
      return {
        code: '403',
        message: 'Insufficient balance',
        success: false
      }
    case CreditError.InsufficientCredit:
      return {
        code: '403',
        message: 'Insufficient credit',
        success: false
      }
    case CreditError.InsufficientDebt:
      return {
        code: '403',
        message: 'Insufficient debt',
        success: false
      }
    case CreditError.SameAccounts:
      return {
        code: '400',
        message: 'Same accounts',
        success: false
      }
    case CreditError.UnknownAccount:
      return {
        code: '404',
        message: 'Unknown account',
        success: false
      }
    case CreditError.UnknownSubAccount:
      return {
        code: '404',
        message: 'Unknown sub-account',
        success: false
      }
    case CreditError.UnrelatedSubAccount:
      return {
        code: '400',
        message: 'Unrelated sub-account',
        success: false
      }
    default:
      throw new Error(`CreditError: ${error}`)
  }
}