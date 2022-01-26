import Axios, { AxiosInstance } from 'axios'
import { ILPContext, ILPMiddleware } from '../rafiki'
import { modifySerializedIlpPrepare } from '../lib'
//import { AxiosClient } from '../services/client/axios'
import { sendToPeer as sendToPeerDefault } from '../services/client'
import { Peer } from '../../../peer/model'

export interface ClientControllerOptions {
  sendToPeer?: (
    client: AxiosInstance,
    peer: Peer,
    prepare: Buffer
  ) => Promise<Buffer>
}

export function createClientController({
  sendToPeer
}: ClientControllerOptions = {}): ILPMiddleware {
  const send = sendToPeer || sendToPeerDefault
  // TODO keepalive
  const axios = Axios.create({ timeout: 30_000 })

  return async function ilpClient(
    { accounts: { outgoing }, request, response }: ILPContext,
    _: () => Promise<void>
  ): Promise<void> {
    const incomingPrepare = request.rawPrepare
    const amount = request.prepare.amountChanged
      ? request.prepare.intAmount
      : undefined
    const expiresAt = request.prepare.expiresAtChanged
      ? request.prepare.expiresAt
      : undefined
    const outgoingPrepare = modifySerializedIlpPrepare(
      incomingPrepare,
      amount,
      expiresAt
    )

    response.rawReply = await send(axios, outgoing as Peer, outgoingPrepare)
  }
}
