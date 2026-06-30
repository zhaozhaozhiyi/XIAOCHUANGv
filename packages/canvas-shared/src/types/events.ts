/**
 * SSE 事件 schema（v0.2.1 SSE 落地用；v0.2.0 仅 5s 轮询）
 *
 * 详见 TRD §7.3 事件 schema。
 */

export type NodeStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'skipped'

export type VersionRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'partially-failed'
  | 'failed'
  | 'cancelled'

export type CanvasEventType =
  | 'node.state.changed'
  | 'version.run.progress'
  | 'version.run.completed'
  | 'heartbeat'

/** 节点状态变化 */
export interface NodeStateChangedEvent {
  event: 'node.state.changed'
  id: string // seq id，用于断线重连 Last-Event-ID
  data: {
    canvasId: string
    versionId: string
    nodeId: string
    status: NodeStatus
    errorMessage?: string
    errorCode?: string
    /** status=completed 时填，单输出场景 */
    outputAssetId?: string
    /** 多输出场景（如 text-to-image 4 候选）*/
    outputs?: Array<{ assetId: string; metadata?: Record<string, unknown> }>
    outputType?: 'image' | 'video' | 'audio' | 'mp4' | 'text'
    timestamp: string
  }
}

/** 节点进度（限频后推）*/
export interface VersionRunProgressEvent {
  event: 'version.run.progress'
  id: string
  data: {
    canvasId: string
    versionId: string
    nodeId: string
    progress: number // 0~1
    etaSeconds?: number
    timestamp: string
  }
}

/** 版本整体完成 */
export interface VersionRunCompletedEvent {
  event: 'version.run.completed'
  id: string
  data: {
    canvasId: string
    versionId: string
    overallStatus: VersionRunStatus
    completedAt: string
    finalAssetId?: string
    stats: {
      total: number
      completed: number
      failed: number
      skipped: number
    }
  }
}

/** 心跳（防代理 timeout）*/
export interface HeartbeatEvent {
  event: 'heartbeat'
  data: { ts: number }
}

export type CanvasEvent =
  | NodeStateChangedEvent
  | VersionRunProgressEvent
  | VersionRunCompletedEvent
  | HeartbeatEvent
