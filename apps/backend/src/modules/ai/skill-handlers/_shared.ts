import type { FastifyReply } from 'fastify'
import { eq } from 'drizzle-orm'
import { Readable } from 'node:stream'

import type { DatabaseService } from '../../../db/database.service'
import { aiRuns, tasks } from '../../../db/schema'
import { getTextConfig, getTextProviderBaseUrl } from '../../agents/agents.ai'

export { getTextConfig, getTextProviderBaseUrl }

// ──────────────────────────────────────────────────────────────────────────
// SSE writer
//
// All skill handlers stream over Server-Sent Events. The frontend in
// apps/web/src/hooks/use-workbench.ts (and use-grid-tool.ts) only inspects
// `evt.data`, so the `event:` line is informational. We default to `message`
// to match how the legacy /api/v1/agent/:type/chat path framed its events,
// which keeps the frontend's parser unchanged through the migration.
// ──────────────────────────────────────────────────────────────────────────

export interface SseEmitter {
  send: (data: unknown, event?: string) => Promise<void>
  writeRaw: (chunk: string) => Promise<void>
  close: () => Promise<void>
}

export function createSseTransform(): { stream: ReadableStream<Uint8Array>; emitter: SseEmitter } {
  const encoder = new TextEncoder()
  const transform = new TransformStream()
  const writer = transform.writable.getWriter()

  const emitter: SseEmitter = {
    async send(data, event) {
      const prefix = event ? `event: ${event}\n` : ''
      await writer.write(encoder.encode(`${prefix}data: ${JSON.stringify(data)}\n\n`))
    },
    async writeRaw(chunk) {
      await writer.write(encoder.encode(chunk))
    },
    async close() {
      try {
        await writer.close()
      } catch {
        // ignore
      }
    },
  }

  return { stream: transform.readable, emitter }
}

export function applySseHeaders(reply: FastifyReply) {
  reply.header('Content-Type', 'text/event-stream; charset=utf-8')
  reply.header('Cache-Control', 'no-cache, no-transform')
  reply.header('Connection', 'keep-alive')
  reply.header('X-Accel-Buffering', 'no')
}

export function sendSseReply(reply: FastifyReply, stream: ReadableStream<Uint8Array>) {
  applySseHeaders(reply)
  return reply.send(Readable.fromWeb(stream as globalThis.ReadableStream<any>))
}

// ──────────────────────────────────────────────────────────────────────────
// chat/completions text extraction (works for both streaming deltas and
// blocking message payloads). Mirrors the helpers that used to live in
// agents.service.ts so the migrated handlers behave identically.
// ──────────────────────────────────────────────────────────────────────────

export function extractStreamingText(payload: any): string {
  const choice = payload?.choices?.[0]
  const content = choice?.delta?.content ?? choice?.text
  return joinContentParts(content)
}

export function extractMessageText(payload: any): string {
  const choice = payload?.choices?.[0]
  const content = choice?.message?.content ?? choice?.text
  return joinContentParts(content)
}

function joinContentParts(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .join('')
  }
  return ''
}

export function parseSseDataBlock(block: string): any | null {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
  if (!dataLines.length) return null
  const data = dataLines.join('\n').trim()
  if (!data || data === '[DONE]') return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────────
// JSON extraction & repair
//
// Several skills (extractor, voice_assigner, storyboard_breaker) need a
// strict JSON response. Real-world LLMs occasionally wrap the JSON in code
// fences or omit commas; these helpers tolerate both forms and fall back to
// a structured repair request to the same model when the first parse fails.
// ──────────────────────────────────────────────────────────────────────────

function isWhitespace(char: string) {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

function insertMissingJsonCommas(source: string) {
  let output = ''
  let inString = false
  let escaped = false
  let lastSignificant = ''

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
        lastSignificant = '"'
      }
      continue
    }

    if (char === '"') {
      const nextNonWhitespace = source.slice(i + 1).match(/\S/)?.[0] || ''
      if (
        (lastSignificant === '}' || lastSignificant === ']' || lastSignificant === '"')
        && nextNonWhitespace !== ':'
      ) {
        output += ','
      }
      output += char
      inString = true
      escaped = false
      continue
    }

    if ((char === '{' || char === '[') && (lastSignificant === '}' || lastSignificant === ']')) {
      output += ','
    }

    output += char
    if (!isWhitespace(char)) {
      lastSignificant = char
    }
  }

  return output
}

function normalizeJsonSource(source: string) {
  return insertMissingJsonCommas(source)
    .replace(/^﻿/, '')
    .replace(/,\s*([}\]])/g, '$1')
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('AI 未返回 JSON')

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const source = fenced?.[1]?.trim() || trimmed
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) {
    throw new Error('AI 返回内容不是有效 JSON 对象')
  }

  const jsonSource = source.slice(first, last + 1)

  try {
    return JSON.parse(jsonSource) as unknown
  } catch {
    const normalized = normalizeJsonSource(jsonSource)
    return JSON.parse(normalized) as unknown
  }
}

export function buildJsonRepairPrompt(args: { content: string; error: string; shape: string }) {
  return `下面是一段无效 JSON，解析错误是：${args.error}

请只修复 JSON 语法错误，并只返回一个合法 JSON 对象，不要 Markdown，不要解释。

要求：
- 顶层 JSON 结构必须是：${args.shape}
- 不要删除顶层字段。
- 字符串内部换行和双引号必须正确转义。
- 数组元素和对象字段之间必须有逗号。

无效 JSON：
${args.content}`
}

// ──────────────────────────────────────────────────────────────────────────
// chat/completions helpers
// ──────────────────────────────────────────────────────────────────────────

export interface ChatRequestArgs {
  databaseService: DatabaseService
  systemPrompt: string
  userMessage: string
  temperature?: number
  maxTokens?: number
  responseFormatJson?: boolean
}

export async function requestChatCompletion(args: ChatRequestArgs): Promise<string> {
  const config = await getTextConfig(args.databaseService)
  const url = `${getTextProviderBaseUrl(config).replace(/\/+$/, '')}/chat/completions`

  const messages: Array<{ role: 'system' | 'user'; content: string }> = []
  if (args.systemPrompt) messages.push({ role: 'system', content: args.systemPrompt })
  messages.push({ role: 'user', content: args.userMessage })

  const body: Record<string, unknown> = {
    model: config.model,
    temperature: args.temperature ?? 0.7,
    messages,
  }
  if (args.maxTokens) body.max_tokens = args.maxTokens
  if (args.responseFormatJson) body.response_format = { type: 'json_object' }

  const doFetch = async (payload: Record<string, unknown>) => fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  let response = await doFetch(body)
  if (!response.ok && args.responseFormatJson) {
    // Some providers reject response_format: json_object on certain models.
    // Retry once without it; downstream parser still handles fenced output.
    const message = await response.text().catch(() => '')
    if (response.status === 400 && /response_format|json_object/i.test(message)) {
      const { response_format: _ignored, ...fallbackBody } = body
      response = await doFetch(fallbackBody)
    } else {
      throw new Error(message || `AI 请求失败（${response.status}）`)
    }
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `AI 请求失败（${response.status}）`)
  }

  const payload = await response.json() as unknown
  const text = extractMessageText(payload)
  if (!text) throw new Error('AI 响应为空')
  return text
}

export async function requestJsonObject<T>(args: ChatRequestArgs & { shape: string }): Promise<T> {
  const content = await requestChatCompletion({ ...args, responseFormatJson: true })
  try {
    return extractJsonObject(content) as T
  } catch (error) {
    const repaired = await requestChatCompletion({
      databaseService: args.databaseService,
      systemPrompt: '',
      userMessage: buildJsonRepairPrompt({
        content,
        error: error instanceof Error ? error.message : String(error),
        shape: args.shape,
      }),
      temperature: 0,
      maxTokens: args.maxTokens,
    })
    return extractJsonObject(repaired) as T
  }
}

// ──────────────────────────────────────────────────────────────────────────
// ai_runs ledger helper
// ──────────────────────────────────────────────────────────────────────────

export interface AiRunRecord {
  userId: number
  skillId: string
  mode: string
  scene: string
  targetType: string
  targetId: number
  userMessage: string
  assistantMessage: string
  referencesJson?: string
  actionsJson?: string
}

export interface AiRunTaskHandle {
  aiRunId: number
  taskId: number | null
}

function trimText(value: unknown, maxLength: number) {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length <= maxLength) return text
  if (maxLength <= 3) return text.slice(0, maxLength)
  return `${text.slice(0, maxLength - 3)}...`
}

function inferErrorKind(message: string | null | undefined) {
  const text = String(message || '').toLowerCase()
  if (!text) return 'internal'
  if (text.includes('cancel')) return 'canceled'
  if (text.includes('timeout') || text.includes('timed out')) return 'network'
  if (text.includes('429') || text.includes('quota') || text.includes('rate limit')) return 'quota'
  if (text.includes('invalid') || text.includes('required') || text.includes('not found')) return 'validation'
  if (text.includes('moderation') || text.includes('sensitive') || text.includes('安全')) return 'moderation'
  return 'provider'
}

function shouldCreateTaskForAiRun(record: AiRunRecord) {
  return record.targetType === 'episode'
}

function buildAiTaskTitle(record: AiRunRecord) {
  const labels: Record<string, string> = {
    script_rewriter: 'AI 改写剧本',
    extractor: '提取角色场景',
    voice_assigner: '分配角色音色',
    storyboard_breaker: '拆解分镜',
    storyboard_from_text: '文本生成分镜',
    grid_prompt_generator: '生成宫格提示词',
  }
  return labels[record.skillId] || record.skillId
}

function buildAiTaskPayload(record: AiRunRecord) {
  return JSON.stringify({
    skill_id: record.skillId,
    mode: record.mode,
    scene: record.scene,
    target_type: record.targetType,
    target_id: record.targetId,
  })
}

export async function startAiRunTask(databaseService: DatabaseService, record: AiRunRecord & {
  dramaId?: number | null
  episodeId?: number | null
}) {
  const now = new Date()
  const [run] = await databaseService.db.insert(aiRuns).values({
    userId: record.userId,
    skillId: record.skillId,
    mode: record.mode,
    scene: record.scene,
    targetType: record.targetType,
    targetId: record.targetId,
    status: 'running',
    userMessage: record.userMessage,
    assistantMessage: record.assistantMessage || '',
    referencesJson: record.referencesJson ?? JSON.stringify([]),
    actionsJson: record.actionsJson ?? JSON.stringify([]),
    createdAt: now,
    updatedAt: now,
  }).returning({ id: aiRuns.id })

  if (!shouldCreateTaskForAiRun(record)) {
    return { aiRunId: run.id, taskId: null }
  }

  const [task] = await databaseService.db.insert(tasks).values({
    userId: record.userId,
    type: 'ai',
    status: 'running',
    title: buildAiTaskTitle(record),
    progress: null,
    sourceType: 'drama_ai_skill',
    dramaId: record.dramaId ?? null,
    episodeId: record.episodeId ?? record.targetId,
    storyboardId: null,
    aiConfigId: null,
    domainTable: 'ai_runs',
    domainId: run.id,
    providerTaskId: null,
    attemptCount: 0,
    payloadJson: buildAiTaskPayload(record),
    resultSummaryJson: null,
    errorKind: null,
    errorMessage: null,
    errorDetailsJson: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
  }).returning({ id: tasks.id })

  return { aiRunId: run.id, taskId: task.id }
}

export async function completeAiRunTask(
  databaseService: DatabaseService,
  handle: AiRunTaskHandle,
  record: Pick<AiRunRecord, 'assistantMessage' | 'referencesJson' | 'actionsJson'> & {
    resultSummary?: Record<string, unknown>
  },
) {
  const now = new Date()
  await databaseService.db
    .update(aiRuns)
    .set({
      status: 'completed',
      assistantMessage: record.assistantMessage,
      referencesJson: record.referencesJson ?? JSON.stringify([]),
      actionsJson: record.actionsJson ?? JSON.stringify([]),
      updatedAt: now,
    })
    .where(eq(aiRuns.id, handle.aiRunId))

  if (handle.taskId != null) {
    await databaseService.db
      .update(tasks)
      .set({
        status: 'completed',
        progress: 100,
        resultSummaryJson: JSON.stringify(record.resultSummary ?? {
          assistant_preview: trimText(record.assistantMessage, 240),
        }),
        errorKind: null,
        errorMessage: null,
        errorDetailsJson: null,
        updatedAt: now,
        completedAt: now,
      })
      .where(eq(tasks.id, handle.taskId))
  }
}

export async function failAiRunTask(databaseService: DatabaseService, handle: AiRunTaskHandle, error: unknown) {
  const now = new Date()
  const message = error instanceof Error ? error.message : String(error || 'AI execution failed')
  const errorKind = inferErrorKind(message)

  await databaseService.db
    .update(aiRuns)
    .set({
      status: 'failed',
      assistantMessage: message,
      updatedAt: now,
    })
    .where(eq(aiRuns.id, handle.aiRunId))

  if (handle.taskId != null) {
    await databaseService.db
      .update(tasks)
      .set({
        status: 'failed',
        progress: null,
        errorKind,
        errorMessage: trimText(message, 240),
        errorDetailsJson: JSON.stringify({ error_kind: errorKind, raw_error: message }),
        updatedAt: now,
        completedAt: now,
      })
      .where(eq(tasks.id, handle.taskId))
  }
}

export async function persistAiRun(databaseService: DatabaseService, record: AiRunRecord) {
  const [run] = await databaseService.db.insert(aiRuns).values({
    userId: record.userId,
    skillId: record.skillId,
    mode: record.mode,
    scene: record.scene,
    targetType: record.targetType,
    targetId: record.targetId,
    status: 'completed',
    userMessage: record.userMessage,
    assistantMessage: record.assistantMessage,
    referencesJson: record.referencesJson ?? JSON.stringify([]),
    actionsJson: record.actionsJson ?? JSON.stringify([]),
  }).returning({ id: aiRuns.id })

  if (!shouldCreateTaskForAiRun(record)) return { aiRunId: run.id, taskId: null }

  const now = new Date()
  const [task] = await databaseService.db.insert(tasks).values({
    userId: record.userId,
    type: 'ai',
    status: 'completed',
    title: buildAiTaskTitle(record),
    progress: 100,
    sourceType: 'drama_ai_skill',
    dramaId: null,
    episodeId: record.targetId,
    storyboardId: null,
    aiConfigId: null,
    domainTable: 'ai_runs',
    domainId: run.id,
    providerTaskId: null,
    attemptCount: 0,
    payloadJson: buildAiTaskPayload(record),
    resultSummaryJson: JSON.stringify({
      assistant_preview: trimText(record.assistantMessage, 240),
    }),
    errorKind: null,
    errorMessage: null,
    errorDetailsJson: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: now,
  }).returning({ id: tasks.id })

  return { aiRunId: run.id, taskId: task.id }
}
