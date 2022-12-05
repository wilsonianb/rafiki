import { faker } from '@faker-js/faker'
import nock from 'nock'
import { Knex } from 'knex'
import crypto from 'crypto'
import { v4 } from 'uuid'

import { createTestApp, TestContainer } from '../tests/app'
import { Config } from '../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer, JWKWithRequired } from '..'
import { AppServices } from '../app'
import { truncateTables } from '../tests/tableManager'
import { FinishMethod, Grant, GrantState, StartMethod } from '../grant/model'
import { AccessType, Action } from '../access/types'
import { AccessToken } from './model'
import { AccessTokenService } from './service'
import { Access } from '../access/model'
import { generateTestKeys } from '../tests/signature'

describe('Access Token Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let trx: Knex.Transaction
  let accessTokenService: AccessTokenService
  let testJwk: JWKWithRequired

  beforeAll(async (): Promise<void> => {
    deps = await initIocContainer(Config)
    appContainer = await createTestApp(deps)
    knex = await deps.use('knex')
    accessTokenService = await deps.use('accessTokenService')

    const keys = await generateTestKeys()
    testJwk = keys.publicKey
  })

  afterEach(async (): Promise<void> => {
    jest.useRealTimers()
    await truncateTables(knex)
  })

  afterAll(async (): Promise<void> => {
    nock.restore()
    await appContainer.shutdown()
  })

  const CLIENT = faker.internet.url()

  const BASE_GRANT = {
    state: GrantState.Pending,
    startMethod: [StartMethod.Redirect],
    finishMethod: FinishMethod.Redirect,
    finishUri: 'https://example.com/finish',
    clientNonce: crypto.randomBytes(8).toString('hex').toUpperCase(),
    client: CLIENT
  }

  const BASE_ACCESS = {
    type: AccessType.OutgoingPayment,
    actions: [Action.Read, Action.Create],
    identifier: `https://example.com/${v4()}`,
    limits: {
      receiver: 'https://wallet.com/alice',
      sendAmount: {
        value: '400',
        assetCode: 'USD',
        assetScale: 2
      }
    }
  }

  const BASE_TOKEN = {
    expiresIn: 3600
  }

  let grant: Grant
  let token: AccessToken
  beforeEach(async (): Promise<void> => {
    grant = await Grant.query(trx).insertAndFetch({
      ...BASE_GRANT,
      clientKeyId: testJwk.kid,
      continueToken: crypto.randomBytes(8).toString('hex').toUpperCase(),
      continueId: v4(),
      interactId: v4(),
      interactRef: crypto.randomBytes(8).toString('hex').toUpperCase(),
      interactNonce: crypto.randomBytes(8).toString('hex').toUpperCase()
    })
    grant.access = [
      await Access.query(trx).insertAndFetch({
        grantId: grant.id,
        ...BASE_ACCESS
      })
    ]
    token = await AccessToken.query(trx).insertAndFetch({
      grantId: grant.id,
      ...BASE_TOKEN,
      value: crypto.randomBytes(8).toString('hex').toUpperCase(),
      managementId: v4()
    })
  })

  describe('Create', (): void => {
    test('Can create access token', async (): Promise<void> => {
      const accessToken = await accessTokenService.create(grant.id)
      expect(accessToken).toMatchObject({
        grantId: grant.id,
        managementId: expect.any(String),
        value: expect.any(String)
      })
    })
  })

  describe('Get', (): void => {
    let accessToken: AccessToken
    beforeEach(async (): Promise<void> => {
      accessToken = await AccessToken.query(trx).insert({
        value: 'test-access-token',
        managementId: v4(),
        grantId: grant.id,
        expiresIn: 1234
      })
    })

    test('Can get an access token by its value', async (): Promise<void> => {
      const fetchedToken = await accessTokenService.get(accessToken.value)
      expect(fetchedToken.value).toEqual(accessToken.value)
      expect(fetchedToken.managementId).toEqual(accessToken.managementId)
      expect(fetchedToken.grantId).toEqual(accessToken.grantId)
    })

    test('Can get an access token by its managementId', async (): Promise<void> => {
      const fetchedToken = await accessTokenService.getByManagementId(
        accessToken.managementId
      )
      expect(fetchedToken.value).toEqual(accessToken.value)
      expect(fetchedToken.managementId).toEqual(accessToken.managementId)
      expect(fetchedToken.grantId).toEqual(accessToken.grantId)
    })
  })

  describe('Introspect', (): void => {
    test('Can introspect active token', async (): Promise<void> => {
      await expect(accessTokenService.introspect(token.value)).resolves.toEqual(
        grant
      )
    })

    test('Can introspect expired token', async (): Promise<void> => {
      const tokenCreatedDate = new Date(token.createdAt)
      const now = new Date(
        tokenCreatedDate.getTime() + (token.expiresIn + 1) * 1000
      )
      jest.useFakeTimers({ now })
      await expect(
        accessTokenService.introspect(token.value)
      ).resolves.toBeUndefined()
    })

    test('Can introspect active token for revoked grant', async (): Promise<void> => {
      await grant.$query(trx).patch({ state: GrantState.Revoked })
      await expect(
        accessTokenService.introspect(token.value)
      ).resolves.toBeUndefined()
    })

    test('Cannot introspect non-existing token', async (): Promise<void> => {
      expect(accessTokenService.introspect('uuid')).resolves.toBeUndefined()
    })
  })

  describe('Revoke', (): void => {
    let grant: Grant
    let token: AccessToken
    beforeEach(async (): Promise<void> => {
      grant = await Grant.query(trx).insertAndFetch({
        ...BASE_GRANT,
        clientKeyId: testJwk.kid,
        continueToken: crypto.randomBytes(8).toString('hex').toUpperCase(),
        continueId: v4(),
        interactId: v4(),
        interactRef: crypto.randomBytes(8).toString('hex').toUpperCase(),
        interactNonce: crypto.randomBytes(8).toString('hex').toUpperCase()
      })
      token = await AccessToken.query(trx).insertAndFetch({
        grantId: grant.id,
        ...BASE_TOKEN,
        value: crypto.randomBytes(8).toString('hex').toUpperCase(),
        managementId: v4()
      })
    })
    test('Can revoke un-expired token', async (): Promise<void> => {
      await token.$query(trx).patch({ expiresIn: 1000000 })
      const result = await accessTokenService.revoke(token.managementId)
      expect(result).toBeUndefined()
      await expect(
        AccessToken.query(trx).findById(token.id)
      ).resolves.toBeUndefined()
    })
    test('Can revoke even if token has already expired', async (): Promise<void> => {
      await token.$query(trx).patch({ expiresIn: -1 })
      const result = await accessTokenService.revoke(token.managementId)
      expect(result).toBeUndefined()
      await expect(
        AccessToken.query(trx).findById(token.id)
      ).resolves.toBeUndefined()
    })
    test('Can revoke even if token has already been revoked', async (): Promise<void> => {
      await token.$query(trx).delete()
      const result = await accessTokenService.revoke(token.id)
      expect(result).toBeUndefined()
      await expect(
        AccessToken.query(trx).findById(token.id)
      ).resolves.toBeUndefined()
    })
  })

  describe('Rotate', (): void => {
    let grant: Grant
    let token: AccessToken
    let originalTokenValue: string
    beforeEach(async (): Promise<void> => {
      grant = await Grant.query(trx).insertAndFetch({
        ...BASE_GRANT,
        clientKeyId: testJwk.kid,
        continueToken: crypto.randomBytes(8).toString('hex').toUpperCase(),
        continueId: v4(),
        interactId: v4(),
        interactRef: crypto.randomBytes(8).toString('hex').toUpperCase(),
        interactNonce: crypto.randomBytes(8).toString('hex').toUpperCase()
      })
      await Access.query(trx).insertAndFetch({
        grantId: grant.id,
        ...BASE_ACCESS
      })
      token = await AccessToken.query(trx).insertAndFetch({
        grantId: grant.id,
        ...BASE_TOKEN,
        value: crypto.randomBytes(8).toString('hex').toUpperCase(),
        managementId: v4()
      })
      originalTokenValue = token.value
    })

    test('Can rotate un-expired token', async (): Promise<void> => {
      await token.$query(trx).patch({ expiresIn: 1000000 })
      const result = await accessTokenService.rotate(token.managementId)
      expect(result.success).toBe(true)
      expect(result.success && result.value).not.toBe(originalTokenValue)
    })
    test('Can rotate expired token', async (): Promise<void> => {
      await token.$query(trx).patch({ expiresIn: -1 })
      const result = await accessTokenService.rotate(token.managementId)
      expect(result.success).toBe(true)
      const rotatedToken = await AccessToken.query(trx).findOne({
        managementId: result.success && result.managementId
      })
      expect(rotatedToken).toBeDefined()
      expect(rotatedToken?.value).not.toBe(originalTokenValue)
    })
    test('Cannot rotate nonexistent token', async (): Promise<void> => {
      const result = await accessTokenService.rotate(v4())
      expect(result.success).toBe(false)
    })
  })
})
