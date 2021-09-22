import { Logger as PinoLogger } from '../logger/service'

type Logger = typeof PinoLogger

export interface BaseService {
  logger: Logger
}
