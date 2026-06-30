/**
 * 画布前端本地类型（v0.2.0）
 *
 * 设计原则：
 * - 与 packages/canvas-shared 已有的 PortType / CanvasNodeDefinition 对齐
 * - 形态严格按 PRD §16.2 + TRD §6 的 API envelope 定义
 * - 后端 modules/canvas 落地后，这里逐步迁到 packages/contracts，由 OpenAPI 生成
 */

import type { PortType, RelationType, EdgeKind } from '@xiaochuang/canvas-shared'

// ─── 节点 / 连线 ──────────────────────────────────────────────────────────────

export type NodeKind = 'content' | 'execute'

/** 内容节点的 7 个具体类型 */
export type ContentNodeType = 'storyboard' | 'image' | 'video-asset' | 'character' | 'scene' | 'audio' | 'note'

/** 执行节点的 5 个具体类型（v0.2.0 范围） */
export type ExecuteNodeType =
  | 'text-to-image'
  | 'image-to-video'
  | 'text-to-speech'
  | 'concat'
  | 'export'

export type CanvasNodeType = ContentNodeType | ExecuteNodeType

export interface CanvasNode {
  id: string
  type: CanvasNodeType
  /** React Flow 坐标 */
  position: { x: number; y: number }
  /** 节点宽度（None=auto） */
  width?: number
  /** 节点专属业务数据（按 type 不同结构不同；最宽松形态用 unknown 索引） */
  data: Record<string, unknown>
  /** v0.2.0：隐藏节点（业务动作"构想画面"等用，结果回填后销毁） */
  hidden?: boolean
}

// ─── 节点数据 narrow types（v0.2.0 PR1.6） ──────────────────────────────────
// 提供给前端组件做 type assertion 的"建议形态"。CanvasNode.data 仍保持
// Record<string, unknown> 宽容（与 OpenAPI 一致），PR2 节点系统会分裂为
// 真正的 discriminated union。

/** PRD §8.2 分镜卡数据 */
export interface StoryboardData {
  shotIndex?: number
  title?: string
  shotDescription?: string
  prompt?: string
  shotType?: string
  cameraMove?: string
  duration?: number
  images?: string[]
  /** 'confirmed' 显示右下角折角 */
  markStatus?: 'confirmed' | 'none'
  /** 顶部 4px 色带颜色（CSS color） */
  moodColor?: string
  /** 配音 URL；存在时显示 🔊（PR3 业务动作"配音"回填） */
  audioUrl?: string
  /** 镜头视频 URL（PR3 业务动作"生成镜头视频"回填） */
  videoUrl?: string
  /** 字幕文本（合成时叠加） */
  subtitle?: string
  /** 右侧伸出的小标签，最多 3 个 */
  attachments?: { text: string; color?: string }[]
  /** 关联到的主角色 / 场景（PR3 业务动作"关联到分镜"/"设为分镜背景" 写入 sourceNodeId） */
  mainCharacterRef?: string
  sceneBackgroundRef?: string
  /**
   * 生成历史（PRD §12.6，每节点最多 20 条）
   * PR3 ExpandedEditor 历史区显示这里的缩略图，点击切回 images[0]
   */
  historyImages?: Array<{
    url: string
    prompt?: string
    style?: string
    timestamp: string
  }>
  /** 来源短剧信息 */
  dramaId?: string
  episodeId?: string
}

/** 便签数据 */
export interface NoteData {
  text?: string
  /** 4 色之一（黄/蓝/粉/绿）或自定义 hex */
  color?: string
}

/** 角色卡数据（v0.2.0 简化） */
export interface CharacterData {
  name?: string
  label?: string
  description?: string
  /** 头像 / 形象图 */
  images?: string[]
  /** 来源资产库角色 ID */
  characterId?: string
}

/** 场景卡数据（v0.2.0 简化） */
export interface SceneData {
  name?: string
  label?: string
  description?: string
  /** 场景图 */
  images?: string[]
  /** 来源资产库场景 ID */
  sceneId?: string
}

/** 通用图片节点数据 */
export interface ImageData {
  label?: string
  images?: string[]
  /** 用户语义类别（场景/角色/道具） */
  category?: 'scene' | 'character' | 'prop'
  prompt?: string
  text?: string
  /** 来源资产库资产 ID */
  assetId?: string
}

export interface VideoAssetData {
  title?: string
  label?: string
  videoUrl?: string
  thumbnailUrl?: string
  provider?: string
  assetId?: string
}

export interface AudioAssetData {
  title?: string
  label?: string
  url?: string
  provider?: string
  assetId?: string
}

export interface CanvasNodeResult {
  id: string
  kind: 'image' | 'video' | 'audio' | 'text' | 'file'
  url: string
  thumbnail_url?: string | null
  mime_type?: string | null
  title?: string | null
  prompt?: string | null
  provider?: string | null
  model?: string | null
  action_label?: string | null
  run_id?: string | null
  task_id?: string | null
  asset_id?: number | null
  source_type?: string | null
  created_at: string
  metadata?: Record<string, unknown>
}

/**
 * 连线种类（与 packages/canvas-shared 一致）：
 *   narrative — 叙事/转场，含 8 种 RelationType（PRD §8.3）
 *   dataflow  — 数据流，执行节点之间，按端口 PortType 校验
 */
export type { EdgeKind, RelationType } from '@xiaochuang/canvas-shared'

export interface CanvasEdge {
  id: string
  source: string
  target: string
  edge_kind: EdgeKind
  /** 仅 dataflow 边带端口字段 */
  source_port?: string
  target_port?: string
  /** 仅 narrative 边用；PRD §8.3 8 种 */
  relation_type?: RelationType
}

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

// ─── 画布 ─────────────────────────────────────────────────────────────────────

export type CanvasSource = 'blank' | 'global-inspiration' | 'from-drama'

export interface CanvasSummary {
  id: string
  title: string
  thumbnail?: string | null
  source: CanvasSource
  source_drama_id?: string | null
  /** 来源短剧的标题（PR4 列表卡片 SourceBadge 显示） */
  source_drama_title?: string | null
  source_drama_snapshot_at?: string | null
  /** 全局灵感板始终置顶 */
  is_pinned: boolean
  created_at: string
  updated_at: string
  /** 来自 latest run 的状态摘要（轮询数据） */
  run_status?: {
    state: 'idle' | 'running' | 'completed' | 'failed'
    progress?: { current: number; total: number }
  }
}

export interface CanvasDetail extends CanvasSummary {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: CanvasViewport
  current_version_id: string
}

// ─── 节点运行状态（v0.2.0：6 状态机） ─────────────────────────────────────────

export type NodeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'

export interface NodeRuntimeState {
  status: NodeStatus
  /** 0~100，仅 running 时有意义 */
  progress?: number
  errorMessage?: string
  errorCode?: string
  retryCount?: number
  outputAssetId?: string
  /** v0.2.0 内部用：当前正在跑的执行 ID（用于幂等性） */
  currentExecutionId?: string
}

// ─── API 请求/响应 ────────────────────────────────────────────────────────────

/** 列表页返回 */
export interface CanvasListResponse {
  data: CanvasSummary[]
  total: number
}

/** 创建/复制画布的请求体 */
export interface CanvasCreateRequest {
  title?: string
  source?: CanvasSource
}

/** 整画布保存（3s 防抖触发） */
export interface CanvasSaveRequest {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: CanvasViewport
}

/** 节点运行状态拉取（5s 轮询） */
export interface CanvasRunStatusResponse {
  canvas_id: string
  version_id: string
  run_id: string | null
  /** 整体进度 */
  progress: { current: number; total: number; eta_seconds?: number }
  /** 各节点状态（按 nodeId 索引） */
  node_states: Record<string, NodeRuntimeState>
}

export interface CanvasUploadResponse {
  node: CanvasNode
  result: CanvasNodeResult
  asset?: unknown
}

export interface CanvasNodeResultsResponse {
  current_result_id: string | null
  results: CanvasNodeResult[]
}

export interface CanvasChatPlan {
  title: string
  summary?: string
  operations: Array<
    | { type: 'create_node'; node_type: string; label: string; data?: Record<string, unknown>; position?: { x: number; y: number } }
    | { type: 'update_node'; node_id: string; patch: Record<string, unknown> }
    | { type: 'add_to_context'; node_id: string }
  >
}

export type CanvasChatEvent =
  | { type: 'message'; content: string }
  | { type: 'skill_result'; skill: string; content: string; outputs?: unknown[] }
  | { type: 'plan'; plan: CanvasChatPlan }

/** 通用 envelope */
export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

// ─── PortType 重新导出（前端组件方便引用） ────────────────────────────────────

export type { PortType }
