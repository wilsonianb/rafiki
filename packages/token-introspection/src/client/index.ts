import axios, { AxiosInstance } from 'axios'
import { createOpenAPI, OpenAPI } from 'openapi'
import path from 'path'
import createLogger, { Logger } from 'pino'
import config from '../config'
import { createIntrospectionRoutes, IntrospectionRoutes } from './introspection'

export interface BaseDeps {
  axiosInstance: AxiosInstance
  logger: Logger
}

export interface RouteDeps extends BaseDeps {
  openApi: OpenAPI
}

export interface CreateClientArgs {
  logger?: Logger
  requestTimeoutMs?: number
  url: string
}

export type Client = IntrospectionRoutes

export const createClient = async (args: CreateClientArgs): Promise<Client> => {
  const axiosInstance = createAxiosInstance({
    url: args.url,
    requestTimeoutMs:
      args?.requestTimeoutMs ?? config.DEFAULT_REQUEST_TIMEOUT_MS
  })
  const openApi = await createOpenAPI(
    path.resolve(__dirname, '../openapi/token-introspection.yaml')
  )
  const logger = args?.logger ?? createLogger()

  return createIntrospectionRoutes({
    axiosInstance,
    logger,
    openApi
  })
}

export const createAxiosInstance = (args: {
  url: string
  requestTimeoutMs: number
}): AxiosInstance => {
  const axiosInstance = axios.create({
    baseURL: args.url,
    method: 'post',
    timeout: args.requestTimeoutMs
  })
  axiosInstance.defaults.headers.common['Content-Type'] = 'application/json'

  return axiosInstance
}
