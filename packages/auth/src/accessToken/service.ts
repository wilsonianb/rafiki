import * as crypto from 'crypto'
import { v4 } from 'uuid'
import { Transaction, TransactionOrKnex } from 'objection'
import { JWK } from 'open-payments'

import { BaseService } from '../shared/baseService'
import { Grant, GrantState } from '../grant/model'
import { ClientService } from '../client/service'
import { AccessToken } from './model'
import { IAppConfig } from '../config/app'
import { Access } from '../access/model'

export interface AccessTokenService {
  get(token: string): Promise<AccessToken>
  getByManagementId(managementId: string): Promise<AccessToken>
  introspect(token: string): Promise<Introspection | undefined>
  revoke(id: string): Promise<void>
  create(grantId: string, opts?: AccessTokenOpts): Promise<AccessToken>
  rotate(managementId: string): Promise<Rotation>
}

interface ServiceDependencies extends BaseService {
  knex: TransactionOrKnex
  clientService: ClientService
  config: IAppConfig
}

export interface KeyInfo {
  proof: string
  jwk: JWK
}

export interface Introspection extends Partial<Grant> {
  active: boolean
  key?: KeyInfo
  clientId?: string
}

interface AccessTokenOpts {
  expiresIn?: number
  trx?: Transaction
}

export type Rotation =
  | {
      success: true
      access: Array<Access>
      value: string
      managementId: string
      expiresIn?: number
    }
  | {
      success: false
      error: Error
    }

export async function createAccessTokenService({
  logger,
  knex,
  config,
  clientService
}: ServiceDependencies): Promise<AccessTokenService> {
  const log = logger.child({
    service: 'TokenService'
  })

  const deps: ServiceDependencies = {
    logger: log,
    knex,
    clientService,
    config
  }

  return {
    get: (token: string) => get(token),
    getByManagementId: (managementId: string) =>
      getByManagementId(managementId),
    introspect: (token: string) => introspect(deps, token),
    revoke: (id: string) => revoke(deps, id),
    create: (grantId: string, opts?: AccessTokenOpts) =>
      createAccessToken(deps, grantId, opts),
    rotate: (managementId: string) => rotate(deps, managementId)
  }
}

function isTokenExpired(token: AccessToken): boolean {
  const now = new Date(Date.now())
  const expiresAt = token.createdAt.getTime() + token.expiresIn * 1000
  return expiresAt < now.getTime()
}

async function get(token: string): Promise<AccessToken> {
  return AccessToken.query().findOne('value', token)
}

async function getByManagementId(managementId: string): Promise<AccessToken> {
  return AccessToken.query().findOne('managementId', managementId)
}

async function introspect(
  deps: ServiceDependencies,
  value: string
): Promise<Introspection | undefined> {
  const token = await AccessToken.query(deps.knex).findOne({ value })

  if (!token) return
  if (isTokenExpired(token)) {
    return { active: false }
  } else {
    const grant = await Grant.query(deps.knex)
      .findById(token.grantId)
      .withGraphFetched('access')
    if (grant.state === GrantState.Revoked) {
      return { active: false }
    }

    const jwk = await deps.clientService.getKey({
      client: grant.client,
      keyId: grant.clientKeyId
    })

    if (!jwk) {
      return { active: false }
    }

    const clientId = crypto
      .createHash('sha256')
      .update(grant.client)
      .digest('hex')

    return {
      active: true,
      ...grant,
      key: { proof: 'httpsig', jwk },
      clientId
    }
  }
}

async function revoke(deps: ServiceDependencies, id: string): Promise<void> {
  const token = await AccessToken.query(deps.knex).findOne({ managementId: id })
  if (token) {
    await token.$query(deps.knex).delete()
  }
}

async function createAccessToken(
  deps: ServiceDependencies,
  grantId: string,
  opts?: AccessTokenOpts
): Promise<AccessToken> {
  return AccessToken.query(opts?.trx || deps.knex).insert({
    value: crypto.randomBytes(8).toString('hex').toUpperCase(),
    managementId: v4(),
    grantId,
    expiresIn: opts?.expiresIn || deps.config.accessTokenExpirySeconds
  })
}

async function rotate(
  deps: ServiceDependencies,
  managementId: string
): Promise<Rotation> {
  let token = await AccessToken.query(deps.knex).findOne({ managementId })
  if (token) {
    await token.$query(deps.knex).delete()
    token = await AccessToken.query(deps.knex).insertAndFetch({
      value: crypto.randomBytes(8).toString('hex').toUpperCase(),
      grantId: token.grantId,
      expiresIn: token.expiresIn,
      managementId: v4()
    })
    const access = await Access.query(deps.knex).where({
      grantId: token.grantId
    })
    return {
      success: true,
      access,
      value: token.value,
      managementId: token.managementId,
      expiresIn: token.expiresIn
    }
  } else {
    return {
      success: false,
      error: new Error('token not found')
    }
  }
}
