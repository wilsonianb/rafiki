import {
  AccountResolvers,
  QueryResolvers,
  ResolversTypes,
  MutationResolvers
} from '../generated/graphql'
import { ApolloContext } from '../../app'

export const getAccount: QueryResolvers<ApolloContext>['account'] = async (
  parent,
  args,
  ctx
): ResolversTypes['Account'] => {
  const accountService = await ctx.container.use('accountService')
  const account = await accountService.get(args.id)
  if (!account) {
    throw new Error('No account')
  }
  return account
}

export const getAccountBalance: AccountResolvers<ApolloContext>['balance'] = async (
  parent,
  args,
  ctx
): ResolversTypes['UInt64'] => {
  if (!parent.id) throw new Error('missing account id')
  const accountingService = await ctx.container.use('accountingService')
  const balance = await accountingService.getBalance(parent.id)
  if (balance === undefined) {
    throw new Error('No account balances')
  }
  return balance
}

export const createAccount: MutationResolvers<ApolloContext>['createAccount'] = async (
  parent,
  args,
  ctx
): ResolversTypes['CreateAccountMutationResponse'] => {
  try {
    const accountService = await ctx.container.use('accountService')
    const account = await accountService.create(args.input)
    return {
      code: '200',
      success: true,
      message: 'Created Account',
      account: {
        ...account,
        balance: BigInt(0)
      }
    }
  } catch (error) {
    ctx.logger.error(
      {
        options: args.input,
        error
      },
      'error creating account'
    )
    return {
      code: '500',
      message: 'Error trying to create account',
      success: false
    }
  }
}
