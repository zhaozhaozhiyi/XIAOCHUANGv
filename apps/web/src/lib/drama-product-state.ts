import { getAdaptationPlan, getNovelSource, type NovelSource } from '@/lib/drama-metadata'
import type { Drama } from '@/types/api'

type DramaOverviewRecord = Pick<Drama, 'metadata' | 'episode_count' | 'episodes' | 'total_episodes' | 'script_progress_percent'>

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

export function getNovelSourceHealth(source: NovelSource | null | undefined): NovelSourceHealth {
  if (!source) {
    return {
      kind: 'missing',
      ok: false,
      message: '还没有导入可用于改编的小说原稿。',
    }
  }

  const content = normalizeSourceContent(source.content)
  if (!content) {
    return {
      kind: 'empty',
      ok: false,
      message: '当前原稿内容为空，请重新导入完整正文。',
    }
  }

  if (looksLikeApiEnvelope(content)) {
    return {
      kind: 'api-envelope',
      ok: false,
      message: '当前原稿内容看起来像接口返回结果，不是可改编的小说正文，请重新导入。',
    }
  }

  if (looksLikeHtmlPage(content)) {
    return {
      kind: 'html-page',
      ok: false,
      message: '当前原稿内容看起来像网页片段，不是可改编的小说正文，请重新导入。',
    }
  }

  return {
    kind: 'valid',
    ok: true,
    message: '',
  }
}

export function getNovelSourceHealthByDrama(drama: Pick<Drama, 'metadata'> | null | undefined) {
  return getNovelSourceHealth(getNovelSource(drama))
}

export function getDramaEpisodeCount(drama: DramaOverviewRecord | null | undefined) {
  if (!drama) return 0

  const episodeCount = drama.episode_count ?? drama.episodes?.length ?? 0
  if (episodeCount > 0) return episodeCount

  if ((drama.total_episodes ?? 0) > 0) return drama.total_episodes

  return getAdaptationPlan(drama)?.target_episode_count ?? 0
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
  const sourceHealth = getNovelSourceHealthByDrama(drama)
  const adaptationPlan = getAdaptationPlan(drama)
  const scriptedEpisodes = (drama.episodes || []).filter((episode) => String(episode.script_content || '').trim()).length

  let progress = 0
  if (sourceHealth.ok) progress = 25
  if (sourceHealth.ok && adaptationPlan) progress = 55
  if (episodeCount > 0) progress = 70

  if (episodeCount > 0) {
    const scriptRatio = drama.script_progress_percent != null
      ? Math.max(0, Math.min(1, drama.script_progress_percent / 100))
      : scriptedEpisodes / Math.max(episodeCount, 1)
    progress = Math.max(progress, 70 + scriptRatio * 30)
  }

  return clampProgress(progress)
}
