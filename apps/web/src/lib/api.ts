import type {
  AIServiceConfig,
  AIVoice,
  AssetRecord,
  Character,
  Drama,
  Episode,
  EpisodeComposeStatusResponse,
  EpisodeMergeStatusResponse,
  ImageGeneration,
  Scene,
  Storyboard,
  TaskListPayload,
  TaskRecord,
  VideoGeneration,
  WritingDetail,
  WritingDocumentPayload,
  WritingListPayload,
} from '@/types/api'
import type { BatchExecutionItem } from '@/components/writing/types'
import { buildLoginPath } from '@/lib/login-redirect'

const BASE = '/api/v1'
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const GET_RESPONSE_CACHE_TTL_MS = 30_000
const inflightGetRequests = new Map<string, Promise<unknown>>()
const getResponseCache = new Map<string, { expiresAt: number; data: unknown }>()

type ApiRequestOptions = {
  redirectOnUnauthorized?: boolean
}

type DramaListParams = {
  page?: number
  page_size?: number
  status?: string
  keyword?: string
  include_details?: boolean
}

function isApiRequestOptions(value: DramaListParams | ApiRequestOptions | undefined): value is ApiRequestOptions {
  return typeof value === 'object' && value !== null && 'redirectOnUnauthorized' in value
}

function buildQueryString(params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    query.set(key, String(value))
  }
  return query.toString()
}

function parseApiJsonBody(text: string, path: string, status: number): unknown {
  const trimmed = text.trimStart()
  const looksHtml =
    trimmed.startsWith('<') || trimmed.startsWith('<!DOCTYPE') || trimmed.toLowerCase().includes('<html')
  if (looksHtml) {
    const staleHint =
      status === 500
        ? ' 若刚改过 API 路由或开发缓存损坏，可在 apps/web 目录执行 `npm run dev:clean` 后重启；项目已将开发/生产产物隔离到 `.next-dev` / `.next-prod`，避免静态资源互相污染。'
        : ''
    throw new Error(
      `接口 ${path} 返回了网页（HTTP ${status}）而不是 JSON，通常是 Next API 未就绪、页面崩溃，或服务启动异常。请确认 apps/web 已单独正常启动，并检查终端里的服务端报错。${staleHint}`,
    )
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    const preview = text.length > 160 ? `${text.slice(0, 160)}…` : text
    throw new Error(`接口 ${path} 返回了无效的 JSON（HTTP ${status}）：${preview}`)
  }
}

function formatRequestError(error: unknown, path: string): Error {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new Error(`请求 ${path} 超时，请确认后端与 Redis 已启动后重试`)
  }
  if (error instanceof Error && /Headers Timeout Error|fetch failed/i.test(error.message)) {
    return new Error(`请求 ${path} 失败，请确认 Docker/Redis 与后端服务已启动`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

async function req<T = unknown>(method: string, path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
  const dedupeKey = method === 'GET'
    ? `${method}:${path}:redirect=${options?.redirectOnUnauthorized !== false}`
    : null
  if (dedupeKey) {
    const cached = getResponseCache.get(dedupeKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T
    }
    if (cached) {
      getResponseCache.delete(dedupeKey)
    }

    const inflight = inflightGetRequests.get(dedupeKey)
    if (inflight) {
      return inflight as Promise<T>
    }
  }

  const execute = async () => {
    const opts: RequestInit = {
      method,
      signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    }
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' }
      opts.body = JSON.stringify(body)
    }

    const start = performance.now()
    console.log(`%c[API] %c${method} %c${path}`, 'color:#888', 'color:#4fc3f7;font-weight:bold', 'color:#ccc', body || '')

    try {
      const resp = await fetch(`${BASE}${path}`, opts)
      const text = await resp.text()
      const json = parseApiJsonBody(text, path, resp.status) as {
        code?: number
        message?: string
        data?: unknown
      }
      const ms = Math.round(performance.now() - start)

      if (resp.status === 401 && options?.redirectOnUnauthorized !== false && typeof window !== 'undefined') {
        const next = `${window.location.pathname}${window.location.search}`
        if (!window.location.pathname.startsWith('/login')) {
          window.location.assign(buildLoginPath(next))
        }
      }

      if (!resp.ok || (json.code && json.code >= 400)) {
        console.log(`%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', 'color:#888', json.message || '')
        throw new Error(json.message || `${resp.status}`)
      }

      console.log(`%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`, 'color:#888', 'color:#66bb6a', 'color:#66bb6a;font-weight:bold', 'color:#888')
      const data = (json.data ?? json) as T
      if (dedupeKey) {
        getResponseCache.set(dedupeKey, {
          data,
          expiresAt: Date.now() + GET_RESPONSE_CACHE_TTL_MS,
        })
      } else if (method !== 'GET') {
        getResponseCache.clear()
      }
      return data
    } catch (err: unknown) {
      const error = formatRequestError(err, path)
      if (!error.message?.match(/^\d{3}$/)) {
        const ms = Math.round(performance.now() - start)
        console.log(`%c[API] %c${method} ${path} %cERROR %c${ms}ms`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', 'color:#888', error.message)
      }
      throw error
    }
  }

  const requestPromise = execute()
  if (dedupeKey) {
    inflightGetRequests.set(dedupeKey, requestPromise)
    requestPromise.finally(() => {
      if (inflightGetRequests.get(dedupeKey) === requestPromise) {
        inflightGetRequests.delete(dedupeKey)
      }
    })
  }
  return requestPromise
}

export const api = {
  get: <T = unknown>(p: string, options?: ApiRequestOptions) => req<T>('GET', p, undefined, options),
  post: <T = unknown>(p: string, b?: unknown, options?: ApiRequestOptions) => req<T>('POST', p, b, options),
  put: <T = unknown>(p: string, b?: unknown, options?: ApiRequestOptions) => req<T>('PUT', p, b, options),
  patch: <T = unknown>(p: string, b?: unknown, options?: ApiRequestOptions) => req<T>('PATCH', p, b, options),
  del: <T = unknown>(p: string, options?: ApiRequestOptions) => req<T>('DELETE', p, undefined, options),
}

export const dramaAPI = {
  list: (paramsOrOptions?: DramaListParams | ApiRequestOptions, options?: ApiRequestOptions) => {
    const params = isApiRequestOptions(paramsOrOptions) ? undefined : paramsOrOptions
    const requestOptions = isApiRequestOptions(paramsOrOptions) ? paramsOrOptions : options
    const query = buildQueryString({
      page: params?.page,
      page_size: params?.page_size,
      status: params?.status,
      keyword: params?.keyword,
      include_details: params?.include_details === undefined ? undefined : params.include_details ? 1 : 0,
    })
    return api.get<{ items: Drama[] }>(`/dramas${query ? `?${query}` : ''}`, requestOptions)
  },
  stats: (options?: ApiRequestOptions) =>
    api.get<{ total: number; by_status: Array<{ status: string; count: number }> }>('/dramas/stats', options),
  get: (id: number, options?: ApiRequestOptions) => api.get<Drama>(`/dramas/${id}`, options),
  create: (data: Record<string, unknown>) => api.post('/dramas', data),
  splitEpisodes: (id: number, data: Record<string, unknown>) =>
    api.post<{ count: number; episodes: unknown[] }>(`/dramas/${id}/split-episodes`, data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/dramas/${id}`, data),
  del: (id: number) => api.del(`/dramas/${id}`),
}

export const episodeAPI = {
  get: (id: number) => api.get<Episode>(`/episodes/${id}`),
  create: (data: Record<string, unknown>) => api.post('/episodes', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/episodes/${id}`, data),
  characters: (id: number) => api.get<Character[]>(`/episodes/${id}/characters`),
  scenes: (id: number) => api.get<Scene[]>(`/episodes/${id}/scenes`),
  storyboards: (id: number) => api.get<Storyboard[]>(`/episodes/${id}/storyboards`),
  pipelineStatus: (id: number) => api.get(`/episodes/${id}/pipeline-status`),
}

export const storyboardAPI = {
  create: (data: Record<string, unknown>) => api.post('/storyboards', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/storyboards/${id}`, data),
  generateTTS: (id: number) => api.post(`/storyboards/${id}/generate-tts`),
  del: (id: number) => api.del(`/storyboards/${id}`),
}

export const characterAPI = {
  list: (options?: ApiRequestOptions) => api.get<{ items: Character[]; total?: number }>('/characters', options),
  update: (id: number, data: Record<string, unknown>) => api.put(`/characters/${id}`, data),
  del: (id: number) => api.del(`/characters/${id}`),
  voiceSample: (id: number, episodeId: number) => api.post<{ voice_sample_url: string }>(`/characters/${id}/generate-voice-sample`, { episode_id: episodeId }),
  generateImage: (id: number, episodeId: number) => api.post('/images', { character_id: id, episode_id: episodeId }),
  batchImages: (ids: number[], episodeId: number) => api.post('/characters/batch-generate-images', { character_ids: ids, episode_id: episodeId }),
}

export const sceneAPI = {
  list: (options?: ApiRequestOptions) => api.get<{ items: Scene[]; total?: number }>('/scenes', options),
  create: (data: Record<string, unknown>) => api.post('/scenes', data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/scenes/${id}`, data),
  del: (id: number) => api.del(`/scenes/${id}`),
  generateImage: (id: number, episodeId: number) => api.post('/images', { scene_id: id, episode_id: episodeId }),
}

export const imageAPI = {
  generate: (d: Record<string, unknown>) => api.post<ImageGeneration>('/images', d),
  get: (id: number) => api.get<ImageGeneration>(`/images/${id}`),
  list: (params?: { drama_id?: number; storyboard_id?: number }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.storyboard_id) query.set('storyboard_id', String(params.storyboard_id))
    return api.get<ImageGeneration[]>(`/images${query.size ? `?${query.toString()}` : ''}`)
  },
}

export const uploadAPI = {
  image: async (file: File) => {
    const form = new FormData()
    form.set('file', file)
    const response = await fetch(`${BASE}/upload/image`, {
      method: 'POST',
      body: form,
    })
    const text = await response.text()
    const json = parseApiJsonBody(text, '/upload/image', response.status) as {
      code?: number
      message?: string
      data?: { url: string; storage_key?: string }
    }
    if (!response.ok || (json.code && json.code >= 400)) {
      throw new Error(json.message || `上传失败（HTTP ${response.status}）`)
    }
    if (!json.data) throw new Error('上传失败')
    return json.data
  },
}

export const gridAPI = {
  prompt: (d: Record<string, unknown>) => api.post('/grid/prompt', d),
  generate: (d: Record<string, unknown>) => api.post('/grid/generate', d),
  status: (id: number) => api.get(`/grid/status/${id}`),
  split: (d: Record<string, unknown>) => api.post('/grid/split', d),
}

export const videoAPI = {
  generate: (d: Record<string, unknown>) => api.post('/videos', d),
  list: (params?: { drama_id?: number; storyboard_id?: number }) => {
    const query = new URLSearchParams()
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.storyboard_id) query.set('storyboard_id', String(params.storyboard_id))
    return api.get<VideoGeneration[]>(`/videos${query.size ? `?${query.toString()}` : ''}`)
  },
  get: (id: number) => api.get<VideoGeneration>(`/videos/${id}`),
}

export const quickVideoAPI = {
  generate: (d: Record<string, unknown>) =>
    api.post<{ video_generation_id: number; task_id: number | null; record: VideoGeneration }>('/quick-videos', d),
}

export const audioAPI = {
  generate: (d: { text: string; config_id?: number; voice_id?: string; speed?: number; emotion?: string; preview?: boolean }) =>
    api.post<{ audio_url: string | null; asset_id: number | null }>('/audio/generate', d),
}

export const taskAPI = {
  list: (params?: {
    page?: number
    page_size?: number
    q?: string
    status?: string
    type?: string
    source_type?: string
    sort?: 'created_at' | 'updated_at'
    order?: 'asc' | 'desc'
    drama_id?: number
    episode_id?: number
  }) => {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.page_size) query.set('page_size', String(params.page_size))
    if (params?.q) query.set('q', params.q)
    if (params?.status) query.set('status', params.status)
    if (params?.type) query.set('type', params.type)
    if (params?.source_type) query.set('source_type', params.source_type)
    if (params?.sort) query.set('sort', params.sort)
    if (params?.order) query.set('order', params.order)
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.episode_id) query.set('episode_id', String(params.episode_id))
    return api.get<TaskListPayload>(`/tasks${query.size ? `?${query.toString()}` : ''}`)
  },
  get: (id: number) => api.get<TaskRecord>(`/tasks/${id}`),
  retry: (id: number) => api.post<{
    task_id: number | null
    video_generation_id?: number
    image_generation_id?: number
    storyboard_id?: number
    merge_id?: number
    tts_audio_url?: string
    composed_video_url?: string
  }>(`/tasks/${id}/retry`),
  cancel: (id: number) => api.post<{ canceled: boolean }>(`/tasks/${id}/cancel`),
  del: (id: number) => api.del(`/tasks/${id}`),
  logs: (id: number) => api.get<Array<{ id: number; task_id: number; level: string; message: string; metadata: Record<string, unknown> | null; created_at: string }>>(`/tasks/${id}/logs`),
}

export const assetAPI = {
  list: (params?: {
    kind?: string
    q?: string
    source_type?: string
    drama_id?: number
  }) => {
    const query = new URLSearchParams()
    if (params?.kind) query.set('kind', params.kind)
    if (params?.q) query.set('q', params.q)
    if (params?.source_type) query.set('source_type', params.source_type)
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    return api.get<{ items: AssetRecord[]; total: number }>(`/assets${query.size ? `?${query.toString()}` : ''}`)
  },
  get: (id: number) => api.get<AssetRecord>(`/assets/${id}`),
  fromTask: (taskId: number) => api.post<AssetRecord>('/assets/from-task', { task_id: taskId }),
}

export const composeAPI = {
  shot: (id: number) => api.post(`/compose/storyboards/${id}/compose`),
  all: (epId: number) => api.post(`/compose/episodes/${epId}/compose-all`),
  status: (epId: number) => api.get<EpisodeComposeStatusResponse>(`/compose/episodes/${epId}/compose-status`),
}

export const mergeAPI = {
  merge: (epId: number) => api.post(`/merge/episodes/${epId}/merge`),
  status: (epId: number) => api.get<EpisodeMergeStatusResponse | null>(`/merge/episodes/${epId}/merge`),
}

export const aiConfigAPI = {
  list: (t?: string) => api.get<AIServiceConfig[]>(`/ai-configs${t ? `?service_type=${t}` : ''}`),
  create: (d: Record<string, unknown>) => api.post('/ai-configs', d),
  update: (id: number, d: Record<string, unknown>) => api.put(`/ai-configs/${id}`, d),
  del: (id: number) => api.del(`/ai-configs/${id}`),
  test: (d: Record<string, unknown>) => api.post('/ai-configs/test', d),
  xiaochuangPreset: (apiKey: string) => api.post('/ai-configs/xiaochuang-preset', { api_key: apiKey }),
}

export const agentConfigAPI = {
  list: () => api.get('/agent-configs'),
  get: (id: number) => api.get(`/agent-configs/${id}`),
  create: (d: Record<string, unknown>) => api.post('/agent-configs', d),
  update: (id: number, d: Record<string, unknown>) => api.put(`/agent-configs/${id}`, d),
  del: (id: number) => api.del(`/agent-configs/${id}`),
}

export const skillsAPI = {
  list: () => api.get('/skills'),
  get: async (id: string) => {
    const data = await api.get<string | { content?: string }>(`/skills/${id}`)
    return typeof data === 'string' ? data : String(data?.content || '')
  },
  create: (data: { id: string; name: string; description?: string }) => api.post('/skills', data),
  update: (id: string, content: string) => api.put(`/skills/${id}`, { content }),
  del: (id: string) => api.del(`/skills/${id}`),
}

export const voicesAPI = {
  list: (provider?: string) => api.get<AIVoice[]>(`/ai-voices${provider ? `?provider=${provider}` : ''}`),
  sync: () => api.post('/ai-voices/sync', {}),
}

export const writingAPI = {
  list: (params?: {
    page?: number
    page_size?: number
    kind?: string
    status?: string
    q?: string
    sort?: string
  }) => {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.page_size) query.set('page_size', String(params.page_size))
    if (params?.kind) query.set('kind', params.kind)
    if (params?.status) query.set('status', params.status)
    if (params?.q) query.set('q', params.q)
    if (params?.sort) query.set('sort', params.sort)
    return api.get<WritingListPayload>(`/writings${query.size ? `?${query.toString()}` : ''}`)
  },
  get: (id: number) => api.get<WritingDetail>(`/writings/${id}`),
  getDocument: (writingId: number, documentId: number) => api.get<WritingDocumentPayload>(`/writings/${writingId}/documents/${documentId}`),
  create: (body: { title: string; kind: string; synopsis?: string | null; brief_json?: string | null }) => api.post<{ writing_id: number; document_id: number }>('/writings', body),
  patch: (id: number, body: Record<string, unknown>) => api.patch<{ updated: boolean }>(`/writings/${id}`, body),
  addDocument: (writingId: number, body: { title: string; parent_id?: number | null; document_type: string }) => api.post<{ document_id: number }>(`/writings/${writingId}/documents`, body),
  patchDocument: (writingId: number, documentId: number, body: Record<string, unknown>) => api.patch<{ updated: boolean }>(`/writings/${writingId}/documents/${documentId}`, body),
  aiAction: (writingId: number, body: { document_id: number; action: string; instructions?: string }) => api.post<{ action: string; result_text: string; document_id: number }>(`/writings/${writingId}/ai-actions`, body),
  exportMarkdown: async (writingId: number) => {
    const response = await fetch(`/api/v1/writings/${writingId}/export?format=md`)
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || '导出失败')
    }
    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') || ''
    const matched = disposition.match(/filename\*=UTF-8''([^;]+)/)
    return {
      blob,
      filename: matched ? decodeURIComponent(matched[1]) : `writing-${writingId}.md`,
    }
  },
  importToDrama: (writingId: number, body?: { document_id?: number | null; title?: string }) =>
    api.post<{ drama_id: number; episode_id: number; source_writing_id: number; source_document_id: number | null }>('/dramas/from-writing', {
      writing_id: writingId,
      document_id: body?.document_id ?? null,
      title: body?.title,
    }),
  listProposals: (writingId: number) => api.get(`/writings/${writingId}/proposals`),
  getProposalImpact: (writingId: number, proposalId: number) => api.get(`/writings/${writingId}/proposal-impact?proposal_id=${proposalId}`),
  applyProposal: (writingId: number, proposalId: number) => api.post(`/writings/${writingId}/proposals/${proposalId}/apply`),
  rejectProposal: (writingId: number, proposalId: number) => api.post(`/writings/${writingId}/proposals/${proposalId}/reject`),
  batchPlanProposals: (writingId: number, body: { proposal_ids: number[] }) => api.post(`/writings/${writingId}/proposals/batch-plan`, body),
  batchApplyProposals: (writingId: number, body: { proposal_ids: number[]; allow_conflicts?: boolean; stop_on_error?: boolean }) => api.post(`/writings/${writingId}/proposals/batch-apply`, body),
  listBatchExecutions: async (writingId: number) => {
    const data = await api.get<BatchExecutionItem[] | { items?: BatchExecutionItem[] }>(`/writings/${writingId}/batch-executions`)
    return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
  },
  getBatchExecutionDetail: (writingId: number, executionId: number) => api.get(`/writings/${writingId}/batch-executions/detail?execution_id=${executionId}`),
  getBatchRollbackPreview: (writingId: number, executionId: number) => api.get(`/writings/${writingId}/batch-executions/rollback-preview?execution_id=${executionId}`),
  rollbackBatchExecution: (writingId: number, executionId: number) => api.post(`/writings/${writingId}/batch-executions/rollback`, { execution_id: executionId }),
  listKnowledgeCards: (writingId: number) => api.get(`/writings/${writingId}/knowledge-cards`),
  listReferenceNetwork: (writingId: number, params?: { proposal_id?: number; document_id?: number }) => {
    const query = new URLSearchParams()
    if (params?.proposal_id) query.set('proposal_id', String(params.proposal_id))
    if (params?.document_id) query.set('document_id', String(params.document_id))
    return api.get(`/writings/${writingId}/reference-network${query.size ? `?${query.toString()}` : ''}`)
  },
  listObjectHistories: (writingId: number, params: { object_kind: string; document_id?: number | null }) => {
    const query = new URLSearchParams()
    query.set('object_kind', params.object_kind)
    if (params.document_id) query.set('document_id', String(params.document_id))
    return api.get(`/writings/${writingId}/object-histories?${query.toString()}`)
  },
  previewObjectHistory: (writingId: number, historyId: number) => api.get(`/writings/${writingId}/object-histories/preview?history_id=${historyId}`),
  restoreObjectHistory: (writingId: number, historyId: number) => api.post(`/writings/${writingId}/object-histories/restore`, { history_id: historyId }),
  listKnowledgeCardHistories: (writingId: number, cardId: number) => api.get(`/writings/${writingId}/knowledge-cards/history?card_id=${cardId}`),
  restoreKnowledgeCardHistory: (writingId: number, historyId: number) => api.post(`/writings/${writingId}/knowledge-cards/history/restore`, { history_id: historyId }),
}

export const aiRuntimeAPI = {
  listRuns: (targetType: string, targetId: number) =>
    api.get<Array<{ id: number; user_message?: string | null; assistant_message?: string | null; actions?: unknown; created_at: string }>>(`/ai/runs?target_type=${encodeURIComponent(targetType)}&target_id=${targetId}`),
  run: async (payload: { skill_id: string; mode?: string; scene?: string; target: { type: string; writing_id?: number; document_id?: number }; input: { message: string; selection?: string | null }; options?: { stream?: boolean } }) => {
    const response = await fetch('/api/v1/ai/runs?stream=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok || !response.body) throw new Error('AI 请求失败')
    return response
  },
  applyAction: (runId: number, actionIndex: number) => api.post<{ type: string; structured?: Record<string, unknown> | null; writing_id?: number; document_id?: number }>(`/ai/result-actions/${runId}/apply`, { action_index: actionIndex }),
}
