// 公共入口 —— 重新 export 所有子模块的常用 API
//
// 推荐按需 import 子模块以获得更小的打包尺寸：
//   import { nodeRegistry } from '@xiaochuang/canvas-shared/nodes'
//   import { isCompatible } from '@xiaochuang/canvas-shared/schema'
//   import type { GenerateContext } from '@xiaochuang/canvas-shared/types'

export * from './schema/index.js'
export * from './nodes/index.js'
export * from './types/index.js'
export * from './utils/index.js'
