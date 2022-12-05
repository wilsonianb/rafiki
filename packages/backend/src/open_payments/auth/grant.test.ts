import { Grant, AccessType, AccessAction } from './grant'
import { faker } from '@faker-js/faker'

describe('Grant', (): void => {
  describe('findAccess', (): void => {
    let grant: Grant
    const type = AccessType.IncomingPayment
    const action = AccessAction.Create
    const client = faker.internet.url()

    describe.each`
      identifier                        | description
      ${'https://wallet.example/alice'} | ${'account identifier'}
      ${undefined}                      | ${'no identifier'}
    `('$description', ({ identifier }): void => {
      beforeAll((): void => {
        grant = new Grant({
          grant: 'PRY5NM33OM4TB8N6BW7',
          client,
          access: [
            {
              type: AccessType.OutgoingPayment,
              actions: [AccessAction.Read],
              identifier: 'https://wallet.example/bob'
            },
            {
              type,
              actions: [AccessAction.Read, action],
              identifier
            }
          ]
        })
      })

      test('Returns true for included access', async (): Promise<void> => {
        expect(
          grant.findAccess({
            type,
            action,
            identifier
          })
        ).toEqual(grant.access[1])
      })
      test.each`
        superAction             | subAction            | description
        ${AccessAction.ReadAll} | ${AccessAction.Read} | ${'read'}
        ${AccessAction.ListAll} | ${AccessAction.List} | ${'list'}
      `(
        'Returns true for $description super access',
        async ({ superAction, subAction }): Promise<void> => {
          const grant = new Grant({
            grant: 'PRY5NM33OM4TB8N6BW7',
            client,
            access: [
              {
                type,
                actions: [superAction],
                identifier
              }
            ]
          })
          expect(
            grant.findAccess({
              type,
              action: subAction,
              identifier
            })
          ).toEqual(grant.access[0])
        }
      )

      test.each`
        type                          | action                   | identifier    | description
        ${AccessType.OutgoingPayment} | ${action}                | ${identifier} | ${'type'}
        ${type}                       | ${AccessAction.Complete} | ${identifier} | ${'action'}
      `(
        'Returns false for missing $description',
        async ({ type, action, identifier }): Promise<void> => {
          expect(
            grant.findAccess({
              type,
              action,
              identifier
            })
          ).toBeUndefined()
        }
      )

      if (identifier) {
        test('Returns false for missing identifier', async (): Promise<void> => {
          expect(
            grant.findAccess({
              type,
              action,
              identifier: 'https://wallet.example/bob'
            })
          ).toBeUndefined()
        })
      } else {
        test('Returns true for unrestricted identifier', async (): Promise<void> => {
          expect(
            grant.findAccess({
              type,
              action,
              identifier: 'https://wallet.example/bob'
            })
          ).toEqual(grant.access[1])
        })
      }
    })
  })
})
