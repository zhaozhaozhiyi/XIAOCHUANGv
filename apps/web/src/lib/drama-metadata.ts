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
