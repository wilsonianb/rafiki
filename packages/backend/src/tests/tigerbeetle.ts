import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers'
import tmp from 'tmp'

import { Config } from '../config/app'

const TIGERBEETLE_DIR = '/var/lib/tigerbeetle'
export const TIGERBEETLE_PORT = 3004

export async function startTigerbeetleContainer(
  clusterId: number = Config.tigerbeetleClusterId
): Promise<StartedTestContainer> {
  const { name: tigerbeetleDir } = tmp.dirSync({ unsafeCleanup: true })

  await new GenericContainer(
    'ghcr.io/wilsonianb/tigerbeetle@sha256:6ef63cd0cd42501f7f91750f1aafdf152f0a4509268fa63b456d843168efd3cf'
  )
    .withExposedPorts(TIGERBEETLE_PORT)
    .withBindMount(tigerbeetleDir, TIGERBEETLE_DIR)
    .withCmd([
      'init',
      '--cluster=' + clusterId,
      '--replica=0',
      '--directory=' + TIGERBEETLE_DIR
    ])
    .withWaitStrategy(Wait.forLogMessage(/initialized data file/))
    .start()

  return await new GenericContainer(
    'ghcr.io/wilsonianb/tigerbeetle@sha256:6ef63cd0cd42501f7f91750f1aafdf152f0a4509268fa63b456d843168efd3cf'
  )
    .withExposedPorts(TIGERBEETLE_PORT)
    .withBindMount(tigerbeetleDir, TIGERBEETLE_DIR)
    .withCmd([
      'start',
      '--cluster=' + clusterId,
      '--replica=0',
      '--addresses=0.0.0.0:' + TIGERBEETLE_PORT,
      '--directory=' + TIGERBEETLE_DIR
    ])
    .withWaitStrategy(Wait.forLogMessage(/listening on/))
    .start()
}
