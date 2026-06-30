type ProjectDefaultsRecord = {
  image_config_id: number | null
  video_config_id: number | null
  audio_config_id: number | null
  lead_character_name: string | null
  lead_character_description: string | null
  lead_voice_id: string | null
  voice_notes: string | null
}

export type ProjectDefaultConfigType = 'image' | 'video' | 'audio'

export const EMPTY_PROJECT_DEFAULTS: ProjectDefaultsRecord = {
  image_config_id: null,
  video_config_id: null,
  audio_config_id: null,
  lead_character_name: null,
  lead_character_description: null,
  lead_voice_id: null,
  voice_notes: null,
}

function parseJsonObject(value: string | null | undefined) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
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

function toOptionalString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function parseDramaMetadata(value: string | null | undefined) {
  return parseJsonObject(value)
}

export function readProjectDefaults(value: string | null | undefined): ProjectDefaultsRecord {
  const metadata = parseDramaMetadata(value)
  const projectDefaults = metadata.project_defaults
  const raw = projectDefaults && typeof projectDefaults === 'object' && !Array.isArray(projectDefaults)
    ? projectDefaults as Record<string, unknown>
    : {}

  return {
    image_config_id: toOptionalNumber(raw.image_config_id),
    video_config_id: toOptionalNumber(raw.video_config_id),
    audio_config_id: toOptionalNumber(raw.audio_config_id),
    lead_character_name: toOptionalString(raw.lead_character_name),
    lead_character_description: toOptionalString(raw.lead_character_description),
    lead_voice_id: toOptionalString(raw.lead_voice_id),
    voice_notes: toOptionalString(raw.voice_notes),
  }
}

export function withProjectDefaults(
  value: string | null | undefined,
  defaults: Partial<ProjectDefaultsRecord>,
) {
  const metadata = parseDramaMetadata(value)
  const current = readProjectDefaults(value)
  return {
    ...metadata,
    project_defaults: {
      ...current,
      ...defaults,
    },
  }
}

export function resolveProjectConfigId(
  value: string | null | undefined,
  configType: ProjectDefaultConfigType,
) {
  const defaults = readProjectDefaults(value)
  if (configType === 'image') return defaults.image_config_id
  if (configType === 'video') return defaults.video_config_id
  return defaults.audio_config_id
}
