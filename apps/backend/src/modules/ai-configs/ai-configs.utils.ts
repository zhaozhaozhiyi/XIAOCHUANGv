import {
  AI_PROVIDER_CATALOG as SHARED_AI_PROVIDER_CATALOG,
  DEFAULT_VOLC_TTS_VOICE as SHARED_DEFAULT_VOLC_TTS_VOICE,
  XIAOCHUANG_PRESET_SERVICES,
} from '@xiaochuang/contracts'
import { readKlingSecretKey, signKlingJwt } from '../videos/kling-auth'
import { aiServiceConfigs } from '../../db/schema'

export const DEFAULT_VOLC_TTS_VOICE = SHARED_DEFAULT_VOLC_TTS_VOICE
export const AI_PROVIDER_CATALOG = SHARED_AI_PROVIDER_CATALOG
export const HUOBAO_PRESET_SERVICES = XIAOCHUANG_PRESET_SERVICES

export const HUOBAO_AGENT_DEFAULTS = [
  { agentType: 'script_rewriter', name: '剧本改写' },
  { agentType: 'extractor', name: '角色场景提取' },
  { agentType: 'storyboard_breaker', name: '分镜拆解' },
  { agentType: 'voice_assigner', name: '音色分配' },
  { agentType: 'grid_prompt_generator', name: '图片提示词生成' },
] as const

export const HUOBAO_AGENT_MODEL = 'gemini-3-pro-preview'

export interface VoiceCatalogItem {
  voiceId: string
  voiceName: string
  description: unknown[]
  language: string
  provider: string
}

type AIConfigRow = typeof aiServiceConfigs.$inferSelect

function bearerHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function geminiHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
    headers['x-goog-api-key'] = apiKey
  }
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function viduHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Token ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function normalizeSegment(segment: string) {
  if (!segment) return ''
  return segment.startsWith('/') ? segment : `/${segment}`
}

export function joinProviderUrl(baseUrl: string, requiredPrefix: string, path: string) {
  const normalizedBase = (baseUrl || '').replace(/\/+$/, '')
  const normalizedPrefix = normalizeSegment(requiredPrefix)
  const normalizedPath = normalizeSegment(path)

  if (!normalizedBase) {
    return `${normalizedPrefix}${normalizedPath}`
  }

  try {
    const url = new URL(normalizedBase)
    const currentPath = url.pathname.replace(/\/+$/, '')
    const mergedPrefix = currentPath.endsWith(normalizedPrefix)
      ? currentPath
      : `${currentPath}${normalizedPrefix}`

    url.pathname = `${mergedPrefix}${normalizedPath}`.replace(/\/{2,}/g, '/')
    return url.toString()
  } catch {
    const basePath = normalizedBase.endsWith(normalizedPrefix)
      ? normalizedBase
      : `${normalizedBase}${normalizedPrefix}`
    return `${basePath}${normalizedPath}`
  }
}

export function redactUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    for (const key of ['key', 'api_key', 'apikey', 'token', 'access_token']) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, '***')
      }
    }
    return url.toString()
  } catch {
    return rawUrl.replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&]+/gi, '$1***')
  }
}

export function buildProbe(
  serviceType: string,
  provider: string,
  baseUrl: string,
  model?: string,
  apiKey?: string,
  settings?: Record<string, unknown>,
) {
  const normalizedProvider = provider.toLowerCase()
  const normalizedModel = String(model || '').trim()

  if (normalizedProvider === 'gemini') {
    if (!normalizedModel) throw new Error('model is required')
    const url = new URL(joinProviderUrl(baseUrl, '/v1beta', `/models/${normalizedModel}:generateContent`))
    if (apiKey) url.searchParams.set('key', apiKey)
    return { method: 'POST', url: url.toString(), headers: geminiHeaders(apiKey, true), body: {} }
  }

  if (normalizedProvider === 'openai' || normalizedProvider === 'openrouter' || normalizedProvider === 'chatfire'
    || normalizedProvider === 'moonshot' || normalizedProvider === 'deepseek') {
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl, '/v1', '/models'),
      headers: bearerHeaders(apiKey),
      body: undefined,
    }
  }

  if (normalizedProvider === 'ali') {
    if (serviceType === 'text' && baseUrl.includes('compatible-mode')) {
      return {
        method: 'GET',
        url: joinProviderUrl(baseUrl, '', '/models'),
        headers: bearerHeaders(apiKey),
        body: undefined,
      }
    }

    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v1', serviceType === 'video'
        ? '/services/aigc/video-generation/video-synthesis'
        : '/services/aigc/image-generation/generation'),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (normalizedProvider === 'volcengine') {
    if (serviceType === 'audio') {
      return {
        method: 'GET',
        url: baseUrl,
        headers: bearerHeaders(apiKey),
        body: undefined,
      }
    }

    if (serviceType === 'text') {
      if (!normalizedModel) throw new Error('model is required')
      return {
        method: 'POST',
        url: joinProviderUrl(baseUrl, '/api/v3', '/chat/completions'),
        headers: bearerHeaders(apiKey, true),
        body: {
          model: normalizedModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        },
      }
    }

    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v3', serviceType === 'video' ? '/contents/generations/tasks' : '/images/generations'),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (normalizedProvider === 'minimax') {
    if (serviceType === 'text') {
      return {
        method: 'POST',
        url: joinProviderUrl(baseUrl, '/v1', '/text/chatcompletion_v2'),
        headers: bearerHeaders(apiKey, true),
        body: {
          model: normalizedModel || 'abab6.5s-chat',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        },
      }
    }

    const path = serviceType === 'audio'
      ? '/t2a_v2'
      : serviceType === 'video'
        ? '/video_generation'
        : '/image_generation'

    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/v1', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (normalizedProvider === 'kling') {
    const accessKey = String(apiKey || '').trim()
    const secretKey = readKlingSecretKey(settings)
    if (!accessKey || !secretKey) {
      throw new Error('Kling 测试需要 API Key（Access Key）与 settings.secretKey（Secret Key）')
    }
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl, '/v1', '/videos/image2video'),
      headers: {
        Authorization: `Bearer ${signKlingJwt(accessKey, secretKey)}`,
        'Content-Type': 'application/json',
      },
      body: undefined,
    }
  }

  if (normalizedProvider === 'vidu') {
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '', '/ent/v2/img2video'),
      headers: viduHeaders(apiKey, true),
      body: {},
    }
  }

  return {
    method: 'GET',
    url: joinProviderUrl(baseUrl, '', normalizedModel ? `/${normalizedModel}` : '/'),
    headers: bearerHeaders(apiKey),
    body: undefined,
  }
}

export function extractLanguage(voiceId: string, voiceName: string): string {
  const text = `${voiceId} ${voiceName}`.toLowerCase()
  if (text.includes('cantonese') || text.includes('粤')) return '粤语'
  if (text.includes('english') || text.includes('aussie')) return '英语'
  if (text.includes('japanese') || text.includes('日语')) return '日语'
  if (text.includes('korean') || text.includes('韩')) return '韩语'
  if (text.includes('spanish')) return '西班牙语'
  if (text.includes('portuguese')) return '葡萄牙语'
  if (text.includes('french')) return '法语'
  if (text.includes('indonesian')) return '印尼语'
  if (text.includes('german')) return '德语'
  if (text.includes('russian')) return '俄语'
  if (text.includes('italian')) return '意大利语'
  if (text.includes('arabic')) return '阿拉伯语'
  if (text.includes('turkish')) return '土耳其语'
  if (text.includes('ukrainian')) return '乌克兰语'
  if (text.includes('dutch')) return '荷兰语'
  if (text.includes('vietnamese')) return '越南语'
  if (text.includes('chinese') || text.includes('mandarin') || text.includes('中文')) return '中文'
  return '其他'
}

export function shouldKeepVoice(voice: { voice_id: string; voice_name: string }) {
  const language = extractLanguage(voice.voice_id, voice.voice_name)
  if (language !== '中文' && language !== '粤语') return false

  const text = `${voice.voice_id} ${voice.voice_name}`.toLowerCase()
  const excludedPatterns = [
    'jingpin',
    '-beta',
    'cartoon_pig',
    'cute_boy',
    'lovely_girl',
    'clever_boy',
    'robot_armor',
    'news_anchor',
    'male_announcer',
    'radio_host',
    'hk_flight_attendant',
  ]

  return !excludedPatterns.some((pattern) => text.includes(pattern))
}

function parseSettings(value: string | null) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function parseFirstModel(value: string | null) {
  if (!value) return ''
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? String(parsed[0] || '').trim() : String(parsed || '').trim()
  } catch {
    return String(value || '').trim()
  }
}

function configuredVolcVoice(config: AIConfigRow) {
  const settings = parseSettings(config.settings)
  const voice = String(settings.voice || process.env.VOLC_VOICE || parseFirstModel(config.model) || DEFAULT_VOLC_TTS_VOICE).trim()
  return voice || DEFAULT_VOLC_TTS_VOICE
}

export function defaultVolcVoiceForConfig(config: AIConfigRow | undefined | null): VoiceCatalogItem[] {
  if (!config) return []
  const voiceId = configuredVolcVoice(config)
  return [{
    voiceId,
    voiceName: voiceId === DEFAULT_VOLC_TTS_VOICE ? '火山国州的歌' : voiceId,
    description: ['中文', 'BigTTS'],
    language: '中文',
    provider: 'volcengine',
  }]
}

export function configuredVolcResourceId(config: AIConfigRow | undefined | null) {
  if (!config) return ''
  const settings = parseSettings(config.settings)
  return String(settings.resourceId || process.env.VOLC_RESOURCE_ID || 'volc.service_type.10029').trim()
}

export function isVolcVoiceCompatibleWithConfig(voiceId: string, config: AIConfigRow | undefined | null) {
  if (!config) return false
  const normalizedVoice = voiceId.trim().toLowerCase()
  if (!normalizedVoice) return false
  const resourceId = configuredVolcResourceId(config)
  if (resourceId === 'volc.service_type.10029') return normalizedVoice.endsWith('_bigtts')
  return true
}

export function parseVolcVoices(config: AIConfigRow): VoiceCatalogItem[] {
  const settings = parseSettings(config.settings)
  const configured = Array.isArray(settings.voices) ? settings.voices : []
  const envVoices = String(process.env.VOLC_VOICES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const rows = [...configured, ...envVoices].map((item) => {
    if (typeof item === 'object' && item && 'voiceId' in item) {
      const voice = item as { voiceId?: unknown; voiceName?: unknown; description?: unknown; language?: unknown }
      return {
        voiceId: String(voice.voiceId || '').trim(),
        voiceName: String(voice.voiceName || voice.voiceId || '').trim(),
        description: Array.isArray(voice.description) ? voice.description : [],
        language: String(voice.language || '中文').trim(),
        provider: 'volcengine',
      }
    }

    const [voiceId = '', voiceName = '', language = '中文'] = String(item).split('|').map((part) => part.trim())
    return {
      voiceId,
      voiceName: voiceName || voiceId,
      description: ['火山引擎', language],
      language,
      provider: 'volcengine',
    }
  }).filter((voice) => voice.voiceId && isVolcVoiceCompatibleWithConfig(voice.voiceId, config))

  if (rows.length) return rows

  return defaultVolcVoiceForConfig(config)
}

export function fallbackVoicesForConfig(config: AIConfigRow | undefined | null): VoiceCatalogItem[] {
  if (!config) return []
  if (config.provider === 'volcengine') return parseVolcVoices(config)
  return []
}
