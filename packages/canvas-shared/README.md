# @xiaochuang/canvas-shared

画布模块的前后端共享类型与节点定义。

## 内容

- `schema/` — `CanvasNodeDefinition` zod schema、`PortType` 兼容矩阵、`BusinessAction` 类型
- `nodes/` — 17 节点定义实例（v0.2.0 仅 5 个执行节点 + 5 个内容节点）
- `types/` — `GenerateContext`、SSE 事件 schema、通用画布类型
- `utils/` — `resolveBusinessActions`、`renderPromptTemplate`、`isCompatible`

## 使用方式

```typescript
// 前端 apps/web 或 后端 apps/backend
import { nodeRegistry, getNodeDefinition } from '@xiaochuang/canvas-shared/nodes'
import { CanvasNodeDefinitionSchema, isCompatible } from '@xiaochuang/canvas-shared/schema'
import type { CanvasNodeDefinition, PortType, GenerateContext } from '@xiaochuang/canvas-shared'

// 获取所有 v0.2.0 节点
const allNodes = Object.values(nodeRegistry)

// 校验节点端口类型兼容性（用于 React Flow isValidConnection）
const canConnect = isCompatible('image', 'image') // true
```

## 与其他包的关系

| | `@xiaochuang/canvas-shared` | `@xiaochuang/contracts` |
|---|---|---|
| 来源 | 手写（节点定义、PortType）| 自动生成（NestJS OpenAPI）|
| 内容 | 业务领域类型 + 节点 registry | API 请求/响应类型 |
| 谁导入 | 前端 + 后端 | 前端 + 后端 |

## 文档

- [画布模块 PRD](../../newdocs/modules/画布模块PRD.md)
- [当前 TRD](../../newdocs/TRD.md)
