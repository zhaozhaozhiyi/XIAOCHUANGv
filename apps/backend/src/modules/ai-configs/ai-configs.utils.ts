import { readKlingSecretKey, signKlingJwt } from '../videos/kling-auth'
import { aiServiceConfigs } from '../../db/schema'

export const DEFAULT_VOLC_TTS_VOICE = 'zh_male_guozhoudege_moon_bigtts'

export const AI_PROVIDER_CATALOG = [
  {
    serviceType: 'text',
    provider: 'volcengine',
    displayName: '火山方舟文本',
    defaultUrl: 'https://ark.cn-beijing.volces.com',
    presetModels: ['ep-20260316174217-nhvxp'],
    description: '方舟大模型文本接口',
  },
  {
    serviceType: 'text',
    provider: 'ali',
    displayName: '阿里云百炼文本',
    defaultUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    presetModels: ['qwen-plus'],
    description: '通义千问 OpenAI 兼容文本接口',
  },
  {
    serviceType: 'text',
    provider: 'minimax',
    displayName: 'MiniMax 文本',
    defaultUrl: 'https://api.minimaxi.com/v1',
    presetModels: ['abab6.5s-chat'],
    description: 'MiniMax 文本对话接口',
  },
  {
    serviceType: 'text',
    provider: 'moonshot',
    displayName: '月之暗面 Kimi',
    defaultUrl: 'https://api.moonshot.cn/v1',
    presetModels: ['moonshot-v1-8k'],
    description: 'Kimi 文本对话接口',
  },
  {
    serviceType: 'text',
    provider: 'deepseek',
    displayName: 'DeepSeek 文本',
    defaultUrl: 'https://api.deepseek.com/v1',
    presetModels: ['deepseek-chat'],
    description: 'DeepSeek 文本对话接口',
  },
  {
    serviceType: 'image',
    provider: 'volcengine',
    displayName: '火山方舟图片',
    defaultUrl: 'https://ark.cn-beijing.volces.com',
    presetModels: ['doubao-seedream-3-0-t2i-250415'],
    description: '方舟图片生成接口',
  },
  {
    serviceType: 'image',
    provider: 'minimax',
    displayName: 'MiniMax 图片',
    defaultUrl: 'https://api.minimax.chat',
    presetModels: ['image-01'],
    description: 'MiniMax 图片生成接口',
  },
  {
    serviceType: 'image',
    provider: 'ali',
    displayName: '阿里云百炼图片',
    defaultUrl: 'https://dashscope.aliyuncs.com',
    presetModels: ['wanx2.1-t2i-plus'],
    description: '阿里百炼图片生成接口',
  },
  {
    serviceType: 'image',
    provider: 'openai',
    displayName: 'OpenAI 图片',
    defaultUrl: 'https://api.openai.com',
    presetModels: ['gpt-image-1'],
    description: 'OpenAI 图片生成接口',
  },
  {
    serviceType: 'video',
    provider: 'kling',
    displayName: '快手可灵视频',
    defaultUrl: 'https://api.klingai.com',
    presetModels: ['kling-v2-6'],
    description: '可灵图生视频接口（JWT 鉴权）',
  },
  {
    serviceType: 'video',
    provider: 'volcengine',
    displayName: '火山方舟视频',
    defaultUrl: 'https://ark.cn-beijing.volces.com',
    presetModels: ['ep-20260409152046-7msh7'],
    description: '方舟视频生成接口',
  },
  {
    serviceType: 'video',
    provider: 'ali',
    displayName: '阿里云百炼视频',
    defaultUrl: 'https://dashscope.aliyuncs.com',
    presetModels: ['wan2.2-i2v-plus'],
    description: '阿里百炼视频生成接口',
  },
  {
    serviceType: 'audio',
    provider: 'volcengine',
    displayName: '火山方舟语音',
    defaultUrl: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
    presetModels: [DEFAULT_VOLC_TTS_VOICE],
    description: '方舟双向流式 TTS 接口',
  },
  {
    serviceType: 'audio',
    provider: 'minimax',
    displayName: 'MiniMax 语音',
    defaultUrl: 'https://api.minimaxi.com',
    presetModels: ['speech-02-turbo'],
    description: 'MiniMax TTS 接口',
  },
] as const

export const HUOBAO_PRESET_SERVICES = [
  {
    serviceType: 'text',
    label: '文本',
    provider: 'volcengine',
    name: '火山引擎',
    description: '文本 · 豆包 / DeepSeek，Agent 对话与剧本处理',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    model: 'ep-20260316174217-nhvxp',
    priority: 100,
  },
  {
    serviceType: 'image',
    label: '图片',
    provider: 'volcengine',
    name: '火山引擎',
    description: '图片 · 豆包 Seedream，日常生图',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    model: 'doubao-seedream-4-0-250828',
    priority: 99,
  },
  {
    serviceType: 'video',
    label: '视频',
    provider: 'volcengine',
    name: '火山引擎',
    description: '视频 · 豆包 Seedance，镜头视频生成',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    model: 'ep-20260409152046-7msh7',
    priority: 98,
  },
  {
    serviceType: 'audio',
    label: '音频',
    provider: 'volcengine',
    name: '火山引擎',
    description: '音频 · 火山 TTS，旁白与对白语音',
    baseUrl: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
    model: DEFAULT_VOLC_TTS_VOICE,
    priority: 97,
    settings: {
      appIdEnv: 'VOLC_APP_ID',
      accessKeyEnv: 'VOLC_ACCESS_KEY',
      resourceIdEnv: 'VOLC_RESOURCE_ID',
      endpointEnv: 'VOLC_ENDPOINT',
      encodingEnv: 'VOLC_ENCODING',
      sampleRateEnv: 'VOLC_SAMPLE_RATE',
      bitRateEnv: 'VOLC_BIT_RATE',
      voiceEnv: 'VOLC_VOICE',
      resourceId: 'volc.service_type.10029',
      encoding: 'mp3',
      sampleRate: 24000,
      bitRate: 128000,
      voice: DEFAULT_VOLC_TTS_VOICE,
      emotion: '',
      emotionScale: 4,
      loudnessRate: 0,
      explicitLanguage: 'zh',
      disableMarkdownFilter: false,
    },
  },
] as const

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
