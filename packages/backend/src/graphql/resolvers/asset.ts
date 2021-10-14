import {
  AssetEdge,
  AssetsConnectionResolvers,
  MutationResolvers,
  QueryResolvers,
  ResolversTypes
} from '../generated/graphql'
import { AssetError, isAssetError } from '../../asset/errors'
import { Asset } from '../../asset/model'
import { AssetService } from '../../asset/service'

export const getAssets: QueryResolvers['assets'] = async (
  parent,
  args,
  ctx
): ResolversTypes['AssetsConnection'] => {
  const assetService = await ctx.container.use('assetService')
  const assets = await assetService.getPage(args)
  return {
    edges: assets.map((asset: Asset) => ({
      cursor: asset.id,
      node: asset
    }))
  }
}

export const getAsset: QueryResolvers['asset'] = async (
  parent,
  args,
  ctx
): ResolversTypes['Asset'] => {
  const assetService = await ctx.container.use('assetService')
  const asset = await assetService.getById(args.id)
  if (!asset) {
    throw new Error('No asset')
  }
  return asset
}

export const createAsset: MutationResolvers['createAsset'] = async (
  parent,
  args,
  ctx
): ResolversTypes['CreateAssetMutationResponse'] => {
  try {
    const assetService = await ctx.container.use('assetService')
    const assetOrError = await assetService.create({
      ...args.input
    })
    if (isAssetError(assetOrError)) {
      switch (assetOrError) {
        case AssetError.AssetExists:
          return {
            code: '409',
            message: 'Asset exists',
            success: false
          }
        default:
          throw new Error(`AssetError: ${assetOrError}`)
      }
    }
    return {
      code: '200',
      success: true,
      message: 'Created Asset',
      asset: assetOrError
    }
  } catch (error) {
    ctx.logger.error(
      {
        deposit: args.input,
        error
      },
      'error creating asset'
    )
    return {
      code: '400',
      message: 'Error trying to create asset',
      success: false
    }
  }
}

export const getAssetsConnectionPageInfo: AssetsConnectionResolvers['pageInfo'] = async (
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
  return getPageInfo({
    assetService: await ctx.container.use('assetService'),
    edges
  })
}

const getPageInfo = async ({
  assetService,
  edges
}: {
  assetService: AssetService
  edges: AssetEdge[]
}): ResolversTypes['PageInfo'] => {
  const firstEdge = edges[0].cursor
  const lastEdge = edges[edges.length - 1].cursor

  let hasNextPageAssets, hasPreviousPageAssets
  try {
    hasNextPageAssets = await assetService.getPage({
      after: lastEdge,
      first: 1
    })
  } catch (e) {
    hasNextPageAssets = []
  }
  try {
    hasPreviousPageAssets = await assetService.getPage({
      before: firstEdge,
      last: 1
    })
  } catch (e) {
    hasPreviousPageAssets = []
  }

  return {
    endCursor: lastEdge,
    hasNextPage: hasNextPageAssets.length == 1,
    hasPreviousPage: hasPreviousPageAssets.length == 1,
    startCursor: firstEdge
  }
}
