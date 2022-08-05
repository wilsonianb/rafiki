import { QueryResolvers, ResolversTypes, Event } from '../generated/graphql'
import { WebhookEvent } from '../../webhook/model'
import { ApolloContext } from '../../app'
import { getPageInfo } from '../../shared/pagination'
import { Pagination } from '../../shared/baseModel'

export const getEvents: QueryResolvers<ApolloContext>['events'] = async (
  parent,
  args,
  ctx
): Promise<ResolversTypes['EventsConnection']> => {
  const webhookService = await ctx.container.use('webhookService')
  const events = await webhookService.getPage(args)
  const pageInfo = await getPageInfo(
    (pagination: Pagination) => webhookService.getPage(pagination),
    events
  )
  return {
    pageInfo,
    edges: events.map((event: WebhookEvent) => ({
      cursor: event.id,
      node: assetToGraphql(event)
    }))
  }
}

export const assetToGraphql = (event: WebhookEvent): Event => ({
  id: event.id,
  type: event.type,
  // data: event.data,
  createdAt: new Date(+event.createdAt).toISOString()
})
