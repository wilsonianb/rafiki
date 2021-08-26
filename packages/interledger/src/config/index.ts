function envString(name: string, value: string): string {
  const envValue = process.env[name]
  return envValue == null ? value : envValue
}

function envInt(name: string, value: number): number {
  const envValue = process.env[name]
  return envValue == null ? value : parseInt(envValue)
}

function envBigInt(name: string, value: bigint): bigint {
  const envValue = process.env[name]
  return envValue ? BigInt(envValue) : value
}

// function envBool(name: string, value: boolean): boolean {
//   const envValue = process.env[name]
//   return envValue == null ? value : Boolean(envValue)
// }

export const Config = {
  logLevel: envString('LOG_LEVEL', 'info'),
  port: envInt('PORT', 3002),
  adminPort: envInt('ADMIN_API_PORT', 3003),
  postgresUrl: envString(
    'POSTGRES_URL',
    'postgresql://postgres:password@localhost:5433/development'
  ),
  env: envString('NODE_ENV', 'development'),
  hmacSecret: envString('ACCOUNTS_HMAC_SECRET', 'test'),
  ilpAddress: envString('ILP_ADDRESS', 'test.rafiki'),
  peerAddresses: process.env.PEER_ADDRESSES
    ? JSON.parse(process.env.PEER_ADDRESSES)
    : [],
  redisUrl: envString('REDIS_URL', 'redis://127.0.0.1:6380'),
  tigerbeetleClusterId: envBigInt(
    'TIGERBEETLE_CLUSTER_ID',
    0x0a5ca1ab1ebee11en
  ),
  tigerbeetleReplicaAddresses: process.env.TIGERBEETLE_REPLICA_ADDRESSES
    ? JSON.parse(process.env.TIGERBEETLE_REPLICA_ADDRESSES)
    : ['3004']
}
