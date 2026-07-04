import type { Drama, Episode } from '@/types/api'

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
