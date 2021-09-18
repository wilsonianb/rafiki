module.exports = async () => {
  if (global.__TIGERBEETLE__) {
    await global.__TIGERBEETLE__.stop()
  }
}
