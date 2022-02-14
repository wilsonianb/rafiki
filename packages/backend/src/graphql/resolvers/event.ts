import {
  QueryResolvers,
  ResolversTypes,
  EventEdge,
  EventResolvers,
  EventsConnectionResolvers,
  Invoice as InvoiceSchema
} from '../generated/graphql'
import { Invoice, InvoiceEventType } from '../../open_payments/invoice/model'
import { InvoiceService } from '../../open_payments/invoice/service'
import { ApolloContext } from '../../app'

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
const isInvoiceEvent = (o: any): o is InvoiceSchema =>
  Object.values(InvoiceEventType).includes(o.event)

export const eventResolveType: EventResolvers<ApolloContext>['__resolveType'] = (
  parent,
  _args,
  _ctx
) => {
  if (isInvoiceEvent(parent)) {
    return 'Invoice'
  }
  throw new Error('invalid event')
}

export const getEvents: QueryResolvers<ApolloContext>['events'] = async (
  parent,
  args,
  ctx
): ResolversTypes['EventsConnection'] => {
  const invoiceService = await ctx.container.use('invoiceService')
  const invoices = await invoiceService.getInvoiceEventsPage(args)
  return {
    edges: invoices.map((invoice: Invoice) => ({
      cursor: invoice.id,
      node: {
        ...invoice,
        expiresAt: invoice.expiresAt.toISOString(),
        createdAt: invoice.createdAt.toISOString()
      }
    }))
  }
}

export const getEventsConnectionPageInfo: EventsConnectionResolvers<ApolloContext>['pageInfo'] = async (
  parent,
  args,
  ctx
): ResolversTypes['PageInfo'] => {
  const edges = parent.edges
  if (edges == null || typeof edges == 'undefined' || edges.length == 0)
    return {
      hasPreviousPage: false,
      hasNextPage: false
    }
  const pageInfo = await getPageInfo({
    invoiceService: await ctx.container.use('invoiceService'),
    edges
  })
  // if (!pageInfo.hasNextPage) {}
  return pageInfo
}

const getPageInfo = async ({
  invoiceService,
  edges
}: {
  invoiceService: InvoiceService
  edges: EventEdge[]
}): ResolversTypes['PageInfo'] => {
  const firstEdge = edges[0].cursor
  const lastEdge = edges[edges.length - 1].cursor

  let hasNextPageEvents, hasPreviousPageEvents
  try {
    hasNextPageEvents = await invoiceService.getInvoiceEventsPage({
      after: lastEdge,
      first: 1
    })
  } catch (e) {
    hasNextPageEvents = []
  }
  try {
    hasPreviousPageEvents = await invoiceService.getInvoiceEventsPage({
      before: firstEdge,
      last: 1
    })
  } catch (e) {
    hasPreviousPageEvents = []
  }

  return {
    endCursor: lastEdge,
    hasNextPage: hasNextPageEvents.length == 1,
    hasPreviousPage: hasPreviousPageEvents.length == 1,
    startCursor: firstEdge
  }
}
