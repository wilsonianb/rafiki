import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../app'
import { createTestApp, TestContainer } from '../tests/app'
import { SessionService } from './service'
import { initIocContainer } from '..'
import { Redis } from 'ioredis'
import { Config } from '../config/app'
import { isSessionError, SessionError } from './errors'

describe('Session Key Service', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let SessionService: SessionService
  let redis: Redis

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      SessionService = await deps.use('sessionService')
      redis = await deps.use('redis')
    }
  )

  afterEach(
    async (): Promise<void> => {
      await redis.flushdb()
    }
  )

  afterAll(
    async (): Promise<void> => {
      await redis.disconnect()
      await appContainer.shutdown()
    }
  )

  describe('Create / Get Session', (): void => {
    test('Can create and fetch session', async (): Promise<void> => {
      const session = await SessionService.create()
      expect(session).toHaveProperty('key')
      expect(session).toHaveProperty('expiresAt')
      const retrievedSession = await SessionService.get({
        key: session.key
      })
      expect(retrievedSession).toEqual({ expiresAt: session.expiresAt })
    })

    test('Cannot fetch non-existing session', async (): Promise<void> => {
      const sessionOrError = SessionService.get({ key: '123' })
      expect(sessionOrError).resolves.toEqual(SessionError.UnknownSession)
    })
  })

  describe('Manage Session', (): void => {
    test('Can revoke a session', async (): Promise<void> => {
      const session = await SessionService.create()
      await SessionService.revoke({ key: session.key })
      const revokedSessionOrError = SessionService.get({
        key: session.key
      })
      expect(revokedSessionOrError).resolves.toEqual(
        SessionError.UnknownSession
      )
    })

    test('Can refresh a session', async (): Promise<void> => {
      const session = await SessionService.create()
      const refreshSessionOrError = await SessionService.refresh({
        key: session.key
      })
      if (isSessionError(refreshSessionOrError)) {
        fail()
      } else {
        expect(session.key).not.toEqual(refreshSessionOrError.key)
        expect(session.expiresAt.getTime()).toBeLessThanOrEqual(
          refreshSessionOrError.expiresAt.getTime()
        )
      }
    })

    test('Cannot refresh non-existing session', async (): Promise<void> => {
      const refreshSessionOrError = SessionService.refresh({ key: '123' })
      expect(refreshSessionOrError).resolves.toEqual(
        SessionError.UnknownSession
      )
    })
  })
})