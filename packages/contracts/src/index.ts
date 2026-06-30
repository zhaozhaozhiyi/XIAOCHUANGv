import type { components, operations, paths } from './generated.js'

export * from './shared.js'
export type { components, operations, paths } from './generated.js'

export type ApiComponents = components
export type ApiOperations = operations
export type ApiPaths = paths
export type ApiSchemaMap = ApiComponents extends { schemas: infer Schemas } ? Schemas : never
export type ApiSchema<Name extends keyof ApiSchemaMap> = ApiSchemaMap[Name]
export type ApiOperation<Name extends keyof ApiOperations> = ApiOperations[Name]
export type ApiPath<Name extends keyof ApiPaths> = ApiPaths[Name]
