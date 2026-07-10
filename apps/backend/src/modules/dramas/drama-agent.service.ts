import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'

import { getTextProviderBaseUrl } from '../agents/agents.ai'
import { AiConfigResolverService, type AIConfig } from '../ai-configs/ai-configs.resolver'

type DramaAgentTaskType =
  | 'source_chunk_analyze'
  | 'source_global_summarize'
  | 'adaptation_brief_generate'
  | 'episode_blueprint_generate'
  | 'episode_script_generate'

type DramaAgentExecutionInput = {
  userId: number
  taskType: DramaAgentTaskType
  idempotencyKey: string
  systemPrompt: string
  userPrompt: string
  outputSchemaName: string
}

type DramaAgentExecutionResult = {
  result: unknown
  remoteRunId: string
  usage: Record<string, unknown> | null
  warnings: string[]
}

type SourceHealthLike = {
  status: string
  word_count: number
  chapter_count: number
  estimated_tokens: number
  over_context_limit: boolean
  chunk_count: number
  recommended_mode: string
  chapter_index?: Array<{
    chapter_no: number
    title: string
    word_count: number
    brief: string
  }>
  anomalies?: Array<Record<string, unknown>>
}

type SourceAnalysisLike = {
  theme: string
  core_conflict: string
  protagonist: string
  antagonist?: string | null
  protagonist_goal: string
  relationship_map: Array<Record<string, unknown>>
  world_rules: string[]
  emotional_curve: Array<Record<string, unknown>>
  adaptation_risks: string[]
  evidence: Array<{
    claim: string
    source_trace: Array<Record<string, unknown>>
  }>
}

type SourceChunkAnalysisLike = {
  summary: string
  key_events: string[]
  characters: string[]
  scenes: string[]
  risks: string[]
  source_trace: Array<Record<string, unknown>>
}

type AdaptationBriefLike = {
  id: string
  name: string
  claim: string
  rhythm_model: string
  target_episode_count: number
  episode_duration: string
  style_direction: string
  hook_density: string
  retained_points: string[]
  removed_points: string[]
  risk_notes: string[]
  production_cost: string
  recommended_for: string
}

type EpisodeBlueprintLike = {
  episode_number: number
  title: string
  positioning: string
  opening_hook: string
  summary: string
  source_trace: Array<Record<string, unknown>>
  characters: string[]
  scenes: string[]
  ending_hook: string
  risk_notes: string[]
  brief_id: string
}

function toRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function compactText(value: unknown, maxLength: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getDefaultMaxTokens(taskType: DramaAgentTaskType) {
  switch (taskType) {
    case 'source_chunk_analyze':
      return 1800
    case 'source_global_summarize':
      return 3000
    case 'adaptation_brief_generate':
      return 2500
    case 'episode_blueprint_generate':
      return 4000
    case 'episode_script_generate':
      return 8192
  }
}

function resolveMaxTokens(taskType: DramaAgentTaskType) {
  const taskEnvKey = `DRAMA_AGENT_${taskType.toUpperCase()}_MAX_TOKENS`
  return parsePositiveInt(
    process.env[taskEnvKey] || process.env.DRAMA_AGENT_MAX_TOKENS,
    getDefaultMaxTokens(taskType),
  )
}

function extractJsonPayload(text: string) {
  const normalized = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(normalized) as unknown
  } catch {
    const objectStart = normalized.indexOf('{')
    const objectEnd = normalized.lastIndexOf('}')
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(normalized.slice(objectStart, objectEnd + 1)) as unknown
    }
    const arrayStart = normalized.indexOf('[')
    const arrayEnd = normalized.lastIndexOf(']')
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(normalized.slice(arrayStart, arrayEnd + 1)) as unknown
    }
    throw new BadRequestException('remote_agent_non_json')
  }
}

function extractChatText(payload: unknown) {
  const raw = toRecord(payload)
  const choice = Array.isArray(raw.choices) ? toRecord(raw.choices[0]) : {}
  const message = toRecord(choice.message)
  const content = message.content ?? choice.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      const item = toRecord(part)
      return typeof item.text === 'string' ? item.text : ''
    }).join('')
  }
  return ''
}

function unwrapResult(payload: unknown, keys: string[]) {
  const raw = toRecord(payload)
  for (const key of keys) {
    if (raw[key] != null) return raw[key]
  }
  if (raw.result != null) return raw.result
  return payload
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  const text = String(value || '').trim()
  return text ? [text] : []
}

function recordArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => toRecord(item))
  if (value && typeof value === 'object') return Object.values(value).map((item) => toRecord(item))
  return []
}

function normalizeEvidence(value: unknown) {
  if (Array.isArray(value)) return value
  const raw = toRecord(value)
  if (!Object.keys(raw).length) return []
  if (raw.claim || raw.source_trace) return [{
    ...raw,
    claim: firstString(raw.claim, raw['结论'], raw['证据'], '来源证据'),
    source_trace: Array.isArray(raw.source_trace) ? raw.source_trace : [],
  }]
  return Object.entries(raw).map(([claim, evidence]) => {
    const item = toRecord(evidence)
    return {
      ...item,
      claim: firstString(item.claim, claim),
      source_trace: Array.isArray(item.source_trace) ? item.source_trace : [],
    }
  })
}

function normalizeSourceAnalysisPayload(value: unknown) {
  const raw = toRecord(value)
  const nested = toRecord(raw.analysis || raw.overview || raw.summary || raw['分析'])
  const merged = Object.keys(nested).length ? { ...raw, ...nested } : raw

  return {
    ...merged,
    theme: firstString(merged.theme, merged.topic, merged.main_theme, merged['主题']),
    core_conflict: firstString(merged.core_conflict, merged.conflict, merged['核心冲突'], merged['主要冲突']),
    protagonist: firstString(merged.protagonist, merged.hero, merged.main_character, merged['主角'], merged['主人公']),
    antagonist: firstString(merged.antagonist, merged.villain, merged['反派'], merged['对立面']) || null,
    protagonist_goal: firstString(merged.protagonist_goal, merged.goal, merged['主角目标'], merged['人物目标']),
    relationship_map: recordArray(merged.relationship_map || merged.relationships || merged['人物关系']),
    world_rules: stringArray(merged.world_rules || merged.rules || merged['世界规则']),
    emotional_curve: recordArray(merged.emotional_curve || merged.emotion_curve || merged['情绪曲线']),
    adaptation_risks: stringArray(merged.adaptation_risks || merged.risks || merged['改编风险']),
    evidence: normalizeEvidence(merged.evidence || merged['证据'] || merged.source_trace),
  }
}

function positiveIntFromUnknown(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  const match = String(value || '').match(/\d+/)
  const parsed = match ? Number(match[0]) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function arrayPayload(value: unknown, keys: string[]) {
  if (Array.isArray(value)) return value
  const raw = toRecord(value)
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key] as unknown[]
  }
  const values = Object.values(raw).filter((item) => item && typeof item === 'object')
  return values.length ? values : []
}

function normalizeAdaptationBriefPayload(value: unknown) {
  return arrayPayload(value, ['adaptation_briefs', 'briefs', 'strategies', 'adaptation_strategies', '方案'])
    .map((item, index) => {
      const raw = toRecord(item)
      const name = firstString(raw.name, raw.title, raw.strategy_name, raw['名称'], raw['策略名称'], raw['方案名称'], `改编策略 ${index + 1}`)
      return {
        ...raw,
        id: firstString(raw.id, raw.brief_id, raw.strategy_id, raw.key, raw['id'], raw['策略ID'], `brief_${index + 1}`),
        name,
        claim: firstString(raw.claim, raw.pitch, raw.summary, raw.description, raw['核心主张'], raw['策略主张'], raw['一句话卖点'], raw['简介'], name),
        rhythm_model: firstString(raw.rhythm_model, raw.rhythm, raw.pacing, raw['节奏模型'], raw['叙事节奏'], raw['节奏'], '强钩子三段式'),
        target_episode_count: positiveIntFromUnknown(raw.target_episode_count || raw.episode_count || raw.episodes || raw['目标集数'] || raw['集数'], 24),
        episode_duration: firstString(raw.episode_duration, raw.duration, raw['单集时长'], raw['时长'], '60-90 秒'),
        style_direction: firstString(raw.style_direction, raw.style, raw.tone, raw['风格方向'], raw['风格'], name),
        hook_density: firstString(raw.hook_density, raw.hooks, raw['钩子密度'], raw['爽点密度'], '中'),
        retained_points: stringArray(raw.retained_points || raw.keep || raw['保留点'] || raw['保留内容']),
        removed_points: stringArray(raw.removed_points || raw.remove || raw['删减点'] || raw['舍弃内容']),
        risk_notes: stringArray(raw.risk_notes || raw.risks || raw['风险提示'] || raw['风险']),
        production_cost: firstString(raw.production_cost, raw.cost, raw['制作成本'], raw['成本'], '中'),
        recommended_for: firstString(raw.recommended_for, raw.audience, raw['适用场景'], raw['推荐用途'], ''),
      }
    })
}

function normalizeEpisodeBlueprintPayload(value: unknown) {
  return arrayPayload(value, ['episode_blueprints', 'blueprints', 'episodes', 'outlines', '分集蓝图', '集数蓝图'])
    .map((item, index) => {
      const raw = toRecord(item)
      const title = firstString(raw.title, raw.name, raw.episode_title, raw['标题'], raw['集标题'], `第 ${index + 1} 集`)
      const summary = firstString(
        raw.summary,
        raw.synopsis,
        raw.overview,
        raw.plot,
        raw.content,
        raw.description,
        raw['剧情概述'],
        raw['摘要'],
        raw['本集梗概'],
        raw['内容'],
      )
      const openingHook = firstString(
        raw.opening_hook,
        raw.hook,
        raw.opening,
        raw.opening_scene,
        raw.start_hook,
        raw['开场钩子'],
        raw['开篇钩子'],
        raw['开场'],
      )
      const endingHook = firstString(
        raw.ending_hook,
        raw.cliffhanger,
        raw.ending,
        raw.end_hook,
        raw.final_hook,
        raw['结尾钩子'],
        raw['结尾悬念'],
        raw['结尾'],
      )

      return {
        ...raw,
        episode_number: positiveIntFromUnknown(raw.episode_number || raw.episode || raw.index || raw.no || raw['集数'] || raw['第几集'], index + 1),
        title,
        positioning: firstString(raw.positioning, raw.position, raw.role, raw.purpose, raw['定位'], raw['本集定位'], title),
        opening_hook: firstString(openingHook, summary, title),
        summary: firstString(summary, raw.key_beats, raw.beats, openingHook, title),
        source_trace: Array.isArray(raw.source_trace)
          ? raw.source_trace
          : Array.isArray(raw.source)
            ? raw.source
            : Array.isArray(raw['来源'])
              ? raw['来源']
              : [],
        characters: stringArray(raw.characters || raw.character_list || raw['人物'] || raw['角色']),
        scenes: stringArray(raw.scenes || raw.scene_list || raw.locations || raw['场景'] || raw['地点']),
        ending_hook: firstString(endingHook, summary, title),
        risk_notes: stringArray(raw.risk_notes || raw.risks || raw['风险提示'] || raw['风险']),
        brief_id: firstString(raw.brief_id, raw.strategy_id, raw['策略ID']),
      }
    })
}

function parseAgentSchema<T>(schema: z.ZodType<T>, value: unknown, schemaName: string): T {
  try {
    return schema.parse(value)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}:${issue.message}`)
        .join('; ')
      throw new BadRequestException(`remote_agent_invalid_output:${schemaName}:${compactText(detail, 500)}`)
    }
    throw error
  }
}

const sourceTraceSchema = z.preprocess((value) => {
  if (typeof value === 'string') return { excerpt: value }
  return value
}, z.object({
  source_id: z.union([z.number(), z.string()]).nullish(),
  chunk_id: z.union([z.number(), z.string()]).nullish(),
  chapter_no: z.number().nullable().optional(),
  chapter_title: z.string().nullable().optional(),
  content_start: z.number().nullable().optional(),
  content_end: z.number().nullable().optional(),
  excerpt: z.string().nullable().optional(),
}).passthrough())

const sourceAnalysisSchema = z.object({
  theme: z.string().trim().min(1),
  core_conflict: z.string().trim().min(1),
  protagonist: z.string().trim().min(1),
  antagonist: z.string().trim().nullable().optional(),
  protagonist_goal: z.string().trim().min(1),
  relationship_map: z.array(z.record(z.unknown())).default([]),
  world_rules: z.array(z.string()).default([]),
  emotional_curve: z.array(z.record(z.unknown())).default([]),
  adaptation_risks: z.array(z.string()).default([]),
  evidence: z.array(z.object({
    claim: z.string().trim().min(1),
    source_trace: z.array(sourceTraceSchema).default([]),
  }).passthrough()).default([]),
}).passthrough()

const sourceChunkAnalysisSchema = z.object({
  summary: z.string().trim().min(1),
  key_events: z.array(z.string()).default([]),
  characters: z.array(z.string()).default([]),
  scenes: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  source_trace: z.array(sourceTraceSchema).default([]),
}).passthrough()

const adaptationBriefSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  claim: z.string().trim().min(1),
  rhythm_model: z.string().trim().min(1),
  target_episode_count: z.number().int().positive(),
  episode_duration: z.string().trim().min(1),
  style_direction: z.string().trim().min(1),
  hook_density: z.union([z.string(), z.number()]).transform((value) => String(value || '')).default('中'),
  retained_points: z.array(z.string()).default([]),
  removed_points: z.array(z.string()).default([]),
  risk_notes: z.array(z.string()).default([]),
  production_cost: z.union([z.string(), z.number()]).transform((value) => String(value || '')).default('中'),
  recommended_for: z.string().default(''),
}).passthrough()

const episodeBlueprintSchema = z.object({
  episode_number: z.number().int().positive(),
  title: z.string().trim().min(1),
  positioning: z.string().trim().min(1),
  opening_hook: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  source_trace: z.array(sourceTraceSchema).default([]),
  characters: z.array(z.string()).default([]),
  scenes: z.array(z.string()).default([]),
  ending_hook: z.string().trim().min(1),
  risk_notes: z.array(z.string()).default([]),
  brief_id: z.string().default(''),
}).passthrough()

@Injectable()
export class DramaAgentSchemaValidator {
  validateSourceChunkAnalysis(payload: unknown): SourceChunkAnalysisLike {
    return parseAgentSchema<SourceChunkAnalysisLike>(
      sourceChunkAnalysisSchema as z.ZodType<SourceChunkAnalysisLike>,
      unwrapResult(payload, ['source_chunk_analysis', 'chunk_analysis']),
      'SourceChunkAnalysis',
    )
  }

  validateSourceAnalysis(payload: unknown): SourceAnalysisLike {
    return parseAgentSchema<SourceAnalysisLike>(
      sourceAnalysisSchema as z.ZodType<SourceAnalysisLike>,
      normalizeSourceAnalysisPayload(unwrapResult(payload, ['source_analysis', 'analysis'])),
      'SourceAnalysis',
    )
  }

  validateAdaptationBriefs(payload: unknown, minCount = 2): AdaptationBriefLike[] {
    const value = normalizeAdaptationBriefPayload(unwrapResult(payload, [
      'adaptation_briefs',
      'briefs',
      'strategies',
      'adaptation_strategies',
      '方案',
    ]))
    const briefs = parseAgentSchema<AdaptationBriefLike[]>(
      z.array(adaptationBriefSchema).min(minCount) as z.ZodType<AdaptationBriefLike[]>,
      value,
      'AdaptationBrief[]',
    )
    return briefs
  }

  validateEpisodeBlueprints(payload: unknown): EpisodeBlueprintLike[] {
    const value = normalizeEpisodeBlueprintPayload(unwrapResult(payload, [
      'episode_blueprints',
      'blueprints',
      'episodes',
      'outlines',
      '分集蓝图',
      '集数蓝图',
    ]))
    return parseAgentSchema<EpisodeBlueprintLike[]>(
      z.array(episodeBlueprintSchema).min(1) as z.ZodType<EpisodeBlueprintLike[]>,
      value,
      'EpisodeBlueprint[]',
    )
  }

  validateEpisodeScript(payload: unknown) {
    const value = unwrapResult(payload, ['episode_script', 'script'])
    const raw = typeof value === 'string' ? { script_content: value } : toRecord(value)
    return parseAgentSchema(z.object({
      script_content: z.string().trim().min(1),
    }).passthrough(), raw, 'EpisodeScript').script_content
  }
}

@Injectable()
export class RemoteDramaAgentAdapter {
  constructor(@Inject(AiConfigResolverService) private readonly aiConfigResolver: AiConfigResolverService) {}

  async executeJson(input: DramaAgentExecutionInput): Promise<DramaAgentExecutionResult> {
    const config = await this.resolveConfig(input.userId)
    const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
    const timeoutMs = parsePositiveInt(process.env.DRAMA_AGENT_TIMEOUT_MS, 120_000)
    const maxTokens = resolveMaxTokens(input.taskType)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'X-Drama-Agent-Task': input.taskType,
          'X-Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.35,
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userPrompt },
          ],
          max_tokens: maxTokens,
        }),
      })

      const text = await response.text()
      if (!response.ok) {
        throw new BadRequestException(`remote_agent_failed:${response.status}:${compactText(text, 300)}`)
      }
      const body = text ? JSON.parse(text) as unknown : {}
      const assistantText = extractChatText(body)
      if (!assistantText.trim()) throw new BadRequestException('remote_agent_empty_response')
      const result = extractJsonPayload(assistantText)
      const raw = toRecord(body)
      return {
        result,
        remoteRunId: String(raw.id || `${input.taskType}:${Date.now()}`),
        usage: toRecord(raw.usage),
        warnings: [],
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'remote_agent_timeout'
        : error instanceof Error
          ? error.message
          : 'remote_agent_failed'
      throw new BadRequestException(message)
    } finally {
      clearTimeout(timer)
    }
  }

  async canExecute(userId: number) {
    if (this.buildExplicitConfig(userId)) return true
    try {
      await this.aiConfigResolver.resolveConfig('text', null, userId)
      return true
    } catch {
      return false
    }
  }

  private buildExplicitConfig(userId: number): AIConfig | null {
    const baseUrl = String(process.env.DRAMA_AGENT_BASE_URL || '').trim()
    const apiKey = String(process.env.DRAMA_AGENT_API_KEY || '').trim()
    const model = String(process.env.DRAMA_AGENT_MODEL || '').trim()
    if (!baseUrl || !apiKey || !model) return null

    return {
      id: 0,
      userId,
      serviceType: 'text',
      provider: String(process.env.DRAMA_AGENT_PROVIDER || 'remote').trim() || 'remote',
      baseUrl,
      apiKey,
      model,
      modelList: [model],
      settings: {},
    }
  }

  private async resolveConfig(userId: number): Promise<AIConfig> {
    const explicitConfig = this.buildExplicitConfig(userId)
    if (explicitConfig) return explicitConfig

    const textConfig = await this.aiConfigResolver.resolveConfig('text', null, userId)
    return {
      ...textConfig,
      baseUrl: getTextProviderBaseUrl(textConfig),
    }
  }
}

@Injectable()
export class DramaAgentService {
  constructor(
    @Inject(RemoteDramaAgentAdapter) private readonly adapter: RemoteDramaAgentAdapter,
    @Inject(DramaAgentSchemaValidator) private readonly validator: DramaAgentSchemaValidator,
  ) {}

  async canExecute(userId: number) {
    return this.adapter.canExecute(userId)
  }

  isEnabled() {
    const provider = String(process.env.DRAMA_AGENT_PROVIDER || '').trim().toLowerCase()
    return provider === 'remote' || provider === 'text' || provider === 'ai_runtime'
  }

  async analyzeSourceChunk(input: {
    userId: number
    dramaId: number
    sourceId: number
    chunkId: number
    chunkNo: number
    contentHash: string
    content: string
    sourceTrace: Array<Record<string, unknown>>
  }) {
    const result = await this.adapter.executeJson({
      userId: input.userId,
      taskType: 'source_chunk_analyze',
      outputSchemaName: 'SourceChunkAnalysis',
      idempotencyKey: `drama:${input.dramaId}:source:${input.sourceId}:chunk:${input.chunkNo}:${input.contentHash}:analyze`,
      systemPrompt: buildSystemPrompt('SourceChunkAnalysis'),
      userPrompt: [
        `source_id：${input.sourceId}`,
        `chunk_id：${input.chunkId}`,
        `chunk_no：${input.chunkNo}`,
        `source_trace：${JSON.stringify(input.sourceTrace)}`,
        '请只分析当前分块，输出 {"source_chunk_analysis":{summary,key_events,characters,scenes,risks,source_trace}}。',
        `分块正文：\n${input.content}`,
      ].join('\n\n'),
    })
    return {
      ...result,
      chunkAnalysis: this.validator.validateSourceChunkAnalysis(result.result),
    }
  }

  async analyzeSource(input: {
    userId: number
    dramaId: number
    dramaTitle: string
    sourceId: number
    content: string
    health: SourceHealthLike
  }) {
    const result = await this.adapter.executeJson({
      userId: input.userId,
      taskType: 'source_global_summarize',
      outputSchemaName: 'SourceAnalysis',
      idempotencyKey: `drama:${input.dramaId}:source:${input.sourceId}:analysis:${input.health.estimated_tokens}`,
      systemPrompt: buildSystemPrompt('SourceAnalysis'),
      userPrompt: [
        `短剧项目：${input.dramaTitle}`,
        `源稿健康：${JSON.stringify(input.health)}`,
        '请输出 {"source_analysis":{theme,core_conflict,protagonist,antagonist,protagonist_goal,relationship_map,world_rules,emotional_curve,adaptation_risks,evidence}} JSON。',
        'evidence 必须是数组；每一项必须包含 claim 和 source_trace 数组。不要使用 Markdown，不要使用中文字段名替代上述字段。',
        formatSourceForAgent(input.content, input.health),
      ].join('\n\n'),
    })
    return {
      ...result,
      analysis: this.validator.validateSourceAnalysis(result.result),
    }
  }

  async analyzeSourceFromChunks(input: {
    userId: number
    dramaId: number
    dramaTitle: string
    sourceId: number
    health: SourceHealthLike
    chunkAnalyses: Array<SourceChunkAnalysisLike & { chunk_id?: number | string | null; chunk_no?: number }>
  }) {
    const result = await this.adapter.executeJson({
      userId: input.userId,
      taskType: 'source_global_summarize',
      outputSchemaName: 'SourceAnalysis',
      idempotencyKey: `drama:${input.dramaId}:source:${input.sourceId}:analysis:chunks:${input.chunkAnalyses.length}`,
      systemPrompt: buildSystemPrompt('SourceAnalysis'),
      userPrompt: [
        `短剧项目：${input.dramaTitle}`,
        `source_id：${input.sourceId}`,
        `源稿健康：${JSON.stringify(input.health)}`,
        '以下是 chunk 级理解结果。只能基于这些摘要、章节索引和 source_trace 合成全局 source_analysis，不要编造未出现的原文。',
        JSON.stringify({ chunk_analyses: input.chunkAnalyses }),
        '请输出 {"source_analysis":{theme,core_conflict,protagonist,antagonist,protagonist_goal,relationship_map,world_rules,emotional_curve,adaptation_risks,evidence}} JSON。',
      ].join('\n\n'),
    })
    return {
      ...result,
      analysis: this.validator.validateSourceAnalysis(result.result),
    }
  }

  async generateAdaptationBriefs(input: {
    userId: number
    dramaId: number
    dramaTitle: string
    analysis: SourceAnalysisLike
    health: SourceHealthLike
    count: number
    targetEpisodeCount?: number | null
    episodeDuration?: string | null
    styleDirection?: string | null
  }) {
    const result = await this.adapter.executeJson({
      userId: input.userId,
      taskType: 'adaptation_brief_generate',
      outputSchemaName: 'AdaptationBrief[]',
      idempotencyKey: `drama:${input.dramaId}:brief:${input.count}:${input.targetEpisodeCount || 'auto'}`,
      systemPrompt: buildSystemPrompt('AdaptationBrief[]'),
      userPrompt: [
        `短剧项目：${input.dramaTitle}`,
        `要求生成 ${input.count} 套可比较改编策略。`,
        `目标集数：${input.targetEpisodeCount || '由你建议'}`,
        `单集时长：${input.episodeDuration || '60-90 秒'}`,
        `风格方向：${input.styleDirection || '跟随项目风格'}`,
        `源稿健康：${JSON.stringify(input.health)}`,
        `源稿理解：${JSON.stringify(input.analysis)}`,
        '请输出 {"adaptation_briefs":[...]} JSON。',
        '数组每项必须包含英文 snake_case 字段：id,name,claim,rhythm_model,target_episode_count,episode_duration,style_direction,hook_density,retained_points,removed_points,risk_notes,production_cost,recommended_for。',
        'retained_points、removed_points、risk_notes 必须是字符串数组；target_episode_count 必须是数字。',
      ].join('\n\n'),
    })
    return {
      ...result,
      briefs: this.validator.validateAdaptationBriefs(result.result, Math.min(2, input.count)),
    }
  }

  async generateEpisodeBlueprints(input: {
    userId: number
    dramaId: number
    sourceId: number
    analysis: SourceAnalysisLike
    health: SourceHealthLike
    brief: AdaptationBriefLike
  }) {
    const result = await this.adapter.executeJson({
      userId: input.userId,
      taskType: 'episode_blueprint_generate',
      outputSchemaName: 'EpisodeBlueprint[]',
      idempotencyKey: `drama:${input.dramaId}:brief:${input.brief.id}:blueprint`,
      systemPrompt: buildSystemPrompt('EpisodeBlueprint[]'),
      userPrompt: [
        `source_id：${input.sourceId}`,
        `源稿健康：${JSON.stringify(input.health)}`,
        `源稿理解：${JSON.stringify(input.analysis)}`,
        `选中策略：${JSON.stringify(input.brief)}`,
        '请输出 {"episode_blueprints":[...]} JSON。每集必须包含 source_trace，且 episode_number 从 1 连续递增。',
        '数组每项必须包含英文 snake_case 字段：episode_number,title,positioning,opening_hook,summary,source_trace,characters,scenes,ending_hook,risk_notes,brief_id。',
        'characters、scenes、risk_notes 必须是字符串数组；source_trace 必须是数组；不要用中文字段名替代。',
      ].join('\n\n'),
    })
    return {
      ...result,
      blueprints: this.validator.validateEpisodeBlueprints(result.result),
    }
  }

  async generateSingleEpisodeBlueprint(input: {
    userId: number
    dramaId: number
    episodeId: number
    episodeNumber: number
    sourceId: number
    analysis: SourceAnalysisLike
    health: SourceHealthLike
    brief: AdaptationBriefLike
    previousBlueprint: EpisodeBlueprintLike | null
  }) {
    const result = await this.adapter.executeJson({
      userId: input.userId,
      taskType: 'episode_blueprint_generate',
      outputSchemaName: 'EpisodeBlueprint[]',
      idempotencyKey: `episode:${input.episodeId}:blueprint:${input.brief.id}:regenerate:${Date.now()}`,
      systemPrompt: buildSystemPrompt('EpisodeBlueprint[]'),
      userPrompt: [
        `短剧项目 ID：${input.dramaId}`,
        `分集 ID：${input.episodeId}`,
        `目标集数：第 ${input.episodeNumber} 集`,
        `source_id：${input.sourceId}`,
        `源稿健康：${JSON.stringify(input.health)}`,
        `源稿理解：${JSON.stringify(input.analysis)}`,
        `选中策略：${JSON.stringify(input.brief)}`,
        `当前蓝图：${JSON.stringify(input.previousBlueprint || {})}`,
        `请只重生第 ${input.episodeNumber} 集蓝图，输出 {"episode_blueprints":[...]} JSON。数组中只能有这一集，episode_number 必须等于 ${input.episodeNumber}，必须包含 source_trace，不要改写其他集。`,
        '数组每项必须包含英文 snake_case 字段：episode_number,title,positioning,opening_hook,summary,source_trace,characters,scenes,ending_hook,risk_notes,brief_id。',
        'characters、scenes、risk_notes 必须是字符串数组；source_trace 必须是数组；不要用中文字段名替代。',
      ].join('\n\n'),
    })
    const [blueprint] = this.validator.validateEpisodeBlueprints(result.result)
    if (!blueprint) throw new BadRequestException('episode_blueprint_required')
    return {
      ...result,
      blueprint: {
        ...blueprint,
        episode_number: input.episodeNumber,
        brief_id: blueprint.brief_id || input.brief.id,
      },
    }
  }

  async generateEpisodeScript(input: {
    userId: number
    dramaId: number
    episodeId: number
    brief: AdaptationBriefLike | null
    blueprint: EpisodeBlueprintLike | null
    sourceTrace: Array<Record<string, unknown>>
  }) {
    const result = await this.adapter.executeJson({
      userId: input.userId,
      taskType: 'episode_script_generate',
      outputSchemaName: 'EpisodeScript',
      idempotencyKey: `episode:${input.episodeId}:script:${input.blueprint?.brief_id || 'unknown'}`,
      systemPrompt: buildSystemPrompt('EpisodeScript'),
      userPrompt: [
        `短剧项目 ID：${input.dramaId}`,
        `分集 ID：${input.episodeId}`,
        `选中策略：${JSON.stringify(input.brief || {})}`,
        `分集蓝图：${JSON.stringify(input.blueprint || {})}`,
        `原文追溯：${JSON.stringify(input.sourceTrace || [])}`,
        '请输出 {"script_content":"..."} JSON。正文应为可直接进入短剧工作台的中文分集剧本，必须遵守选中策略，并只基于分集蓝图与原文追溯扩写，不要编造未出现的主线事实。',
      ].join('\n\n'),
    })
    return {
      ...result,
      scriptContent: this.validator.validateEpisodeScript(result.result),
    }
  }
}

function buildSystemPrompt(schemaName: string) {
  return [
    '你是短剧 AI-first 改编远程执行器。',
    '你只能返回严格 JSON，不要 Markdown，不要解释。',
    '本地后端负责权限、幂等、状态推进和最终写库；你只返回结构化结果。',
    `输出结构：${schemaName}`,
    '必须保留 source_trace 或可追溯证据；无法确定时返回 warnings 字段，但不要编造事实。',
  ].join('\n')
}

function formatSourceForAgent(content: string, health: SourceHealthLike) {
  if (!health.over_context_limit) {
    return `源稿全文：\n${content}`
  }

  const chapters = (health.chapter_index || [])
    .slice(0, 80)
    .map((chapter) => `- ${chapter.chapter_no}. ${chapter.title}（${chapter.word_count}字）：${compactText(chapter.brief, 180)}`)
    .join('\n')
  const head = content.slice(0, 5000)
  const tail = content.slice(Math.max(0, content.length - 5000))
  return [
    '源稿为长篇，不能把全文塞进单次上下文。以下提供章节索引与首尾代表片段；后续应升级为 chunk 级远程任务。',
    `章节索引：\n${chapters}`,
    `开篇片段：\n${head}`,
    `结尾片段：\n${tail}`,
  ].join('\n\n')
}
