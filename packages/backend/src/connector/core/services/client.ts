import { AxiosInstance } from 'axios'
import { Errors } from 'ilp-packet'
import { Peer } from '../../../peer/model'

export async function sendToPeer(
  client: AxiosInstance,
  peer: Peer,
  prepare: Buffer
): Promise<Buffer> {
  const { http } = peer
  if (!http) {
    throw new Errors.UnreachableError('no outgoing endpoint')
  }
  const res = await client.post<Buffer>(http.outgoing.endpoint, prepare, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${http.outgoing.authToken}` }
  })
  return res.data
}
