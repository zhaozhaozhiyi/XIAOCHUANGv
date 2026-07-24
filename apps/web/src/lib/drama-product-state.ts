import {
  getAdaptationPlan,
  getDramaAiFirstMetadata,
  getNovelSource,
  normalizeEpisodeBlueprintPayload,
  type NovelSource,
} from '@/lib/drama-metadata'
import type { Drama, DramaAiFirstStage } from '@/types/api'
import type { SourceHealth } from '@/types/api'

type DramaOverviewRecord = Pick<Drama, 'metadata' | 'episode_count' | 'episodes' | 'total_episodes' | 'script_progress_percent'>
  & Partial<Pick<Drama, 'source_health' | 'source_analysis' | 'adaptation_briefs' | 'selected_brief_id' | 'ai_first_stage'>>

const LONG_SOURCE_TOKEN_LIMIT = 60000

export type NovelSourceHealthKind =
  | 'missing'
  | 'valid'
  | 'empty'
  | 'api-envelope'
  | 'html-page'

export type NovelSourceHealth = {
  kind: NovelSourceHealthKind
  ok: boolean
  message: string
  word_count: number
  chapter_count: number
  estimated_tokens: number
  over_context_limit: boolean
  chunk_count: number
  recommended_mode: SourceHealth['recommended_mode']
}

function normalizeSourceContent(content: string) {
  return content.trim()
}

function looksLikeApiEnvelope(content: string) {
  const normalized = normalizeSourceContent(content)
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) return false
  return /"code"\s*:/.test(normalized) && /"message"\s*:/.test(normalized) && /"data"\s*:/.test(normalized)
}

function looksLikeHtmlPage(content: string) {
  const normalized = normalizeSourceContent(content).toLowerCase()
  return normalized.startsWith('<!doctype') || normalized.startsWith('<html') || normalized.startsWith('<body')
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function isStaleEpisodeGenerationMode(generationMode: string | null | undefined) {
  return /_(?:source|analysis|strategy|blueprint)_stale(?:_|$)/.test(String(generationMode || ''))
}

function hasCurrentScript(episode: NonNullable<DramaOverviewRecord['episodes']>[number]) {
  return Boolean(String(episode.script_content || '').trim())
    && !isStaleEpisodeGenerationMode(episode.generation_mode)
}

function estimateTokens(source: NovelSource) {
  return Math.ceil(Math.max(source.word_count || source.content.replace(/\s/g, '').length, 0) * 1.6)
}

function baseHealth(
  kind: NovelSourceHealthKind,
  ok: boolean,
  message: string,
  source?: NovelSource | null,
): NovelSourceHealth {
  const wordCount = source?.word_count ?? 0
  const chapterCount = source?.chapter_count ?? source?.chapter_index?.length ?? 0
  const estimatedTokens = source ? estimateTokens(source) : 0
  const overContextLimit = estimatedTokens > LONG_SOURCE_TOKEN_LIMIT
  return {
    kind,
    ok,
    message,
    word_count: wordCount,
    chapter_count: chapterCount,
    estimated_tokens: estimatedTokens,
    over_context_limit: overContextLimit,
    chunk_count: overContextLimit ? Math.max(1, Math.ceil(estimatedTokens / LONG_SOURCE_TOKEN_LIMIT)) : 0,
    recommended_mode: overContextLimit ? 'long_source' : 'direct',
  }
}

export function getNovelSourceHealth(source: NovelSource | null | undefined): NovelSourceHealth {
  if (!source) {
    return baseHealth('missing', false, '还没有导入可用于改编的小说原稿。')
  }

  const content = normalizeSourceContent(source.content)
  if (!content) {
    return baseHealth('empty', false, '当前原稿内容为空，请重新导入完整正文。', source)
  }

  if (looksLikeApiEnvelope(content)) {
    return baseHealth('api-envelope', false, '当前原稿内容看起来像接口返回结果，不是可改编的小说正文，请重新导入。', source)
  }

  if (looksLikeHtmlPage(content)) {
    return baseHealth('html-page', false, '当前原稿内容看起来像网页片段，不是可改编的小说正文，请重新导入。', source)
  }

  return baseHealth('valid', true, '', source)
}

export function getNovelSourceHealthByDrama(drama: Pick<Drama, 'metadata'> | null | undefined) {
  return getNovelSourceHealth(getNovelSource(drama))
}

export function getDramaEpisodeCount(drama: DramaOverviewRecord | null | undefined) {
  if (!drama) return 0

  const episodeCount = drama.episode_count ?? drama.episodes?.length ?? 0
  if (episodeCount > 0) return episodeCount

  if ((drama.total_episodes ?? 0) > 0) return drama.total_episodes

  return 0
}

export function getDramaAspectRatioLabel(drama: Pick<Drama, 'metadata'> | null | undefined) {
  const aspectRhythm = getAdaptationPlan(drama)?.aspect_rhythm || ''
  const directMatch = aspectRhythm.match(/\d+\s*:\s*\d+/)?.[0]
  if (directMatch) return directMatch.replace(/\s+/g, '')

  const leadingToken = aspectRhythm.split('·')[0]?.trim()
  return leadingToken || '16:9'
}

export function getDramaProjectProgress(drama: DramaOverviewRecord | null | undefined) {
  if (!drama) return 0

  const episodeCount = getDramaEpisodeCount(drama)
  const aiFirst = getDramaAiFirstMetadata(drama)
  const sourceHealth = aiFirst.source_health
    ? {
      ok: aiFirst.source_health.status !== 'blocked',
    }
    : getNovelSourceHealthByDrama(drama)
  const scriptedEpisodes = (drama.episodes || []).filter(hasCurrentScript).length
  const blueprintEpisodes = (drama.episodes || []).filter((episode) => normalizeEpisodeBlueprintPayload(episode.blueprint_payload)).length

  let progress = 0
  if (sourceHealth.ok) progress = 25
  if (sourceHealth.ok && aiFirst.source_analysis) progress = 45
  if (blueprintEpisodes > 0) progress = 62
  if (episodeCount > 0 && scriptedEpisodes > 0) progress = 72
  if (['graph_ready', 'in_production', 'deliverable_ready'].includes(aiFirst.ai_first_stage || '')) progress = 86

  if (episodeCount > 0) {
    const scriptRatio = drama.episodes?.length
      ? scriptedEpisodes / Math.max(episodeCount, 1)
      : drama.script_progress_percent != null
      ? Math.max(0, Math.min(1, drama.script_progress_percent / 100))
      : scriptedEpisodes / Math.max(episodeCount, 1)
    progress = Math.max(progress, 55 + scriptRatio * 30)
  }

  return clampProgress(progress)
}

export type DramaAiFirstComputedState = {
  stage: DramaAiFirstStage
  label: string
  nextActionLabel: string
  progress: number
  blockers: string[]
  sourceHealth: NovelSourceHealth
  legacyPlanOnly: boolean
  blueprintCount: number
  scriptReadyCount: number
}

function normalizeLegacyStage(stage: DramaAiFirstStage): DramaAiFirstStage {
  if (stage === 'brief_pending' || stage === 'brief_selected') return 'script_generating'
  if (stage === 'blueprint_generating' || stage === 'blueprint_ready') return 'script_generating'
  return stage
}

function describeStage(stage: DramaAiFirstStage) {
  switch (stage) {
    case 'source_pending':
      return { label: '待导入源稿', nextActionLabel: '导入源稿' }
    case 'source_ready':
      return { label: '待理解源稿', nextActionLabel: '生成源稿理解' }
    case 'brief_pending':
    case 'brief_selected':
    case 'blueprint_generating':
      return { label: '正在生成分集规划', nextActionLabel: '查看分集规划进度' }
    case 'blueprint_ready':
      return { label: '分集规划已完成', nextActionLabel: '开始生成剧本正文' }
    case 'script_generating':
      return { label: '正在生成剧本正文', nextActionLabel: '查看剧本正文进度' }
    case 'script_ready':
      return { label: '剧本正文已完成', nextActionLabel: '构建故事地图' }
    case 'graph_building':
      return { label: '故事地图构建中', nextActionLabel: '查看构建进度' }
    case 'graph_ready':
      return { label: '故事地图已就绪', nextActionLabel: '开始分镜制作' }
    case 'in_production':
      return { label: '制作中', nextActionLabel: '继续制作' }
    case 'deliverable_ready':
      return { label: '可导出', nextActionLabel: '查看导出' }
    default:
      return { label: '待导入源稿', nextActionLabel: '导入源稿' }
  }
}

export function getDramaAiFirstState(drama: DramaOverviewRecord | null | undefined): DramaAiFirstComputedState {
  const aiFirst = getDramaAiFirstMetadata(drama)
  const sourceHealth = aiFirst.source_health
    ? {
      kind: aiFirst.source_health.status === 'blocked' ? 'empty' : 'valid',
      ok: aiFirst.source_health.status !== 'blocked',
      message: aiFirst.source_health.status === 'blocked' ? '当前源稿暂不可用于 AI 改编，请先修复源稿。' : '',
      word_count: aiFirst.source_health.word_count,
      chapter_count: aiFirst.source_health.chapter_count,
      estimated_tokens: aiFirst.source_health.estimated_tokens,
      over_context_limit: aiFirst.source_health.over_context_limit,
      chunk_count: aiFirst.source_health.chunk_count,
      recommended_mode: aiFirst.source_health.recommended_mode,
    } satisfies NovelSourceHealth
    : getNovelSourceHealthByDrama(drama)
  const episodes = drama?.episodes || []
  const episodeCount = getDramaEpisodeCount(drama)
  const blueprintCount = episodes.filter((episode) => normalizeEpisodeBlueprintPayload(episode.blueprint_payload) || episode.status === 'blueprint').length
  const scriptReadyCount = episodes.filter((episode) =>
    hasCurrentScript(episode)
    || (episode.status === 'script_ready' && !isStaleEpisodeGenerationMode(episode.generation_mode)),
  ).length
  const legacyPlanOnly = Boolean(getAdaptationPlan(drama)) && !aiFirst.source_analysis && aiFirst.adaptation_briefs.length === 0 && blueprintCount === 0

  let stage: DramaAiFirstStage = normalizeLegacyStage(aiFirst.ai_first_stage || 'source_pending')
  if (!aiFirst.ai_first_stage) {
    if (!sourceHealth.ok) {
      stage = 'source_pending'
    } else if (!aiFirst.source_analysis) {
      stage = 'source_ready'
    } else if (scriptReadyCount === 0) {
      stage = 'script_generating'
    } else {
      stage = 'script_ready'
    }
  }
  if (
    episodes.length > 0
    && episodeCount > 0
    && scriptReadyCount < episodeCount
    && ['script_ready', 'graph_building', 'graph_ready', 'in_production', 'deliverable_ready'].includes(stage)
  ) {
    stage = 'script_generating'
  }

  const blockers = [
    !sourceHealth.ok ? sourceHealth.message : null,
    sourceHealth.over_context_limit ? `长篇源稿：AI 会自动分段理解并汇总全书主线` : null,
    legacyPlanOnly ? '存在旧方案草稿，需迁移或重新生成 AI 策略' : null,
  ].filter(Boolean) as string[]
  const description = describeStage(stage)

  return {
    stage,
    label: description.label,
    nextActionLabel: description.nextActionLabel,
    progress: getDramaProjectProgress(drama),
    blockers,
    sourceHealth,
    legacyPlanOnly,
    blueprintCount,
    scriptReadyCount,
  }
}
