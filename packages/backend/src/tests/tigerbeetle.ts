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
    'ghcr.io/coilhq/tigerbeetle@sha256:576957b8d4fadd03de01ab3983529d73d6767cd834aa8786340fc67fcd39cb69'
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

  const tigerbeetleContainer = await new GenericContainer(
    'ghcr.io/coilhq/tigerbeetle@sha256:e2e9717c7f9bb916c9a1b7904fc5c84a522d6346efeacc65c2b19c204e50e4a3'
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

  const stream = await tigerbeetleContainer.logs()
  stream
    .on('data', (line) => console.log(line))
    .on('err', (line) => console.error(line))
    .on('end', () => console.log('Stream closed'))

  return tigerbeetleContainer
}
