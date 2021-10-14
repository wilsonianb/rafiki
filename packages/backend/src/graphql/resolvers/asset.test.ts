import { gql } from 'apollo-server-koa'
import Knex from 'knex'
import { v4 as uuid } from 'uuid'
import { ApolloError } from '@apollo/client'

import { createTestApp, TestContainer } from '../../tests/app'
import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../../app'
import { initIocContainer } from '../..'
import { Config } from '../../config/app'
import { isAssetError } from '../../asset/errors'
import { Asset } from '../../asset/model'
import { AssetService } from '../../asset/service'
import { randomAsset } from '../../tests/asset'
import { truncateTables } from '../../tests/tableManager'
import {
  AssetsConnection,
  CreateAssetMutationResponse
} from '../generated/graphql'

describe('Asset Resolvers', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let assetService: AssetService
  let knex: Knex

  beforeAll(
    async (): Promise<void> => {
      deps = await initIocContainer(Config)
      appContainer = await createTestApp(deps)
      knex = await deps.use('knex')
      assetService = await deps.use('assetService')
    }
  )

  afterEach(
    async (): Promise<void> => {
      await truncateTables(knex)
    }
  )

  afterAll(
    async (): Promise<void> => {
      await appContainer.apolloClient.stop()
      await appContainer.shutdown()
    }
  )

  describe('Create Asset', (): void => {
    test('Can create an asset', async (): Promise<void> => {
      const asset = randomAsset()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAsset($input: AssetInput!) {
              createAsset(input: $input) {
                code
                success
                message
                asset {
                  code
                  scale
                }
              }
            }
          `,
          variables: {
            input: asset
          }
        })
        .then(
          (query): CreateAssetMutationResponse => {
            if (query.data) {
              return query.data.createAsset
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.asset).toMatchObject(asset)
    })

    test('Returns an error for existing asset', async (): Promise<void> => {
      const asset = randomAsset()
      expect(isAssetError(await assetService.create(asset))).toEqual(false)
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAsset($input: AssetInput!) {
              createAsset(input: $input) {
                code
                success
                message
                asset {
                  code
                  scale
                }
              }
            }
          `,
          variables: {
            input: asset
          }
        })
        .then(
          (query): CreateAssetMutationResponse => {
            if (query.data) {
              return query.data.createAsset
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Asset exists')
      expect(response.asset).toBeNull()
    })
  })

  describe('Asset Queries', (): void => {
    test('Can get an asset', async (): Promise<void> => {
      const asset = await assetService.create(randomAsset())
      if (isAssetError(asset)) {
        fail()
      }
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Asset($assetId: String!) {
              asset(id: $assetId) {
                id
                code
                scale
              }
            }
          `,
          variables: {
            assetId: asset.id
          }
        })
        .then(
          (query): Asset => {
            if (query.data) {
              return query.data.asset
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(query).toEqual({
        __typename: 'Asset',
        id: asset.id,
        code: asset.code,
        scale: asset.scale
      })
    })

    test('Returns error for unknown asset', async (): Promise<void> => {
      const query = appContainer.apolloClient
        .query({
          query: gql`
            query Asset($assetId: String!) {
              asset(id: $assetId) {
                id
                code
                scale
              }
            }
          `,
          variables: {
            assetId: uuid()
          }
        })
        .then(
          (query): Asset => {
            if (query.data) {
              return query.data.asset
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      await expect(query).rejects.toThrow(ApolloError)
    })
  })

  describe('Assets Queries', (): void => {
    test('Can get assets', async (): Promise<void> => {
      const assets: Asset[] = []
      for (let i = 0; i < 2; i++) {
        const asset = await assetService.create(randomAsset())
        if (isAssetError(asset)) {
          fail()
        }
        assets.push(asset)
      }
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Assets {
              assets {
                edges {
                  node {
                    id
                    code
                    scale
                  }
                  cursor
                }
              }
            }
          `
        })
        .then(
          (query): AssetsConnection => {
            if (query.data) {
              return query.data.assets
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(query.edges).toHaveLength(2)
      query.edges.forEach((edge, idx) => {
        const asset = assets[idx]
        expect(edge.cursor).toEqual(asset.id)
        expect(edge.node).toEqual({
          __typename: 'Asset',
          id: asset.id,
          code: asset.code,
          scale: asset.scale
        })
      })
    })

    test('pageInfo is correct on default query without params', async (): Promise<void> => {
      const assets: Asset[] = []
      for (let i = 0; i < 21; i++) {
        const asset = await assetService.create(randomAsset())
        if (isAssetError(asset)) {
          fail()
        }
        assets.push(asset)
      }
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Assets {
              assets {
                edges {
                  node {
                    id
                  }
                  cursor
                }
                pageInfo {
                  endCursor
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          `
        })
        .then(
          (query): AssetsConnection => {
            if (query.data) {
              return query.data.assets
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(query.edges).toHaveLength(20)
      expect(query.pageInfo.hasNextPage).toBeTruthy()
      expect(query.pageInfo.hasPreviousPage).toBeFalsy()
      expect(query.pageInfo.startCursor).toEqual(assets[0].id)
      expect(query.pageInfo.endCursor).toEqual(assets[19].id)
    }, 10_000)

    test('No assets, but assets requested', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Assets {
              assets {
                edges {
                  node {
                    id
                  }
                  cursor
                }
                pageInfo {
                  endCursor
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          `
        })
        .then(
          (query): AssetsConnection => {
            if (query.data) {
              return query.data.assets
            } else {
              throw new Error('Data was empty')
            }
          }
        )
      expect(query.edges).toHaveLength(0)
      expect(query.pageInfo.hasNextPage).toBeFalsy()
      expect(query.pageInfo.hasPreviousPage).toBeFalsy()
      expect(query.pageInfo.startCursor).toBeNull()
      expect(query.pageInfo.endCursor).toBeNull()
    })

    test('pageInfo is correct on pagination from start', async (): Promise<void> => {
      const assets: Asset[] = []
      for (let i = 0; i < 11; i++) {
        const asset = await assetService.create(randomAsset())
        if (isAssetError(asset)) {
          fail()
        }
        assets.push(asset)
      }
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Assets {
              assets(first: 10) {
                edges {
                  node {
                    id
                  }
                  cursor
                }
                pageInfo {
                  endCursor
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          `
        })
        .then(
          (query): AssetsConnection => {
            if (query.data) {
              return query.data.assets
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(query.edges).toHaveLength(10)
      expect(query.pageInfo.hasNextPage).toBeTruthy()
      expect(query.pageInfo.hasPreviousPage).toBeFalsy()
      expect(query.pageInfo.startCursor).toEqual(assets[0].id)
      expect(query.pageInfo.endCursor).toEqual(assets[9].id)
    }, 10_000)

    test('pageInfo is correct on pagination from middle', async (): Promise<void> => {
      const assets: Asset[] = []
      for (let i = 0; i < 31; i++) {
        const asset = await assetService.create(randomAsset())
        if (isAssetError(asset)) {
          fail()
        }
        assets.push(asset)
      }
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Assets($after: String!) {
              assets(after: $after) {
                edges {
                  node {
                    id
                  }
                  cursor
                }
                pageInfo {
                  endCursor
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          `,
          variables: {
            after: assets[9].id
          }
        })
        .then(
          (query): AssetsConnection => {
            if (query.data) {
              return query.data.assets
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(query.edges).toHaveLength(20)
      expect(query.pageInfo.hasNextPage).toBeTruthy()
      expect(query.pageInfo.hasPreviousPage).toBeTruthy()
      expect(query.pageInfo.startCursor).toEqual(assets[10].id)
      expect(query.pageInfo.endCursor).toEqual(assets[29].id)
    }, 10_000)

    test('pageInfo is correct on pagination near end', async (): Promise<void> => {
      const assets: Asset[] = []
      for (let i = 0; i < 30; i++) {
        const asset = await assetService.create(randomAsset())
        if (isAssetError(asset)) {
          fail()
        }
        assets.push(asset)
      }
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Assets($after: String!) {
              assets(after: $after, first: 10) {
                edges {
                  node {
                    id
                  }
                  cursor
                }
                pageInfo {
                  endCursor
                  hasNextPage
                  hasPreviousPage
                  startCursor
                }
              }
            }
          `,
          variables: {
            after: assets[24].id
          }
        })
        .then(
          (query): AssetsConnection => {
            if (query.data) {
              return query.data.assets
            } else {
              throw new Error('Data was empty')
            }
          }
        )

      expect(query.edges).toHaveLength(5)
      expect(query.pageInfo.hasNextPage).toBeFalsy()
      expect(query.pageInfo.hasPreviousPage).toBeTruthy()
      expect(query.pageInfo.startCursor).toEqual(assets[25].id)
      expect(query.pageInfo.endCursor).toEqual(assets[29].id)
    }, 10_000)
  })
})
