import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers'
import tmp from 'tmp'

import { Config } from '../config/app'

export const TIGERBEETLE_DIR = '/var/lib/tigerbeetle'
export const TIGERBEETLE_IMAGE =
  'ghcr.io/coilhq/tigerbeetle@sha256:4dcf54b7b4b9a01f71dc3ed4dabf5a7284eb7b8fd1477e30ca7f0471d0ea8a2b'
export const TIGERBEETLE_PORT = 3004

export async function startTigerbeetleContainer(
  clusterId: number = Config.tigerbeetleClusterId
): Promise<StartedTestContainer> {
  const { name: tigerbeetleDir } = tmp.dirSync({ unsafeCleanup: true })

  await new GenericContainer(TIGERBEETLE_IMAGE)
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

  return await new GenericContainer(TIGERBEETLE_IMAGE)
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
