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
 *   POST   /api/v1/canvases/:id/uploads              上传素材到画布
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
  CanvasNode,
  CanvasNodeResult,
  CanvasSaveRequest,
} from '@/lib/canvas/types'
import type { AssetRecord } from '@/types/api'
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

const MB = 1024 * 1024

const UPLOAD_POLICIES = [
  {
    kind: 'image' as const,
    nodeType: 'image' as const,
    maxBytes: 30 * MB,
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
  },
  {
    kind: 'video' as const,
    nodeType: 'video-asset' as const,
    maxBytes: 200 * MB,
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    extensions: ['.mp4', '.webm', '.mov'],
  },
  {
    kind: 'audio' as const,
    nodeType: 'audio' as const,
    maxBytes: 100 * MB,
    mimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'],
    extensions: ['.mp3', '.wav', '.m4a', '.aac', '.webm'],
  },
] as const

function readTextField(form: FormData, key: string) {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

function resolveUploadPolicy(file: File) {
  const mime = file.type.split(';')[0].trim().toLowerCase()
  const lowerName = file.name.toLowerCase()
  return UPLOAD_POLICIES.find((policy) => (
    (policy.mimeTypes as readonly string[]).includes(mime) ||
    policy.extensions.some((extension) => lowerName.endsWith(extension))
  )) || null
}

function mockUploadUrl(kind: CanvasNodeResult['kind'], fileName: string) {
  const encodedName = encodeURIComponent(fileName || 'upload.bin')
  if (kind === 'image') {
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f4e8da"/><rect x="48" y="48" width="544" height="264" rx="24" fill="#c95f41"/><text x="320" y="190" text-anchor="middle" font-family="Arial" font-size="34" fill="#fff">${fileName || 'upload'}</text></svg>`)}`
  }
  return `https://example.local/mock-canvas-upload/${encodedName}`
}

function buildUploadData(nodeType: CanvasNode['type'], title: string, result: CanvasNodeResult) {
  const data: Record<string, unknown> = {
    title,
    name: title,
    label: title,
    results: [result],
    current_result_id: result.id,
    previewUrl: result.url,
    outputUrl: result.url,
    __lastRunResult: {
      url: result.url,
      at: result.created_at,
      result_id: result.id,
      source_type: 'canvas_upload',
    },
  }
  if (nodeType === 'image') data.images = [result.url]
  if (nodeType === 'video-asset') {
    data.video = result.url
    data.videoUrl = result.url
    data.thumbnailUrl = result.thumbnail_url
  }
  if (nodeType === 'audio') {
    data.audio = result.url
    data.audioUrl = result.url
    data.url = result.url
  }
  return data
}

function getNodeResults(node: CanvasNode): CanvasNodeResult[] {
  return Array.isArray(node.data?.results)
    ? node.data.results.filter((item): item is CanvasNodeResult => Boolean(item && typeof item === 'object'))
    : []
}

function getCurrentResultId(node: CanvasNode) {
  return typeof node.data?.current_result_id === 'string' ? node.data.current_result_id : null
}

function applyCurrentResultToNode(node: CanvasNode, result: CanvasNodeResult): CanvasNode {
  const data: Record<string, unknown> = {
    ...(node.data || {}),
    current_result_id: result.id,
    previewUrl: result.url,
    outputUrl: result.url,
    __lastRunResult: {
      url: result.url,
      at: result.created_at,
      result_id: result.id,
      source_type: result.source_type ?? null,
    },
  }
  if (result.kind === 'image') data.images = [result.url]
  if (result.kind === 'video') {
    data.video = result.url
    data.videoUrl = result.url
  }
  if (result.kind === 'audio') {
    data.audio = result.url
    data.audioUrl = result.url
  }
  return { ...node, data }
}

function canvasAssetKind(kind: CanvasNodeResult['kind']): AssetRecord['kind'] {
  if (kind === 'video' || kind === 'audio') return kind
  return 'image'
}

function buildAssetRecord(canvas: CanvasDetail, node: CanvasNode, result: CanvasNodeResult): AssetRecord | null {
  if (!result.asset_id) return null
  const metadata = (result.metadata && typeof result.metadata === 'object') ? result.metadata : {}
  const assetSourceType = typeof metadata.asset_source_type === 'string'
    ? metadata.asset_source_type
    : result.source_type || 'canvas_generation'
  return {
    id: result.asset_id,
    kind: canvasAssetKind(result.kind),
    title: result.title || String(node.data?.title || node.data?.label || '画布产物'),
    provider: result.provider ?? null,
    mime_type: result.mime_type ?? null,
    source_type: assetSourceType,
    source_id: null,
    source_ref: canvas.id,
    source_path: `/canvas/${canvas.id}`,
    drama_id: null,
    episode_id: null,
    storyboard_id: null,
    task_id: null,
    image_generation_id: null,
    video_generation_id: null,
    url: result.url,
    thumbnail_url: result.thumbnail_url || result.url,
    metadata_json: JSON.stringify({
      canvas_id: canvas.id,
      canvas_title: canvas.title,
      node_id: node.id,
      node_def_id: node.type,
      result_id: result.id,
      prompt: result.prompt ?? null,
    }),
    created_at: result.created_at,
    updated_at: result.created_at,
    deleted_at: null,
  }
}

function listCanvasAssets(): AssetRecord[] {
  return listCanvases()
    .flatMap((canvas) => canvas.nodes.flatMap((node) => (
      getNodeResults(node)
        .map((result) => buildAssetRecord(canvas, node, result))
        .filter((asset): asset is AssetRecord => Boolean(asset))
    )))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
}

function saveNodeResultAsAsset(canvas: CanvasDetail, nodeId: string, resultId?: string, title?: string) {
  const node = canvas.nodes.find((item) => item.id === nodeId)
  if (!node) return null
  const results = getNodeResults(node)
  const currentId = getCurrentResultId(node)
  const result = resultId
    ? results.find((item) => item.id === resultId)
    : (results.find((item) => item.id === currentId) || results[0])
  if (!result) return null

  const assetId = result.asset_id ?? Number.parseInt(cryptoRandomId().slice(0, 8), 16)
  const assetSourceType = resultId && resultId !== currentId ? 'canvas_history' : (result.source_type || 'canvas_generation')
  const nextResult: CanvasNodeResult = {
    ...result,
    title: title?.trim() || result.title,
    asset_id: assetId,
    metadata: {
      ...(result.metadata || {}),
      asset_source_type: assetSourceType,
    },
  }
  const nextNode = {
    ...node,
    data: {
      ...(node.data || {}),
      results: results.map((item) => item.id === result.id ? nextResult : item),
    },
  }
  updateCanvas(canvas.id, {
    nodes: canvas.nodes.map((item) => item.id === node.id ? nextNode : item),
  })
  const asset = buildAssetRecord(canvas, nextNode, nextResult)
  return asset ? { asset, node: nextNode, result: nextResult } : null
}

function appendResultToNode(node: CanvasNode, result: CanvasNodeResult): CanvasNode {
  const existingResults = Array.isArray(node.data?.results)
    ? node.data.results.filter((item): item is CanvasNodeResult => Boolean(item && typeof item === 'object'))
    : []
  return {
    ...node,
    data: {
      ...node.data,
      ...buildUploadData((node.type || 'image') as CanvasNode['type'], result.title || '上传素材', result),
      results: [...existingResults, result],
      current_result_id: result.id,
    },
  }
}

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

  // POST /api/v1/canvases/:id/uploads — 上传文件生成节点 / 追加节点结果
  http.post<{ id: string }>('/api/v1/canvases/:id/uploads', async ({ params, request }) => {
    const canvas = getCanvas(params.id)
    if (!canvas) return fail(404, '画布不存在')

    const form = await request.formData().catch(() => null)
    if (!form) return fail(400, 'canvas_upload_multipart_required')
    const file = form?.get('file')
    if (!(file instanceof File)) return fail(400, 'canvas_upload_file_required')

    const policy = resolveUploadPolicy(file)
    if (!policy) return fail(400, 'canvas_upload_type_unsupported')
    if (file.size > policy.maxBytes) return fail(413, 'canvas_upload_too_large')

    const now = new Date().toISOString()
    const title = readTextField(form, 'title').trim() || file.name
    const saveToAssets = ['true', '1'].includes(readTextField(form, 'save_to_assets').trim().toLowerCase())
    const assetId = saveToAssets ? Number.parseInt(cryptoRandomId().slice(0, 8), 16) : null
    const url = mockUploadUrl(policy.kind, file.name)
    const result: CanvasNodeResult = {
      id: `res_${cryptoRandomId()}`,
      kind: policy.kind,
      url,
      thumbnail_url: policy.kind === 'image' ? url : null,
      mime_type: file.type || null,
      title,
      source_type: 'canvas_upload',
      created_at: now,
      metadata: { mock: true, size: file.size },
      asset_id: assetId,
    }
    const upload = {
      url,
      mime_type: file.type || 'application/octet-stream',
      kind: policy.kind,
      title,
    }
    const asset = assetId ? { id: assetId, title, source_type: 'canvas_upload' } : null

    const existingNodeId = readTextField(form, 'node_id').trim()
    if (existingNodeId) {
      const node = canvas.nodes.find((item) => item.id === existingNodeId)
      if (!node) return fail(404, 'canvas_node_not_found')
      const updatedNode = appendResultToNode(node, result)
      updateCanvas(params.id, {
        nodes: canvas.nodes.map((item) => (item.id === existingNodeId ? updatedNode : item)),
      })
      return ok({ node: updatedNode, result, upload, asset })
    }

    const x = Number.parseFloat(readTextField(form, 'position_x'))
    const y = Number.parseFloat(readTextField(form, 'position_y'))
    const node: CanvasNode = {
      id: `node_${cryptoRandomId()}`,
      type: policy.nodeType,
      position: {
        x: Number.isFinite(x) ? x : 120,
        y: Number.isFinite(y) ? y : 120,
      },
      data: buildUploadData(policy.nodeType, title, result),
    }
    updateCanvas(params.id, { nodes: [...canvas.nodes, node] })
    return ok({ node, result, upload, asset })
  }),

  http.get('/api/v1/assets', ({ request }) => {
    const url = new URL(request.url)
    const kind = url.searchParams.get('kind') || ''
    const sourceType = url.searchParams.get('source_type') || ''
    const q = (url.searchParams.get('q') || '').trim().toLowerCase()
    let items = listCanvasAssets()
    if (kind) items = items.filter((item) => item.kind === kind)
    if (sourceType) items = items.filter((item) => item.source_type === sourceType)
    if (q) {
      items = items.filter((item) => (
        item.title.toLowerCase().includes(q) ||
        item.source_type.toLowerCase().includes(q) ||
        String(item.metadata_json || '').toLowerCase().includes(q)
      ))
    }
    return ok({ items, total: items.length, page: 1, page_size: 50 })
  }),

  http.get('/api/v1/dramas', () => ok({ items: [] })),

  http.get<{ id: string; nodeId: string }>('/api/v1/canvases/:id/nodes/:nodeId/results', ({ params }) => {
    const canvas = getCanvas(params.id)
    if (!canvas) return fail(404, '画布不存在')
    const node = canvas.nodes.find((item) => item.id === params.nodeId)
    if (!node) return fail(404, 'node_not_found')
    return ok({
      current_result_id: getCurrentResultId(node),
      results: getNodeResults(node),
    })
  }),

  http.post<{ id: string; nodeId: string; resultId: string }>(
    '/api/v1/canvases/:id/nodes/:nodeId/results/:resultId/select',
    ({ params }) => {
      const canvas = getCanvas(params.id)
      if (!canvas) return fail(404, '画布不存在')
      const node = canvas.nodes.find((item) => item.id === params.nodeId)
      if (!node) return fail(404, 'node_not_found')
      const result = getNodeResults(node).find((item) => item.id === params.resultId)
      if (!result) return fail(400, 'result_not_found')
      const nextNode = applyCurrentResultToNode(node, result)
      updateCanvas(params.id, {
        nodes: canvas.nodes.map((item) => item.id === node.id ? nextNode : item),
      })
      return ok({ result, node: nextNode })
    },
  ),

  http.post<{ id: string }, { node_id: string; result_id?: string; title?: string }>(
    '/api/v1/canvases/:id/assets',
    async ({ params, request }) => {
      const canvas = getCanvas(params.id)
      if (!canvas) return fail(404, '画布不存在')
      const body = await request.json().catch(() => ({})) as { node_id?: string; result_id?: string; title?: string }
      if (!body.node_id) return fail(400, 'node_id_required')
      const saved = saveNodeResultAsAsset(canvas, body.node_id, body.result_id, body.title)
      if (!saved) return fail(400, 'canvas_result_not_found')
      return ok(saved)
    },
  ),

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
      sourceNodeId?: string
      sourceNodeDefId?: string
      userInput: string
      style?: string
      output_mode?: 'current_node' | 'insert_new_node'
      position_x?: number
      position_y?: number
      target_node_type?: CanvasNode['type']
    }
  >('/api/v1/canvases/:id/business-action', async ({ params, request }) => {
    const body = await request.json()
    if (body?.output_mode !== 'insert_new_node' && (!body?.sourceNodeId || !body?.sourceNodeDefId)) {
      return fail(400, 'sourceNodeId / sourceNodeDefId 必填')
    }
    const result = triggerBusinessAction(params.id, body)
    if (!result) return fail(404, '画布或源节点不存在')
    return ok(result)
  }),
]
