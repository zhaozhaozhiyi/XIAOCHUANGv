/**
 * 画布 CRUD API（v0.2.0 PR1）
 *
 * 端点参考 PRD §16.2 + apps/web/mocks/handlers/canvas.ts
 */

import type {
  CanvasCreateRequest,
  CanvasChatEvent,
  CanvasChatPlan,
  CanvasDetail,
  CanvasNode,
  CanvasNodeResultsResponse,
  CanvasRunStatusResponse,
  CanvasSaveRequest,
  CanvasSummary,
  CanvasUploadResponse,
} from '@/lib/canvas/types'
import { canvasClient } from './client'

async function parseEnvelope<T>(resp: Response): Promise<T> {
  const parsed = await resp.json()
  if (parsed?.code !== 0) throw new Error(parsed?.message || '请求失败')
  return parsed.data as T
}

async function parseSse(resp: Response): Promise<CanvasChatEvent[]> {
  const text = await resp.text()
  return text
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data: '))?.slice(6))
    .filter((line): line is string => Boolean(line && line !== '{}'))
    .map((line) => JSON.parse(line) as CanvasChatEvent)
}

export const canvasApi = {
  list(): Promise<{ data: CanvasSummary[]; total: number }> {
    return canvasClient.get('/canvases')
  },

  init(): Promise<CanvasSummary> {
    return canvasClient.post('/canvases/init')
  },

  create(body: CanvasCreateRequest = {}): Promise<CanvasSummary> {
    return canvasClient.post('/canvases', body)
  },

  get(id: string, options?: { signal?: AbortSignal }): Promise<CanvasDetail> {
    return canvasClient.get(`/canvases/${id}`, options)
  },

  updateMeta(id: string, patch: Partial<Pick<CanvasDetail, 'title' | 'thumbnail' | 'viewport'>>): Promise<CanvasSummary> {
    return canvasClient.patch(`/canvases/${id}`, patch)
  },

  /** 整画布保存（节点 + 边 + 视口） */
  save(id: string, body: CanvasSaveRequest): Promise<{ saved_at: string; version_id: string }> {
    return canvasClient.post(`/canvases/${id}/save`, body)
  },

  duplicate(id: string): Promise<CanvasSummary> {
    return canvasClient.post(`/canvases/${id}/duplicate`)
  },

  delete(id: string): Promise<{ deleted_at: string }> {
    return canvasClient.delete(`/canvases/${id}`)
  },

  /** v0.2.0 PR2：触发一次运行（mock 端用 setTimeout 推 6 状态变化） */
  run(id: string): Promise<{ run_id: string; version_id: string; total: number }> {
    return canvasClient.post(`/canvases/${id}/run`)
  },

  /** v0.2.0 PR2：当前节点 runtime 全量（5s 轮询入口，PR4 接 useRunStatus） */
  runStatus(id: string, options?: { signal?: AbortSignal }): Promise<CanvasRunStatusResponse> {
    return canvasClient.get(`/canvases/${id}/run-status`, options)
  },

  /**
   * v0.2.0 PR3：触发业务动作（构想画面 / 改画面 / 换装 / 配音 等）
   *
   * 后端创建 keepNodeHidden=true 的 execute 节点 + 自动 dataflow 连线，
   * 启动 mock run；completed 时把生成结果回填到 sourceNode.data 对应字段：
   *   - text-to-image  → sourceNode.data.images
   *   - text-to-speech → sourceNode.data.audioUrl
   *   - image-to-video → sourceNode.data.videoUrl
   */
  triggerBusinessAction(
    id: string,
    body: {
      actionLabel: string
      sourceNodeId?: string
      sourceNodeDefId?: string
      userInput: string
      style?: string
      output_mode?: 'current_node' | 'insert_new_node'
      position_x?: number
      position_y?: number
      target_node_type?: CanvasNode['type']
    },
  ): Promise<{ hidden_node_id: string; run_id: string; task_id?: string; node?: CanvasNode | null }> {
    return canvasClient.post(`/canvases/${id}/business-action`, body)
  },

  async upload(id: string, formData: FormData): Promise<CanvasUploadResponse> {
    const resp = await canvasClient.raw(`/canvases/${id}/uploads`, {
      method: 'POST',
      body: formData,
    })
    return parseEnvelope<CanvasUploadResponse>(resp)
  },

  saveNodeResultToAsset(
    id: string,
    body: { node_id: string; result_id?: string; title?: string },
  ): Promise<unknown> {
    return canvasClient.post(`/canvases/${id}/assets`, body)
  },

  listNodeResults(id: string, nodeId: string): Promise<CanvasNodeResultsResponse> {
    return canvasClient.get(`/canvases/${id}/nodes/${nodeId}/results`)
  },

  selectNodeResult(id: string, nodeId: string, resultId: string): Promise<{ result: unknown; node: CanvasNode }> {
    return canvasClient.post(`/canvases/${id}/nodes/${nodeId}/results/${resultId}/select`)
  },

  async chat(id: string, body: { message: string; selected_node_ids?: string[] }): Promise<CanvasChatEvent[]> {
    const resp = await canvasClient.raw(`/canvases/${id}/chat`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return parseSse(resp)
  },

  applyChatPlan(id: string, plan: CanvasChatPlan): Promise<unknown[]> {
    return canvasClient.post(`/canvases/${id}/chat/plan/apply`, { operations: plan.operations })
  },
}
