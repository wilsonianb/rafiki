import { knex } from 'knex'
import { Model } from 'objection'

import { Config } from './config/app'

import { RunnerOptions, run, Runner } from 'graphile-scheduler'

const DATABASE_URL = Config.databaseUrl

export const schedulerOptions: RunnerOptions = {
  connectionString: Config.databaseUrl,
  // Install signal handlers for graceful shutdown on SIGINT, SIGTERM, etc
  noHandleSignals: false,
  workerSchema: 'graphile_scheduler_worker',
  schedulerSchema: 'graphile_scheduler',
  schedules: []
}

export async function createScheduler(): Promise<Runner> {
  return run(schedulerOptions)
}
// Run if being called directly
if (require.main === module) {
  const kn = knex({
    client: 'postgresql',
    connection: DATABASE_URL,
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  })
  // node pg defaults to returning bigint as string. This ensures it parses to bigint
  kn.client.driver.types.setTypeParser(
    kn.client.driver.types.builtins.INT8,
    'text',
    BigInt
  )
  Model.knex(kn)
  createScheduler().catch((err): void => {
    console.error(err)
    process.exit(1)
  })
}
