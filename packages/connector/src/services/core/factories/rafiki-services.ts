import * as crypto from 'crypto'
import { Factory } from 'rosie'
import IORedis from 'ioredis'
import { StreamServer } from '@interledger/stream-receiver'
import { RafikiServices } from '../rafiki'
import { MockAccountsService } from '../test/mocks/accounts-service'
import { TestLoggerFactory } from './test-logger'

interface MockRafikiServices extends RafikiServices {
  accounts: MockAccountsService
}

export const RafikiServicesFactory = Factory.define<MockRafikiServices>(
  'PeerInfo'
)
  //.attr('router', ['peers'], (peers: InMemoryPeers) => {
  //  return new InMemoryRouter(peers, { ilpAddress: 'test.rafiki' })
  //})
  .option('ilpAddress', 'test.rafiki')
  .attr('accounts', ['ilpAddress'], (ilpAddress: string) => {
    return new MockAccountsService(ilpAddress)
  })
  .attr('logger', TestLoggerFactory.build())
  .option('redisUrl', 'redis://127.0.0.1:6380')
  .attr(
    'redis',
    ['redisUrl'],
    (redisUrl: string) =>
      new IORedis(redisUrl, {
        // lazyConnect so that tests that don't use Redis don't have to disconnect it when they're finished.
        lazyConnect: true,
        stringNumbers: true
      })
  )
  .attr(
    'streamServer',
    new StreamServer({
      serverAddress: 'test.rafiki',
      serverSecret: crypto.randomBytes(32)
    })
  )
