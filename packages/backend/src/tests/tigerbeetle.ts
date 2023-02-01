import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers'
import tmp from 'tmp'
import fs from 'fs'

import { Config } from '../config/app'

const TIGERBEETLE_PORT = 3004
const TIGERBEETLE_DIR = '/var/lib/tigerbeetle'
const { name: TIGERBEETLE_DIR_HOST } = tmp.dirSync({ unsafeCleanup: true })
const TIGERBEETLE_CONTAINER_LOG =
  process.env.TIGERBEETLE_CONTAINER_LOG === 'true'

export async function startTigerbeetleContainer(
  clusterId?: number
): Promise<{ container: StartedTestContainer; port: number }> {
  const tigerbeetleClusterId = clusterId || Config.tigerbeetleClusterId

  const tigerbeetleFile = `cluster_${tigerbeetleClusterId}_replica_0_test.tigerbeetle`

  const tbContFormat = await new GenericContainer(
    'ghcr.io/tigerbeetledb/tigerbeetle@sha256:c376d8d6c6b206de630cd703eda1ea4c580e6f7fed52aa5bc84dc935d52f5a41'
  )
    .withExposedPorts(TIGERBEETLE_PORT)
    .withBindMounts([
      {
        source: TIGERBEETLE_DIR_HOST,
        target: TIGERBEETLE_DIR
      }
    ])
    .withAddedCapabilities('IPC_LOCK')
    .withCommand([
      'format',
      '--cluster=' + tigerbeetleClusterId,
      '--replica=0',
      `${TIGERBEETLE_DIR}/${tigerbeetleFile}`
    ])
    .withWaitStrategy(
      Wait.forLogMessage(
        `info(main): 0: formatted: cluster=${tigerbeetleClusterId}`
      )
    )
    .start()

  const streamTbFormat = await tbContFormat.logs()
  if (TIGERBEETLE_CONTAINER_LOG) {
    streamTbFormat
      .on('data', (line) => console.log(line))
      .on('err', (line) => console.error(line))
      .on('end', () => console.log('Stream closed for [tb-format]'))
  }

  //copy formatted data file
  await fs.promises.copyFile(
    `${TIGERBEETLE_DIR_HOST}/${tigerbeetleFile}`,
    `${TIGERBEETLE_DIR_HOST}/${tigerbeetleFile}_copy`
  )
  console.log(await fs.promises.readdir(TIGERBEETLE_DIR_HOST))

  const tbContStart = await new GenericContainer(
    'ghcr.io/tigerbeetledb/tigerbeetle@sha256:c376d8d6c6b206de630cd703eda1ea4c580e6f7fed52aa5bc84dc935d52f5a41'
  )
    .withExposedPorts(TIGERBEETLE_PORT)
    .withBindMounts([
      {
        source: TIGERBEETLE_DIR_HOST,
        target: TIGERBEETLE_DIR
      }
    ])
    .withAddedCapabilities('IPC_LOCK')
    .withCommand([
      'start',
      '--addresses=0.0.0.0:' + TIGERBEETLE_PORT,
      `${TIGERBEETLE_DIR}/${tigerbeetleFile}`
    ])
    .withWaitStrategy(
      Wait.forLogMessage(
        `info(main): 0: cluster=${tigerbeetleClusterId}: listening on 0.0.0.0:${TIGERBEETLE_PORT}`
      )
    )
    .start()

  const streamTbStart = await tbContStart.logs()
  if (TIGERBEETLE_CONTAINER_LOG) {
    streamTbStart
      .on('data', (line) => console.log(line))
      .on('err', (line) => console.error(line))
      .on('end', () => console.log('Stream closed for [tb-start]'))
  }
  return {
    container: tbContStart,
    port: tbContStart.getMappedPort(TIGERBEETLE_PORT)
  }
}

export async function purgeTigerbeetleData(clusterId?: number): Promise<void> {
  const tigerbeetleClusterId = clusterId || Config.tigerbeetleClusterId
  const tigerbeetleFile = `cluster_${tigerbeetleClusterId}_replica_0_test.tigerbeetle`

  await fs.promises.rm(`${TIGERBEETLE_DIR_HOST}/${tigerbeetleFile}`)
  console.log(await fs.promises.readdir(TIGERBEETLE_DIR_HOST))

  await fs.promises.copyFile(
    `${TIGERBEETLE_DIR_HOST}/${tigerbeetleFile}_copy`,
    `${TIGERBEETLE_DIR_HOST}/${tigerbeetleFile}`
  )
  console.log(await fs.promises.readdir(TIGERBEETLE_DIR_HOST))
}
