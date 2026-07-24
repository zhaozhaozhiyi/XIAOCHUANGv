export const DEFAULT_VOLC_TTS_VOICE = 'zh_male_guozhoudege_moon_bigtts'

export const SERVICE_TYPES = [
  { type: 'text', label: '文本' },
  { type: 'image', label: '图片' },
  { type: 'video', label: '视频' },
  { type: 'audio', label: '音频' },
] as const

export type AIServiceType = (typeof SERVICE_TYPES)[number]['type']

export const SERVICE_META: Record<AIServiceType, { label: string; desc: string }> = {
  text: { label: '文本', desc: '剧本改写、角色场景提取、分镜拆解等 Agent 文本能力' },
  image: { label: '图片', desc: '角色图、场景图、镜头图与首尾帧等静态图像生成' },
  video: { label: '视频', desc: '镜头视频生成，支持单图、多图和首尾帧模式' },
  audio: { label: '音频', desc: '角色试听、旁白与对白语音生成' },
}

export const PROVIDER_LABELS: Record<string, string> = {
  volcengine: '火山引擎',
  ali: '阿里云',
  minimax: 'MiniMax',
  moonshot: '月之暗面',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  kling: '快手',
  chatfire: 'ChatFire',
  gemini: 'Gemini',
  vidu: 'Vidu',
  openrouter: 'OpenRouter',
}

export function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] || provider
}

export const PROVIDER_COLORS: Record<string, string> = {
  volcengine: '#1664FF',
  ali: '#FF6A00',
  minimax: '#EE4B6A',
  moonshot: '#16191E',
  deepseek: '#4D6BFE',
  openai: '#10A37F',
  kling: '#FF5000',
}

export const ENDPOINT_PREFIXES: Record<string, string> = {
  openai: '/v1',
  minimax: '/v1',
  volcengine: '/api/v3',
  ali: '/api/v1',
  moonshot: '/v1',
  deepseek: '/v1',
  kling: '/v1',
}

export type ProviderPreset = {
  label: string
  baseUrl: string
  models: string[]
  defaultName: string
  defaultDescription: string
}

type ProviderPresetDefinition = ProviderPreset & {
  serviceType: AIServiceType
  provider: string
  catalogDisplayName: string
  catalogDescription: string
  xiaochuangPriority?: number
  xiaochuangSettings?: Record<string, unknown>
}

const PROVIDER_PRESET_DEFINITIONS: readonly ProviderPresetDefinition[] = [
  {
    serviceType: 'text',
    provider: 'volcengine',
    label: '火山引擎',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    models: ['ep-20260316174217-nhvxp', 'ep-20260316174238-z89v4', 'ep-20260316174324-txh2n'],
    defaultName: '火山引擎',
    defaultDescription: '文本 · 豆包 / DeepSeek，Agent 对话与剧本处理',
    catalogDisplayName: '火山方舟文本',
    catalogDescription: '方舟大模型文本接口',
    xiaochuangPriority: 100,
  },
  {
    serviceType: 'text',
    provider: 'ali',
    label: '阿里云',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus'],
    defaultName: '阿里云',
    defaultDescription: '文本 · 通义 Qwen，Agent 对话',
    catalogDisplayName: '阿里云百炼文本',
    catalogDescription: '通义千问 OpenAI 兼容文本接口',
  },
  {
    serviceType: 'text',
    provider: 'minimax',
    label: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: ['abab6.5s-chat'],
    defaultName: 'MiniMax',
    defaultDescription: '文本 · abab，Agent 对话',
    catalogDisplayName: 'MiniMax 文本',
    catalogDescription: 'MiniMax 文本对话接口',
  },
  {
    serviceType: 'text',
    provider: 'moonshot',
    label: '月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k'],
    defaultName: '月之暗面',
    defaultDescription: '文本 · Kimi，Agent 对话',
    catalogDisplayName: '月之暗面 Kimi',
    catalogDescription: 'Kimi 文本对话接口',
  },
  {
    serviceType: 'text',
    provider: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    defaultName: 'DeepSeek',
    defaultDescription: '文本 · 高性价比推理',
    catalogDisplayName: 'DeepSeek 文本',
    catalogDescription: 'DeepSeek 文本对话接口',
  },
  {
    serviceType: 'image',
    provider: 'volcengine',
    label: '火山引擎',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    models: ['doubao-seedream-4-0-250828'],
    defaultName: '火山引擎',
    defaultDescription: '图片 · 豆包 Seedream，日常生图',
    catalogDisplayName: '火山方舟图片',
    catalogDescription: '方舟图片生成接口',
    xiaochuangPriority: 99,
  },
  {
    serviceType: 'image',
    provider: 'minimax',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.chat',
    models: ['image-01'],
    defaultName: 'MiniMax',
    defaultDescription: '图片 · image-01，角色与场景图',
    catalogDisplayName: 'MiniMax 图片',
    catalogDescription: 'MiniMax 图片生成接口',
  },
  {
    serviceType: 'image',
    provider: 'ali',
    label: '阿里云',
    baseUrl: 'https://dashscope.aliyuncs.com',
    models: ['wanx2.1-t2i-turbo'],
    defaultName: '阿里云',
    defaultDescription: '图片 · 通义万相，静态图像生成',
    catalogDisplayName: '阿里云百炼图片',
    catalogDescription: '阿里百炼图片生成接口',
  },
  {
    serviceType: 'image',
    provider: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-image-1'],
    defaultName: 'OpenAI',
    defaultDescription: '图片 · GPT Image',
    catalogDisplayName: 'OpenAI 图片',
    catalogDescription: 'OpenAI 图片生成接口',
  },
  {
    serviceType: 'video',
    provider: 'kling',
    label: '快手',
    baseUrl: 'https://api.klingai.com',
    models: ['kling-v2-6'],
    defaultName: '快手',
    defaultDescription: '视频 · 可灵图生视频（需 Access Key + Secret Key）',
    catalogDisplayName: '快手可灵视频',
    catalogDescription: '可灵图生视频接口（JWT 鉴权）',
  },
  {
    serviceType: 'video',
    provider: 'volcengine',
    label: '火山引擎',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    models: ['ep-20260409152046-7msh7'],
    defaultName: '火山引擎',
    defaultDescription: '视频 · 豆包 Seedance 2.0，支持首尾帧',
    catalogDisplayName: '火山方舟视频',
    catalogDescription: '方舟视频生成接口',
    xiaochuangPriority: 98,
  },
  {
    serviceType: 'video',
    provider: 'ali',
    label: '阿里云',
    baseUrl: 'https://dashscope.aliyuncs.com',
    models: ['wan2.6-i2v-flash'],
    defaultName: '阿里云',
    defaultDescription: '视频 · 万相，图生视频',
    catalogDisplayName: '阿里云百炼视频',
    catalogDescription: '阿里百炼视频生成接口',
  },
  {
    serviceType: 'audio',
    provider: 'volcengine',
    label: '火山引擎',
    baseUrl: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
    models: [DEFAULT_VOLC_TTS_VOICE],
    defaultName: '火山引擎',
    defaultDescription: '音频 · 火山 TTS，旁白与对白',
    catalogDisplayName: '火山方舟语音',
    catalogDescription: '方舟双向流式 TTS 接口',
    xiaochuangPriority: 97,
    xiaochuangSettings: {
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
      supportedLanguageTags: ['zh-CN'],
      disableMarkdownFilter: false,
    },
  },
  {
    serviceType: 'audio',
    provider: 'minimax',
    label: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com',
    models: ['speech-2.8-hd'],
    defaultName: 'MiniMax',
    defaultDescription: '音频 · 高清 TTS',
    catalogDisplayName: 'MiniMax 语音',
    catalogDescription: 'MiniMax TTS 接口',
    xiaochuangSettings: {
      supportedLanguageTags: ['zh-CN'],
    },
  },
]

function buildProviderPresetMap() {
  return PROVIDER_PRESET_DEFINITIONS.reduce<Record<AIServiceType, Record<string, ProviderPreset>>>((result, definition) => {
    if (!result[definition.serviceType]) {
      result[definition.serviceType] = {}
    }

    result[definition.serviceType][definition.provider] = {
      label: definition.label,
      baseUrl: definition.baseUrl,
      models: [...definition.models],
      defaultName: definition.defaultName,
      defaultDescription: definition.defaultDescription,
    }

    return result
  }, {
    text: {},
    image: {},
    video: {},
    audio: {},
  })
}

export const PROVIDER_PRESETS = buildProviderPresetMap()

export const PROVIDERS = Array.from(new Set(PROVIDER_PRESET_DEFINITIONS.map((item) => item.provider)))

export function getProviderPreset(serviceType: AIServiceType, provider: string): ProviderPreset | null {
  return PROVIDER_PRESETS[serviceType]?.[provider] ?? null
}

export const AI_PROVIDER_CATALOG = PROVIDER_PRESET_DEFINITIONS.map((definition) => ({
  serviceType: definition.serviceType,
  provider: definition.provider,
  displayName: definition.catalogDisplayName,
  defaultUrl: definition.baseUrl,
  presetModels: [...definition.models],
  description: definition.catalogDescription,
})) as Array<{
  serviceType: AIServiceType
  provider: string
  displayName: string
  defaultUrl: string
  presetModels: string[]
  description: string
}>

export const XIAOCHUANG_PRESET_SERVICES = PROVIDER_PRESET_DEFINITIONS
  .filter((definition) => typeof definition.xiaochuangPriority === 'number')
  .map((definition) => ({
    serviceType: definition.serviceType,
    label: SERVICE_META[definition.serviceType].label,
    provider: definition.provider,
    name: definition.defaultName,
    description: definition.defaultDescription,
    baseUrl: definition.baseUrl,
    model: definition.models[0] ?? '',
    priority: definition.xiaochuangPriority!,
    ...(definition.xiaochuangSettings ? { settings: definition.xiaochuangSettings } : {}),
  })) as Array<{
    serviceType: AIServiceType
    label: string
    provider: string
    name: string
    description: string
    baseUrl: string
    model: string
    priority: number
    settings?: Record<string, unknown>
  }>
