import type { AIConfig } from './audio.providers.types'

export type DialogueVoiceCapabilities = {
  supportedLanguageTags: string[]
  voiceLanguageMap: Record<string, string[]>
  supportsStreamPreview: boolean
  providesWordTimings: boolean
}

function normalizeLanguageTag(value: unknown) {
  const tag = String(value || '').trim()
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag)) return null
  const [primary, ...subtags] = tag.split('-')
  return [
    primary.toLowerCase(),
    ...subtags.map((subtag) =>
      subtag.length === 2 || /^\d{3}$/.test(subtag)
        ? subtag.toUpperCase()
        : subtag,
    ),
  ].join('-')
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function capabilityTags(value: unknown) {
  return Array.from(
    new Set(
      stringArray(value)
        .map((tag) => (tag === '*' ? '*' : normalizeLanguageTag(tag)))
        .filter((tag): tag is string => Boolean(tag)),
    ),
  )
}

function voiceLanguageMap(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, string[]>
  >((result, [voiceId, tags]) => {
    const normalizedVoiceId = voiceId.trim().toLowerCase()
    const normalizedTags = capabilityTags(tags)
    if (normalizedVoiceId && normalizedTags.length) {
      result[normalizedVoiceId] = normalizedTags
    }
    return result
  }, {})
}

function setting(config: AIConfig, snakeCase: string, camelCase: string) {
  return config.settings?.[snakeCase] ?? config.settings?.[camelCase]
}

export function getDialogueVoiceCapabilities(
  config: AIConfig,
): DialogueVoiceCapabilities {
  const configuredLanguages = capabilityTags(
    setting(config, 'supported_language_tags', 'supportedLanguageTags'),
  )
  const configuredVoiceMap = voiceLanguageMap(
    setting(config, 'voice_language_map', 'voiceLanguageMap'),
  )
  const defaultLanguages =
    config.provider === 'volcengine' ? ['zh-CN'] : []

  return {
    supportedLanguageTags: configuredLanguages.length
      ? configuredLanguages
      : defaultLanguages,
    voiceLanguageMap: configuredVoiceMap,
    supportsStreamPreview:
      setting(config, 'supports_stream_preview', 'supportsStreamPreview') === true,
    providesWordTimings:
      setting(config, 'provides_word_timings', 'providesWordTimings') === true,
  }
}

function matchesLanguageTag(languageTag: string, supportedTag: string) {
  if (supportedTag === '*') return true
  if (languageTag === supportedTag) return true
  return !supportedTag.includes('-') &&
    languageTag.startsWith(`${supportedTag}-`)
}

export function assertDialogueVoiceLanguageSupported(args: {
  config: AIConfig
  voiceId: string
  languageTag: string
}) {
  const languageTag = normalizeLanguageTag(args.languageTag)
  if (!languageTag) throw new Error('voice_language_unsupported')

  const capabilities = getDialogueVoiceCapabilities(args.config)
  const voiceTags =
    capabilities.voiceLanguageMap[String(args.voiceId || '').trim().toLowerCase()]
  const supportedTags = voiceTags ?? capabilities.supportedLanguageTags
  if (!supportedTags.some((tag) => matchesLanguageTag(languageTag, tag))) {
    throw new Error('voice_language_unsupported')
  }

  return {
    languageTag,
    capabilities,
  }
}
