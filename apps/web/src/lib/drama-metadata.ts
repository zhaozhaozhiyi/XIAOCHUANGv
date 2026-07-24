import type {
  AdaptationBrief,
  Drama,
  DramaAiFirstStage,
  Episode,
  EpisodeBlueprintPayload,
  SourceAnalysis,
  SourceHealth,
  SourceTraceItem,
} from '@/types/api'

export type ProjectDefaultConfigType = 'image' | 'video' | 'audio'

export type ProjectDefaults = {
  image_config_id: number | null
  video_config_id: number | null
  audio_config_id: number | null
  lead_character_name: string
  lead_character_description: string
  lead_voice_id: string
  voice_notes: string
}

export type NovelSourceChapter = {
  chapter_no: number
  title: string
  word_count: number
  brief: string
}

export type NovelSource = {
  type: 'paste' | 'upload' | 'writing_project'
  title: string
  content: string
  word_count: number
  chapter_count: number
  imported_at: string
  summary?: string
  chapter_index?: NovelSourceChapter[]
}

export type DramaAiFirstMetadata = {
  source_health: SourceHealth | null
  source_analysis: SourceAnalysis | null
  adaptation_config: AdaptationConfig | null
  adaptation_briefs: AdaptationBrief[]
  selected_brief_id: string
  ai_first_stage: DramaAiFirstStage | null
  ai_first_updated_at: string
}

export type AdaptationConfig = {
  target_episode_count: number
  episode_duration: string
  style_direction: string
  visual_style: string
  aspect_rhythm: string
}

export type AdaptationPlan = {
  status: 'draft' | 'confirmed'
  target_episode_count: number
  episode_duration: string
  logline: string
  tone: string
  main_plot: string
  character_bible: Array<{
    name: string
    role: string
    description: string
    appearance: string
    personality: string
    arc: string
    voice_hint: string
    image_prompt: string
    image_url?: string
  }>
  scene_bible: Array<{
    name: string
    location: string
    time_hint: string
    visual_prompt: string
    image_prompt: string
    image_url?: string
    reuse_level: 'high' | 'medium' | 'low'
  }>
  visual_style: string
  aspect_rhythm: string
  episode_outlines: Array<{
    episode_number: number
    title: string
    source_range: string
    hook: string
    key_beats: string[]
    ending_hook: string
    characters: string[]
    scenes: string[]
  }>
  generated_at: string
  source_imported_at?: string
}

export const EMPTY_PROJECT_DEFAULTS: ProjectDefaults = {
  image_config_id: null,
  video_config_id: null,
  audio_config_id: null,
  lead_character_name: '',
  lead_character_description: '',
  lead_voice_id: '',
  voice_notes: '',
}

function parseMetadata(metadata: string | null | undefined) {
  if (!metadata) return {} as Record<string, unknown>
  try {
    const parsed = JSON.parse(metadata) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function toOptionalNumber(value: unknown) {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function toRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseMaybeJsonObject(value: unknown) {
  if (typeof value === 'string') {
    try {
      return toRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  return toRecord(value)
}

function parseMaybeJsonArray(value: unknown) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? value : []
}

function toBooleanValue(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value === 'true' || value === '1'
  return false
}

function normalizeAiFirstStage(value: unknown): DramaAiFirstStage | null {
  const stage = toStringValue(value)
  if (
    stage === 'source_pending' ||
    stage === 'source_ready' ||
    stage === 'brief_pending' ||
    stage === 'brief_selected' ||
    stage === 'blueprint_generating' ||
    stage === 'blueprint_ready' ||
    stage === 'script_generating' ||
    stage === 'script_ready' ||
    stage === 'graph_building' ||
    stage === 'graph_ready' ||
    stage === 'in_production' ||
    stage === 'deliverable_ready'
  ) {
    return stage
  }
  return null
}

function normalizeSourceTrace(value: unknown): SourceTraceItem[] {
  return parseMaybeJsonArray(value)
    .map((item) => {
      const trace = toRecord(item) ?? {}
      return {
        source_id: toStringValue(trace.source_id) || toOptionalNumber(trace.source_id) || null,
        chunk_id: toStringValue(trace.chunk_id) || toOptionalNumber(trace.chunk_id) || null,
        chapter_no: toOptionalNumber(trace.chapter_no),
        chapter_title: toStringValue(trace.chapter_title),
        content_start: toOptionalNumber(trace.content_start),
        content_end: toOptionalNumber(trace.content_end),
        excerpt: toStringValue(trace.excerpt),
      }
    })
}

function normalizeSourceHealth(value: unknown): SourceHealth | null {
  const raw = parseMaybeJsonObject(value)
  if (!raw) return null
  const status = raw.status === 'blocked' || raw.status === 'warning' ? raw.status : 'ok'
  const wordCount = toOptionalNumber(raw.word_count) ?? 0
  const chapterIndex = Array.isArray(raw.chapter_index)
    ? raw.chapter_index.map((item, index) => {
      const chapter = toRecord(item) ?? {}
      return {
        chapter_no: toOptionalNumber(chapter.chapter_no) ?? index + 1,
        title: toStringValue(chapter.title) || `第 ${index + 1} 章`,
        word_count: toOptionalNumber(chapter.word_count) ?? 0,
        brief: toStringValue(chapter.brief),
      }
    })
    : []
  const estimatedTokens = toOptionalNumber(raw.estimated_tokens) ?? Math.ceil(Math.max(wordCount, 0) * 1.6)
  const overContextLimit = toBooleanValue(raw.over_context_limit)
  const recommendedMode: SourceHealth['recommended_mode'] =
    raw.recommended_mode === 'long_source_async'
      ? 'long_source_async'
      : raw.recommended_mode === 'long_source' || overContextLimit
        ? 'long_source'
        : 'direct'
  return {
    status,
    word_count: wordCount,
    chapter_count: toOptionalNumber(raw.chapter_count) ?? chapterIndex.length,
    estimated_tokens: estimatedTokens,
    over_context_limit: overContextLimit,
    chunk_count: toOptionalNumber(raw.chunk_count) ?? (recommendedMode !== 'direct' ? Math.max(1, Math.ceil(estimatedTokens / 60000)) : 0),
    recommended_mode: recommendedMode,
    chapter_index: chapterIndex,
    anomalies: Array.isArray(raw.anomalies)
      ? raw.anomalies.map((item) => {
        const anomaly = toRecord(item) ?? {}
        const severity: 'info' | 'warning' | 'blocked' = anomaly.severity === 'blocked' || anomaly.severity === 'warning' ? anomaly.severity : 'info'
        return {
          type: toStringValue(anomaly.type),
          severity,
          message: toStringValue(anomaly.message),
          evidence: toStringValue(anomaly.evidence),
        }
      }).filter((item) => item.message || item.type)
      : [],
    named_entity_density: toOptionalNumber(raw.named_entity_density),
    continuity_score: toOptionalNumber(raw.continuity_score),
    generated_at: toStringValue(raw.generated_at),
  }
}

function normalizeSourceAnalysis(value: unknown): SourceAnalysis | null {
  const raw = parseMaybeJsonObject(value)
  if (!raw) return null
  const theme = toStringValue(raw.theme)
  const coreConflict = toStringValue(raw.core_conflict)
  if (!theme && !coreConflict) return null
  return {
    theme,
    core_conflict: coreConflict,
    protagonist: toStringValue(raw.protagonist),
    antagonist: toStringValue(raw.antagonist),
    protagonist_goal: toStringValue(raw.protagonist_goal),
    target_episode_count: toOptionalNumber(raw.target_episode_count),
    episode_duration: toStringValue(raw.episode_duration),
    relationship_map: parseMaybeJsonArray(raw.relationship_map).map((item) => toRecord(item) ?? {}),
    world_rules: toStringArray(raw.world_rules),
    emotional_curve: parseMaybeJsonArray(raw.emotional_curve).map((item) => toRecord(item) ?? {}),
    adaptation_risks: toStringArray(raw.adaptation_risks),
    evidence: parseMaybeJsonArray(raw.evidence).map((item) => {
      const evidence = toRecord(item) ?? {}
      return {
        claim: toStringValue(evidence.claim),
        source_trace: normalizeSourceTrace(evidence.source_trace),
      }
    }).filter((item) => item.claim || item.source_trace?.length),
    ai_run_id: toStringValue(raw.ai_run_id) || toOptionalNumber(raw.ai_run_id),
    remote_run_id: toStringValue(raw.remote_run_id),
    generation_mode: toStringValue(raw.generation_mode),
    generated_at: toStringValue(raw.generated_at),
  }
}

function normalizeAdaptationBriefs(value: unknown): AdaptationBrief[] {
  return parseMaybeJsonArray(value).map((item, index) => {
    const brief = toRecord(item) ?? {}
    const id = toStringValue(brief.id) || `brief-${index + 1}`
    return {
      id,
      name: toStringValue(brief.name) || `策略 ${index + 1}`,
      claim: toStringValue(brief.claim),
      rhythm_model: toStringValue(brief.rhythm_model),
      target_episode_count: toOptionalNumber(brief.target_episode_count) ?? 0,
      episode_duration: toStringValue(brief.episode_duration),
      style_direction: toStringValue(brief.style_direction),
      hook_density: toStringValue(brief.hook_density) || toOptionalNumber(brief.hook_density),
      retained_points: toStringArray(brief.retained_points),
      removed_points: toStringArray(brief.removed_points),
      risk_notes: toStringArray(brief.risk_notes),
      production_cost: toStringValue(brief.production_cost) || toOptionalNumber(brief.production_cost),
      recommended_for: toStringValue(brief.recommended_for),
      ai_run_id: toStringValue(brief.ai_run_id) || toOptionalNumber(brief.ai_run_id),
      remote_run_id: toStringValue(brief.remote_run_id),
      generation_mode: toStringValue(brief.generation_mode),
      generated_at: toStringValue(brief.generated_at),
    }
  }).filter((item) => item.id && (item.claim || item.name))
}

function normalizeAdaptationConfig(value: unknown): AdaptationConfig | null {
  const raw = parseMaybeJsonObject(value)
  if (!raw) return null

  const targetEpisodeCount = toOptionalNumber(raw.target_episode_count) ?? 0
  const episodeDuration = toStringValue(raw.episode_duration)
  const styleDirection = toStringValue(raw.style_direction)
  const visualStyle = toStringValue(raw.visual_style)
  const aspectRhythm = toStringValue(raw.aspect_rhythm)

  if (!targetEpisodeCount && !episodeDuration && !styleDirection && !visualStyle && !aspectRhythm) return null

  return {
    target_episode_count: targetEpisodeCount,
    episode_duration: episodeDuration,
    style_direction: styleDirection,
    visual_style: visualStyle,
    aspect_rhythm: aspectRhythm,
  }
}

export function normalizeEpisodeBlueprintPayload(value: unknown): EpisodeBlueprintPayload | null {
  const raw = parseMaybeJsonObject(value)
  if (!raw) return null
  const title = toStringValue(raw.title)
  const summary = toStringValue(raw.summary)
  if (!title && !summary) return null
  return {
    episode_number: toOptionalNumber(raw.episode_number) ?? 0,
    title,
    positioning: toStringValue(raw.positioning),
    opening_hook: toStringValue(raw.opening_hook),
    summary,
    source_trace: normalizeSourceTrace(raw.source_trace),
    characters: toStringArray(raw.characters),
    scenes: toStringArray(raw.scenes),
    ending_hook: toStringValue(raw.ending_hook),
    risk_notes: toStringArray(raw.risk_notes),
    brief_id: toStringValue(raw.brief_id),
    ai_run_id: toStringValue(raw.ai_run_id) || toOptionalNumber(raw.ai_run_id),
    remote_run_id: toStringValue(raw.remote_run_id),
    generation_mode: toStringValue(raw.generation_mode),
    generated_at: toStringValue(raw.generated_at),
  }
}

function normalizeReuseLevel(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

export function getProjectDefaults(dramaOrMetadata: Pick<Drama, 'metadata'> | string | null | undefined): ProjectDefaults {
  const metadata = typeof dramaOrMetadata === 'string' || dramaOrMetadata == null
    ? parseMetadata(dramaOrMetadata)
    : parseMetadata(dramaOrMetadata.metadata)
  const raw = metadata.project_defaults
  const defaults = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}

  return {
    image_config_id: toOptionalNumber(defaults.image_config_id),
    video_config_id: toOptionalNumber(defaults.video_config_id),
    audio_config_id: toOptionalNumber(defaults.audio_config_id),
    lead_character_name: toStringValue(defaults.lead_character_name),
    lead_character_description: toStringValue(defaults.lead_character_description),
    lead_voice_id: toStringValue(defaults.lead_voice_id),
    voice_notes: toStringValue(defaults.voice_notes),
  }
}

export function getNovelSource(dramaOrMetadata: Pick<Drama, 'metadata'> | string | null | undefined): NovelSource | null {
  const metadata = typeof dramaOrMetadata === 'string' || dramaOrMetadata == null
    ? parseMetadata(dramaOrMetadata)
    : parseMetadata(dramaOrMetadata.metadata)
  const raw = metadata.novel_source
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const content = toStringValue(source.content)
  const title = toStringValue(source.title)
  if (!content && !title) return null
  const chapterIndex = Array.isArray(source.chapter_index)
    ? source.chapter_index.map((item, index) => {
      const chapter = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
      return {
        chapter_no: toOptionalNumber(chapter.chapter_no) ?? index + 1,
        title: toStringValue(chapter.title) || `第 ${index + 1} 章`,
        word_count: toOptionalNumber(chapter.word_count) ?? 0,
        brief: toStringValue(chapter.brief),
      }
    })
    : []

  return {
    type: source.type === 'upload' || source.type === 'writing_project' ? source.type : 'paste',
    title,
    content,
    word_count: toOptionalNumber(source.word_count) ?? content.replace(/\s/g, '').length,
    chapter_count: toOptionalNumber(source.chapter_count) ?? chapterIndex.length,
    imported_at: toStringValue(source.imported_at),
    summary: toStringValue(source.summary),
    chapter_index: chapterIndex,
  }
}

export function getAdaptationPlan(dramaOrMetadata: Pick<Drama, 'metadata'> | string | null | undefined): AdaptationPlan | null {
  const metadata = typeof dramaOrMetadata === 'string' || dramaOrMetadata == null
    ? parseMetadata(dramaOrMetadata)
    : parseMetadata(dramaOrMetadata.metadata)
  const raw = metadata.adaptation_plan
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const plan = raw as Record<string, unknown>
  const outlines = Array.isArray(plan.episode_outlines) ? plan.episode_outlines : []
  if (!outlines.length && !plan.logline && !plan.main_plot) return null

  return {
    status: plan.status === 'confirmed' ? 'confirmed' : 'draft',
    target_episode_count: toOptionalNumber(plan.target_episode_count) ?? outlines.length,
    episode_duration: toStringValue(plan.episode_duration) || '60-90 秒',
    logline: toStringValue(plan.logline),
    tone: toStringValue(plan.tone),
    main_plot: toStringValue(plan.main_plot),
    character_bible: Array.isArray(plan.character_bible)
      ? plan.character_bible.map((item) => {
        const character = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
        return {
          name: toStringValue(character.name),
          role: toStringValue(character.role),
          description: toStringValue(character.description),
          appearance: toStringValue(character.appearance),
          personality: toStringValue(character.personality),
          arc: toStringValue(character.arc),
          voice_hint: toStringValue(character.voice_hint),
          image_prompt: toStringValue(character.image_prompt),
          image_url: toStringValue(character.image_url),
        }
      }).filter((item) => item.name)
      : [],
    scene_bible: Array.isArray(plan.scene_bible)
      ? plan.scene_bible.map((item) => {
        const scene = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
        return {
          name: toStringValue(scene.name),
          location: toStringValue(scene.location),
          time_hint: toStringValue(scene.time_hint),
          visual_prompt: toStringValue(scene.visual_prompt),
          image_prompt: toStringValue(scene.image_prompt),
          image_url: toStringValue(scene.image_url),
          reuse_level: normalizeReuseLevel(scene.reuse_level),
        }
      }).filter((item) => item.name || item.location)
      : [],
    visual_style: toStringValue(plan.visual_style),
    aspect_rhythm: toStringValue(plan.aspect_rhythm) || '16:9 · 高密度钩子',
    episode_outlines: outlines.map((item, index) => {
      const episode = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
      return {
        episode_number: toOptionalNumber(episode.episode_number) ?? index + 1,
        title: toStringValue(episode.title) || `第 ${index + 1} 集`,
        source_range: toStringValue(episode.source_range),
        hook: toStringValue(episode.hook),
        key_beats: toStringArray(episode.key_beats),
        ending_hook: toStringValue(episode.ending_hook),
        characters: toStringArray(episode.characters),
        scenes: toStringArray(episode.scenes),
      }
    }),
    generated_at: toStringValue(plan.generated_at),
    source_imported_at: toStringValue(plan.source_imported_at),
  }
}

export function getDramaAiFirstMetadata(
  dramaOrMetadata: (Pick<Drama, 'metadata'> & Partial<Pick<Drama, 'source_health' | 'source_analysis' | 'adaptation_briefs' | 'selected_brief_id' | 'ai_first_stage'>>) | string | null | undefined,
): DramaAiFirstMetadata {
  const metadata = typeof dramaOrMetadata === 'string' || dramaOrMetadata == null
    ? parseMetadata(dramaOrMetadata)
    : parseMetadata(dramaOrMetadata.metadata)
  const carrier: Partial<Pick<Drama, 'source_health' | 'source_analysis' | 'adaptation_briefs' | 'selected_brief_id' | 'ai_first_stage'>> =
    typeof dramaOrMetadata === 'string' || dramaOrMetadata == null ? {} : dramaOrMetadata
  const aiFirst = toRecord(metadata.ai_first) ?? {}

  return {
    source_health: normalizeSourceHealth(carrier.source_health ?? aiFirst.source_health ?? metadata.source_health),
    source_analysis: normalizeSourceAnalysis(carrier.source_analysis ?? aiFirst.source_analysis ?? metadata.source_analysis),
    adaptation_config: normalizeAdaptationConfig(aiFirst.adaptation_config ?? metadata.adaptation_config),
    adaptation_briefs: normalizeAdaptationBriefs(carrier.adaptation_briefs ?? aiFirst.adaptation_briefs ?? metadata.adaptation_briefs),
    selected_brief_id: toStringValue(carrier.selected_brief_id ?? aiFirst.selected_brief_id ?? metadata.selected_brief_id),
    ai_first_stage: normalizeAiFirstStage(carrier.ai_first_stage ?? aiFirst.ai_first_stage ?? metadata.ai_first_stage),
    ai_first_updated_at: toStringValue(aiFirst.ai_first_updated_at ?? metadata.ai_first_updated_at),
  }
}

export function buildDramaMetadataWithProjectDefaults(
  existingMetadata: string | null | undefined,
  defaults: Partial<ProjectDefaults>,
) {
  const metadata = parseMetadata(existingMetadata)
  const currentDefaults = getProjectDefaults(existingMetadata)
  return {
    ...metadata,
    project_defaults: {
      ...currentDefaults,
      ...defaults,
    },
  }
}

export function buildDramaMetadataWithNovelSource(
  existingMetadata: string | null | undefined,
  source: NovelSource,
) {
  const metadata = parseMetadata(existingMetadata)
  return {
    ...metadata,
    novel_source: source,
    adaptation_plan: null,
  }
}

export function buildDramaMetadataWithAdaptationPlan(
  existingMetadata: string | null | undefined,
  plan: AdaptationPlan,
) {
  const metadata = parseMetadata(existingMetadata)
  return {
    ...metadata,
    adaptation_plan: plan,
  }
}

export function getEffectiveEpisodeConfigId(
  drama: Pick<Drama, 'metadata'> | null | undefined,
  episode: Pick<Episode, 'image_config_id' | 'video_config_id' | 'audio_config_id'> | null | undefined,
  type: ProjectDefaultConfigType,
) {
  const defaults = getProjectDefaults(drama)
  if (type === 'image') return episode?.image_config_id ?? defaults.image_config_id
  if (type === 'video') return episode?.video_config_id ?? defaults.video_config_id
  return episode?.audio_config_id ?? defaults.audio_config_id
}
