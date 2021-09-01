import { BaseService } from '../shared/baseService'
import { ApolloClient, gql, NormalizedCacheObject } from '@apollo/client'
import { strictEqual } from 'assert'
import {
  CreateIlpAccountMutationResponse,
  CreateIlpSubAccountMutationResponse,
  ExtendCreditInput,
  ExtendCreditMutationResponse,
  IlpAccount,
  RevokeCreditInput,
  RevokeCreditMutationResponse
} from './generated/graphql'

export interface ConnectorService {
  getIlpAccount(id: string): Promise<IlpAccount>
  createIlpAccount(): Promise<CreateIlpAccountMutationResponse>
  createIlpSubAccount(
    superAccountId: string
  ): Promise<CreateIlpSubAccountMutationResponse>
  extendCredit(input: ExtendCreditInput): Promise<ExtendCreditMutationResponse>
  revokeCredit(input: RevokeCreditInput): Promise<RevokeCreditMutationResponse>
}

interface ServiceDependencies extends BaseService {
  client: ApolloClient<NormalizedCacheObject>
}

export async function createConnectorService({
  logger,
  client
}: ServiceDependencies): Promise<ConnectorService> {
  const log = logger.child({
    service: 'AdminService'
  })
  const deps: ServiceDependencies = {
    logger: log,
    client: client
  }
  return {
    getIlpAccount: (id) => getIlpAccount(deps, id),
    createIlpAccount: () => createIlpAccount(deps),
    createIlpSubAccount: (superAccountId) =>
      createIlpSubAccount(deps, superAccountId),
    extendCredit: (input) => extendCredit(deps, input),
    revokeCredit: (input) => revokeCredit(deps, input)
  }
}

async function getIlpAccount(
  deps: ServiceDependencies,
  id: string
): Promise<IlpAccount> {
  const { client } = deps

  const account = await client
    .query({
      query: gql`
        query IlpAccount($id: String!) {
          ilpAccount(id: $id) {
            id
            balance
          }
        }
      `,
      variables: {
        id: id
      }
    })
    .then(
      (query): IlpAccount => {
        if (query.data) {
          return query.data.ilpAccount
        } else {
          throw new Error('Data was empty')
        }
      }
    )
  strictEqual(account.id, id, 'account not found')
  return account
}

async function createIlpAccount(
  deps: ServiceDependencies
): Promise<CreateIlpAccountMutationResponse> {
  const { client } = deps

  const response = await client
    .mutate({
      mutation: gql`
        mutation CreateIlpAccount {
          createIlpAccount {
            code
            success
            message
            ilpAccount {
              id
            }
          }
        }
      `
    })
    .then(
      (query): CreateIlpAccountMutationResponse => {
        if (query.data) {
          return query.data.createIlpAccount
        } else {
          throw new Error('Data was empty')
        }
      }
    )

  return response
}

async function createIlpSubAccount(
  deps: ServiceDependencies,
  superAccountId: string
): Promise<CreateIlpSubAccountMutationResponse> {
  const { client } = deps

  const response = await client
    .mutate({
      mutation: gql`
        mutation CreateIlpSubAccount($superAccountId: String!) {
          createIlpSubAccount(superAccountId: $superAccountId) {
            code
            success
            message
            ilpAccount {
              id
            }
          }
        }
      `,
      variables: {
        superAccountId: superAccountId
      }
    })
    .then(
      (query): CreateIlpSubAccountMutationResponse => {
        if (query.data) {
          return query.data.createIlpSubAccount
        } else {
          throw new Error('Data was empty')
        }
      }
    )

  return response
}

function extendCredit(
  deps: ServiceDependencies,
  input: ExtendCreditInput
): Promise<ExtendCreditMutationResponse> {
  return deps.client
    .mutate({
      mutation: gql`
        mutation ExtendCredit(input: ExtendCreditInput!) {
          extendCredit(input: $input) {
            code
            success
            message
            error
          }
        }
      `,
      variables: { input }
    })
    .then(
      (query): ExtendCreditMutationResponse => {
        if (query.data) {
          return query.data.extendCredit
        } else {
          throw new Error('Data was empty')
        }
      }
    )
}

async function revokeCredit(
  deps: ServiceDependencies,
  input: RevokeCreditInput
): Promise<RevokeCreditMutationResponse> {
  return deps.client
    .mutate({
      mutation: gql`
        mutation RevokeCredit(input: RevokeCreditInput!) {
          revokeCredit(input: $input) {
            code
            success
            message
            error
          }
        }
      `,
      variables: { input }
    })
    .then(
      (query): RevokeCreditMutationResponse => {
        if (query.data) {
          return query.data.revokeCredit
        } else {
          throw new Error('Data was empty')
        }
      }
    )
}
