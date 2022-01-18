export enum CreateError {
  InvalidInterval = 'InvalidInterval',
  InvalidStartAt = 'InvalidStartAt'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isCreateError = (o: any): o is CreateError =>
  Object.values(CreateError).includes(o)
