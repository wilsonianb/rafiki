// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GenericContainer, Wait } = require('testcontainers')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tmp = require('tmp')

tmp.setGracefulCleanup()

const TIGERBEETLE_CLUSTER_ID = 1
const TIGERBEETLE_PORT = 3001
const TIGERBEETLE_DIR = '/var/lib/tigerbeetle'

module.exports = async () => {
  if (!process.env.TIGERBEETLE_REPLICA_ADDRESSES) {
    const { name: tigerbeetleDir } = tmp.dirSync({ unsafeCleanup: true })

    await new GenericContainer('ghcr.io/wilsonianb/tigerbeetle:clients-max')
      .withExposedPorts(TIGERBEETLE_PORT)
      .withBindMount(tigerbeetleDir, TIGERBEETLE_DIR)
      .withCmd([
        'init',
        '--cluster=' + TIGERBEETLE_CLUSTER_ID,
        '--replica=0',
        '--directory=' + TIGERBEETLE_DIR
      ])
      .withWaitStrategy(Wait.forLogMessage(/initialized data file/))
      .start()

    const tigerbeetleContainer = await new GenericContainer(
      'ghcr.io/wilsonianb/tigerbeetle:clients-max'
    )
      .withExposedPorts(TIGERBEETLE_PORT)
      .withBindMount(tigerbeetleDir, TIGERBEETLE_DIR)
      .withCmd([
        'start',
        '--cluster=' + TIGERBEETLE_CLUSTER_ID,
        '--replica=0',
        '--addresses=0.0.0.0:' + TIGERBEETLE_PORT,
        '--directory=' + TIGERBEETLE_DIR
      ])
      .withWaitStrategy(Wait.forLogMessage(/listening on/))
      .start()

    process.env.TIGERBEETLE_CLUSTER_ID = TIGERBEETLE_CLUSTER_ID
    process.env.TIGERBEETLE_REPLICA_ADDRESSES = `[${tigerbeetleContainer.getMappedPort(
      TIGERBEETLE_PORT
    )}]`
    global.__TIGERBEETLE__ = tigerbeetleContainer
  }
}
