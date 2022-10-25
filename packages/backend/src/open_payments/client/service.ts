import { Counter, ResolvedPayment } from '@interledger/pay'
import { createMockContext } from '@shopify/jest-koa-mocks'
import { Access, ApprovedGrant } from 'auth'
import axios, { AxiosInstance, AxiosResponse } from 'axios'
import base64url from 'base64url'
import { OpenAPI, HttpMethod, ValidateFunction } from 'openapi'
import { URL } from 'url'

import { Amount, parseAmount } from '../amount'
import { ConnectionRoutes } from '../connection/routes'
import { ConnectionBase, ConnectionJSON } from '../connection/service'
import { IncomingPaymentJSON } from '../payment/incoming/model'
import { IncomingPaymentRoutes } from '../payment/incoming/routes'
import { PaymentPointerJSON } from '../payment_pointer/model'
import { PaymentPointerRoutes } from '../payment_pointer/routes'
import { PaymentPointerService } from '../payment_pointer/service'
import { ReadContext } from '../../app'
import { AssetOptions } from '../../asset/service'
import { BaseService } from '../../shared/baseService'

const REQUEST_TIMEOUT = 5_000 // millseconds

export class Receiver extends ConnectionBase {
  static fromConnection(connection: ConnectionJSON): Receiver {
    return new this(connection)
  }

  static fromIncomingPayment(
    incomingPayment: IncomingPaymentJSON
  ): Receiver | undefined {
    if (incomingPayment.completed) {
      return undefined
    }
    if (typeof incomingPayment.ilpStreamConnection !== 'object') {
      return undefined
    }
    if (
      incomingPayment.expiresAt &&
      new Date(incomingPayment.expiresAt).getTime() <= Date.now()
    ) {
      return undefined
    }
    const receivedAmount = parseAmount(incomingPayment.receivedAmount)
    const incomingAmount = incomingPayment.incomingAmount
      ? parseAmount(incomingPayment.incomingAmount)
      : undefined

    return new this(
      incomingPayment.ilpStreamConnection,
      incomingAmount?.value,
      receivedAmount.value
    )
  }

  private constructor(
    connection: ConnectionJSON,
    private readonly incomingAmountValue?: bigint,
    private readonly receivedAmountValue?: bigint
  ) {
    super(
      connection.ilpAddress,
      base64url.toBuffer(connection.sharedSecret),
      connection.assetCode,
      connection.assetScale
    )
  }

  public get asset(): AssetOptions {
    return {
      code: this.assetCode,
      scale: this.assetScale
    }
  }

  public get incomingAmount(): Amount | undefined {
    if (this.incomingAmountValue) {
      return {
        value: this.incomingAmountValue,
        assetCode: this.assetCode,
        assetScale: this.assetScale
      }
    }
    return undefined
  }

  public get receivedAmount(): Amount | undefined {
    if (this.receivedAmountValue !== undefined) {
      return {
        value: this.receivedAmountValue,
        assetCode: this.assetCode,
        assetScale: this.assetScale
      }
    }
    return undefined
  }

  public toResolvedPayment(): ResolvedPayment {
    return {
      destinationAsset: this.asset,
      destinationAddress: this.ilpAddress,
      sharedSecret: this.sharedSecret,
      requestCounter: Counter.from(0)
    }
  }
}

export interface OpenPaymentsClientService {
  paymentPointer: {
    get(url: string): Promise<PaymentPointerJSON | undefined>
  }
  receiver: {
    get(url: string, accessToken?: string): Promise<Receiver | undefined>
  }
  grant: {
    create(url: string, access: Access): Promise<ApprovedGrant | undefined>
  }
}

interface ServiceDependencies extends BaseService {
  axios: AxiosInstance
  connectionRoutes: ConnectionRoutes
  incomingPaymentRoutes: IncomingPaymentRoutes
  openApi: OpenAPI
  authOpenApi: OpenAPI
  openPaymentsUrl: string
  // paymentPointer: string
  paymentPointerRoutes: PaymentPointerRoutes
  paymentPointerService: PaymentPointerService
  validateConnection: ValidateFunction<ConnectionJSON>
  validateIncomingPayment: ValidateFunction<IncomingPaymentJSON>
  validatePaymentPointer: ValidateFunction<PaymentPointerJSON>
  validateGrantResponse: ValidateFunction<ApprovedGrant>
}

export async function createOpenPaymentsClientService(
  deps_: Omit<
    ServiceDependencies,
    | 'axios'
    | 'validateConnection'
    | 'validateIncomingPayment'
    | 'validatePaymentPointer'
    | 'validateGrantResponse'
  >
): Promise<OpenPaymentsClientService> {
  const log = deps_.logger.child({
    service: 'OpenPaymentsClientService'
  })
  const axiosInstance = axios.create({
    timeout: REQUEST_TIMEOUT
  })
  axiosInstance.defaults.headers.common['Content-Type'] = 'application/json'

  const deps: ServiceDependencies = {
    ...deps_,
    logger: log,
    axios: axiosInstance,
    validateConnection: deps_.openApi.createResponseValidator<ConnectionJSON>({
      path: '/connections/{id}',
      method: HttpMethod.GET
    }),
    validateIncomingPayment:
      deps_.openApi.createResponseValidator<IncomingPaymentJSON>({
        path: '/incoming-payments/{id}',
        method: HttpMethod.GET
      }),
    validatePaymentPointer:
      deps_.openApi.createResponseValidator<PaymentPointerJSON>({
        path: '/',
        method: HttpMethod.GET
      }),
    validateGrantResponse:
      deps_.authOpenApi.createResponseValidator<ApprovedGrant>({
        path: '/',
        method: HttpMethod.POST
      })
  }
  return {
    grant: {
      create: (url, options) => createGrant(deps, url, options)
    },
    paymentPointer: {
      get: (url) => getPaymentPointer(deps, url)
    },
    receiver: {
      get: (url, accessToken) => getReceiver(deps, url, accessToken)
    }
  }
}

async function postResource(
  deps: ServiceDependencies,
  {
    url,
    body,
    expectedStatus = 201
  }: {
    url: string
    body: Record<string, unknown>
    expectedStatus?: number
  }
): Promise<AxiosResponse> {
  const requestUrl = new URL(url)
  if (process.env.NODE_ENV === 'development') {
    requestUrl.protocol = 'http'
  }
  return await deps.axios.post(requestUrl.href, body, {
    // TODO: https://github.com/interledger/rafiki/issues/587
    // headers: {
    //   Signature: 'TODO',
    //   'Signature-Input': 'TODO'
    // },
    validateStatus: (status) => status === expectedStatus
  })
}

const createReadContext = (params?: { id: string }): ReadContext =>
  createMockContext({
    headers: { Accept: 'application/json' },
    method: 'GET',
    customProperties: {
      params
    }
  }) as ReadContext

async function getResource(
  deps: ServiceDependencies,
  {
    url,
    accessToken,
    expectedStatus = 200
  }: {
    url: string
    accessToken?: string
    expectedStatus?: number
  }
): Promise<AxiosResponse> {
  const requestUrl = new URL(url)
  if (process.env.NODE_ENV === 'development') {
    requestUrl.protocol = 'http'
  }
  return await deps.axios.get(requestUrl.href, {
    headers: accessToken
      ? {
          Authorization: `GNAP ${accessToken}`,
          // TODO: https://github.com/interledger/rafiki/issues/587
          Signature: 'TODO',
          'Signature-Input': 'TODO'
        }
      : {},
    validateStatus: (status) => status === expectedStatus
  })
}

// TODO: support interact
async function createGrant(
  deps: ServiceDependencies,
  url: string,
  access: Access
): Promise<ApprovedGrant | undefined> {
  try {
    const body = {
      access_token: {
        access
      },
      // client: deps.paymentPointer
      client: deps.openPaymentsUrl
    }
    const { status, data } = await postResource(deps, {
      url,
      body,
      expectedStatus: 200
    })
    if (
      !deps.validateGrantResponse({
        status,
        body: data
      })
    ) {
      throw new Error('unreachable')
    }
    return data
  } catch (_) {
    return undefined
  }
}

async function getPaymentPointer(
  deps: ServiceDependencies,
  url: string
): Promise<PaymentPointerJSON | undefined> {
  // Check if this is a local payment pointer
  const paymentPointer = await deps.paymentPointerService.getByUrl(url)
  if (paymentPointer) {
    const ctx = createReadContext()
    ctx.paymentPointer = paymentPointer
    await deps.paymentPointerRoutes.get(ctx)
    return ctx.body as PaymentPointerJSON
  }
  try {
    const { status, data } = await getResource(deps, {
      url
    })
    if (
      !deps.validatePaymentPointer({
        status,
        body: data
      })
    ) {
      throw new Error('unreachable')
    }
    return data
  } catch (_) {
    return undefined
  }
}

async function getConnection(
  deps: ServiceDependencies,
  url: string
): Promise<ConnectionJSON | undefined> {
  try {
    // Check if this is a local incoming payment connection
    if (url.startsWith(`${deps.openPaymentsUrl}/connections/`)) {
      const ctx = createReadContext({
        id: url.slice(-36)
      })
      await deps.connectionRoutes.get(ctx)
      return ctx.body as ConnectionJSON
    }
    const { status, data } = await getResource(deps, {
      url
    })
    if (
      !deps.validateConnection({
        status,
        body: data
      })
    ) {
      throw new Error('unreachable')
    }
    return data
  } catch (_) {
    return undefined
  }
}

const INCOMING_PAYMENT_URL_REGEX =
  /(?<paymentPointerUrl>^(.)+)\/incoming-payments\/(?<id>(.){36}$)/

export interface IncomingPaymentUrl {
  paymentPointerUrl: string
  id: string
}

export const parseIncomingPaymentUrl = (
  url: string
): IncomingPaymentUrl | undefined =>
  url.match(INCOMING_PAYMENT_URL_REGEX)?.groups as unknown as IncomingPaymentUrl

async function getIncomingPayment(
  deps: ServiceDependencies,
  url: string,
  accessToken?: string
): Promise<IncomingPaymentJSON | undefined> {
  try {
    const match = url.match(INCOMING_PAYMENT_URL_REGEX)?.groups
    if (!match) {
      return undefined
    }
    // if (!accessToken) {
    // Check if this is a local payment pointer
    const paymentPointer = await deps.paymentPointerService.getByUrl(
      match.paymentPointerUrl
    )
    if (paymentPointer) {
      const ctx = createReadContext({
        id: match.id
      })
      ctx.paymentPointer = paymentPointer
      await deps.incomingPaymentRoutes.get(ctx)
      return ctx.body as IncomingPaymentJSON
    }
    // Query payment pointer to lookup authServer
    // const { status, data } = await getResource(deps, {
    //   url: match.paymentPointerUrl
    // })
    // if (
    //   !deps.validatePaymentPointer({
    //     status,
    //     body: data
    //   })
    // ) {
    //   throw new Error('unreachable')
    // }
    // get/create access token to read-all incoming payments at data.authServer
    // assert data.authServer !== config.authServerGrantUrl
    // }
    const { status, data } = await getResource(deps, {
      url,
      accessToken
    })
    if (
      !deps.validateIncomingPayment({
        status,
        body: data
      }) ||
      !isValidIncomingPayment(data)
    ) {
      throw new Error('unreachable')
    }
    return data
  } catch (_) {
    return undefined
  }
}

const CONNECTION_URL_REGEX = /\/connections\/(.){36}$/

async function getReceiver(
  deps: ServiceDependencies,
  url: string,
  accessToken?: string
): Promise<Receiver | undefined> {
  if (url.match(CONNECTION_URL_REGEX)) {
    const connection = await getConnection(deps, url)
    if (connection) {
      return Receiver.fromConnection(connection)
    }
  } else {
    const incomingPayment = await getIncomingPayment(deps, url, accessToken)
    if (incomingPayment) {
      return Receiver.fromIncomingPayment(incomingPayment)
    }
  }
}

// Validate referential integrity, which cannot be represented in OpenAPI
function isValidIncomingPayment(
  payment: IncomingPaymentJSON
): payment is IncomingPaymentJSON {
  if (payment.incomingAmount) {
    const incomingAmount = parseAmount(payment.incomingAmount)
    const receivedAmount = parseAmount(payment.receivedAmount)
    if (
      incomingAmount.assetCode !== receivedAmount.assetCode ||
      incomingAmount.assetScale !== receivedAmount.assetScale
    ) {
      return false
    }
    if (incomingAmount.value < receivedAmount.value) {
      return false
    }
    if (incomingAmount.value === receivedAmount.value && !payment.completed) {
      return false
    }
  }
  if (typeof payment.ilpStreamConnection === 'object') {
    if (
      payment.ilpStreamConnection.assetCode !==
        payment.receivedAmount.assetCode ||
      payment.ilpStreamConnection.assetScale !==
        payment.receivedAmount.assetScale
    ) {
      return false
    }
  }
  return true
}
