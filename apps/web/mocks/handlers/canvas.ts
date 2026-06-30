/**
 * 画布 CRUD 的 MSW handlers（v0.2.0 PR1）
 *
 * 端点约定：
 *   GET    /api/v1/canvases                          列表
 *   POST   /api/v1/canvases/init                     首进入自动创建全局灵感板（幂等）
 *   POST   /api/v1/canvases                          新建
 *   GET    /api/v1/canvases/:id                      详情
 *   PATCH  /api/v1/canvases/:id                      更新标题 / viewport
 *   POST   /api/v1/canvases/:id/save                 整图保存（3s 防抖）
 *   POST   /api/v1/canvases/:id/duplicate            复制
 *   DELETE /api/v1/canvases/:id                      软删除
 *
 *   节点 / 连线 CRUD 在编辑器内大多通过整图 /save 端点写回；
 *   细粒度 POST/PATCH/DELETE /nodes/:nid + /edges 端点 PR1 暂不实现，等真实后端落地。
 *
 * 所有响应统一 envelope：{ code, message, data }，与项目 ApiEnvelope 一致。
 */

import { HttpResponse, http } from 'msw'
import type {
  CanvasCreateRequest,
  CanvasDetail,
  CanvasSaveRequest,
} from '@/lib/canvas/types'
import {
  createCanvas,
  cryptoRandomId,
  deleteCanvas,
  duplicateCanvas,
  getCanvas,
  listCanvases,
  saveCanvasGraph,
  updateCanvas,
} from '../data/store'
import { SEED_CANVASES, toSummary } from '../data/seed'
import { getRunStatus, startRun } from '../data/runController'
import { triggerBusinessAction } from '../data/businessActionMock'
import type { CanvasSummary } from '@/lib/canvas/types'

/** PR4：把当前 run 状态摘要合并进列表 summary，让卡片 RunStatusBadge 拿到数据 */
function withRunStatus(summary: CanvasSummary): CanvasSummary {
  const status = getRunStatus(summary.id)
  if (!status || !status.run_id) return summary
  const states = Object.values(status.node_states)
  const hasFailed = states.some((s) => s.status === 'failed')
  const hasRunning = states.some(
    (s) => s.status === 'running' || s.status === 'queued',
  )
  const allDone =
    status.progress.total > 0 && status.progress.current === status.progress.total
  const state: NonNullable<CanvasSummary['run_status']>['state'] = hasFailed
    ? 'failed'
    : hasRunning
      ? 'running'
      : allDone
        ? 'completed'
        : 'idle'
  return { ...summary, run_status: { state, progress: status.progress } }
}

const ok = <T>(data: T) => HttpResponse.json({ code: 0, message: 'ok', data })
const fail = (status: number, message: string) =>
  HttpResponse.json({ code: status, message, data: null }, { status })

export const canvasHandlers = [
  // GET /api/v1/canvases — 列表
  http.get('/api/v1/canvases', () => {
    const list = listCanvases().map(toSummary).map(withRunStatus)
    return ok({ data: list, total: list.length })
  }),

  // POST /api/v1/canvases/init — 幂等创建全局灵感板
  http.post('/api/v1/canvases/init', () => {
    const existing = listCanvases().find(c => c.source === 'global-inspiration')
    if (existing) return ok(toSummary(existing))
    const fresh = JSON.parse(JSON.stringify(SEED_CANVASES[0])) as CanvasDetail
    fresh.id = `cnv_${cryptoRandomId()}`
    fresh.created_at = new Date().toISOString()
    fresh.updated_at = fresh.created_at
    createCanvas(fresh)
    return ok(toSummary(fresh))
  }),

  // POST /api/v1/canvases — 新建
  http.post<never, CanvasCreateRequest>('/api/v1/canvases', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as CanvasCreateRequest
    const now = new Date().toISOString()
    const fresh: CanvasDetail = {
      id: `cnv_${cryptoRandomId()}`,
      title: body.title?.trim() || '未命名画布',
      thumbnail: null,
      source: body.source ?? 'blank',
      is_pinned: false,
      created_at: now,
      updated_at: now,
      current_version_id: `ver_${cryptoRandomId()}`,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    createCanvas(fresh)
    return ok(toSummary(fresh))
  }),

  // GET /api/v1/canvases/:id — 详情
  http.get<{ id: string }>('/api/v1/canvases/:id', ({ params }) => {
    const canvas = getCanvas(params.id)
    if (!canvas) return fail(404, '画布不存在')
    return ok(canvas)
  }),

  // PATCH /api/v1/canvases/:id — 更新元数据
  http.patch<{ id: string }, Partial<CanvasDetail>>(
    '/api/v1/canvases/:id',
    async ({ params, request }) => {
      const body = (await request.json().catch(() => ({}))) as Partial<CanvasDetail>
      // 仅允许更新部分字段（标题 / 缩略图 / viewport）
      const safePatch: Partial<CanvasDetail> = {}
      if (typeof body.title === 'string') safePatch.title = body.title
      if (typeof body.thumbnail === 'string') safePatch.thumbnail = body.thumbnail
      if (body.viewport) safePatch.viewport = body.viewport
      const next = updateCanvas(params.id, safePatch)
      if (!next) return fail(404, '画布不存在')
      return ok(toSummary(next))
    },
  ),

  // POST /api/v1/canvases/:id/save — 整图保存
  http.post<{ id: string }, CanvasSaveRequest>(
    '/api/v1/canvases/:id/save',
    async ({ params, request }) => {
      const body = (await request.json()) as CanvasSaveRequest
      if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
        return fail(400, 'nodes / edges 必须为数组')
      }
      const next = saveCanvasGraph(params.id, {
        nodes: body.nodes,
        edges: body.edges,
        viewport: body.viewport ?? { x: 0, y: 0, zoom: 1 },
      })
      if (!next) return fail(404, '画布不存在')
      return ok({ saved_at: new Date().toISOString(), version_id: next.current_version_id })
    },
  ),

  // POST /api/v1/canvases/:id/duplicate — 复制
  http.post<{ id: string }>('/api/v1/canvases/:id/duplicate', ({ params }) => {
    const copy = duplicateCanvas(params.id)
    if (!copy) return fail(404, '画布不存在')
    return ok(toSummary(copy))
  }),

  // DELETE /api/v1/canvases/:id — 软删除
  http.delete<{ id: string }>('/api/v1/canvases/:id', ({ params }) => {
    const success = deleteCanvas(params.id)
    if (!success) return fail(400, '全局灵感板不可删除，或画布不存在')
    return ok({ deleted_at: new Date().toISOString() })
  }),

  // POST /api/v1/canvases/:id/run — 启动一次运行（v0.2.0 PR2 最小骨架）
  http.post<{ id: string }>('/api/v1/canvases/:id/run', ({ params }) => {
    const info = startRun(params.id)
    if (!info) return fail(404, '画布不存在')
    return ok({
      run_id: info.runId,
      version_id: info.versionId,
      total: info.totalCount,
    })
  }),

  // GET /api/v1/canvases/:id/run-status — 当前节点 runtime 全量（5s 轮询用）
  http.get<{ id: string }>('/api/v1/canvases/:id/run-status', ({ params }) => {
    const status = getRunStatus(params.id)
    if (!status) return fail(404, '画布不存在')
    return ok(status)
  }),

  // POST /api/v1/canvases/:id/business-action — PR3 业务动作（构想画面/换装/配音/...）
  http.post<
    { id: string },
    {
      actionLabel: string
      sourceNodeId: string
      sourceNodeDefId: string
      userInput: string
      style?: string
    }
  >('/api/v1/canvases/:id/business-action', async ({ params, request }) => {
    const body = await request.json()
    if (!body?.sourceNodeId || !body?.sourceNodeDefId) {
      return fail(400, 'sourceNodeId / sourceNodeDefId 必填')
    }
    const result = triggerBusinessAction(params.id, body)
    if (!result) return fail(404, '画布或源节点不存在')
    return ok(result)
  }),
]
