/**
 * 通用画布类型 —— 前后端共享的核心 domain 类型
 *
 * 注意：API 请求/响应类型不放这里，那些走 packages/contracts（OpenAPI 生成）。
 * 这里只放"业务领域类型"——节点 / 连线 / 版本的 schema 化定义。
 */

export type EdgeKind = 'narrative' | 'dataflow'

export type RelationType =
  | 'solid'
  | 'dashed'
  | 'arrow'
  | 'cut'
  | 'dissolve'
  | 'wipe'
  | 'jump-cut'
  | 'fade'

export type Thickness = 'thin' | 'medium' | 'thick'

export type CanvasVersionType = 'run' | 'manual' | 'auto-draft'

/** v0.2.0 + v0.2.1 + v0.3 都通用的最小节点数据形态 */
export interface CanvasNodeBase {
  id: string
  canvasId: string
  versionId?: string // v0.2.0 单版本可能为 null，v0.2.1 强制
  nodeDefId: string // 与 nodeRegistry 的 key 对应
  label?: string
  data: Record<string, unknown>
  positionX: number
  positionY: number
  width?: number
  height?: number
  zIndex?: number
  /** 智能容器内嵌节点的父分镜 ID（v0.2.1 启用）*/
  parentStoryboardId?: string | null
  /** 容器内的隐藏节点（v0.2.1 启用）*/
  isHidden?: boolean
  createdAt: string
  updatedAt: string
}

export interface CanvasEdge {
  id: string
  canvasId: string
  sourceNodeId: string
  sourcePort?: string | null
  targetNodeId: string
  targetPort?: string | null
  edgeKind: EdgeKind
  relationType?: RelationType
  thickness?: Thickness
  label?: string
  createdAt: string
}
