// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GenericContainer } = require('testcontainers')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NodeEnvironment = require('jest-environment-node')

class CustomEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context)
  }

  async setup() {
    await super.setup()

    const redisContainer = await new GenericContainer('redis')
      .withExposedPorts(6379)
      .start()

    this.global.__REDIS__ = redisContainer
    this.global.__REDIS_URL__ = `redis://localhost:${redisContainer.getMappedPort(
      6379
    )}`
  }

  async teardown() {
    await this.global.__REDIS__.stop()
    await super.teardown()
  }

  getVmContext() {
    return super.getVmContext()
  }
}

module.exports = CustomEnvironment
