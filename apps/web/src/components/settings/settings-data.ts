import { Bot, Cpu, FileText } from 'lucide-react'

export const SERVICE_TYPES = [
  { type: 'text', label: '文本' },
  { type: 'image', label: '图片' },
  { type: 'video', label: '视频' },
  { type: 'audio', label: '音频' },
] as const

export const SERVICE_META: Record<string, { label: string; desc: string }> = {
  text: { label: '文本', desc: '剧本改写、角色场景提取、分镜拆解等 Agent 文本能力' },
  image: { label: '图片', desc: '角色图、场景图、镜头图与首尾帧等静态图像生成' },
  video: { label: '视频', desc: '镜头视频生成，支持单图、多图和首尾帧模式' },
  audio: { label: '音频', desc: '角色试听、旁白与对白语音生成' },
}

/** 厂商中文名（设置页展示用） */
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

/** 厂商品牌色（设置页徽标用） */
export const PROVIDER_COLORS: Record<string, string> = {
  volcengine: '#1664FF',
  ali: '#FF6A00',
  minimax: '#EE4B6A',
  moonshot: '#16191E',
  deepseek: '#4D6BFE',
  openai: '#10A37F',
  kling: '#FF5000',
}

export const PROVIDERS = [
  'volcengine', 'ali', 'minimax', 'moonshot', 'deepseek', 'openai', 'kling',
]

type ProviderPreset = {
  label: string
  baseUrl: string
  models: string[]
  defaultName: string
  defaultDescription: string
}

export const PROVIDER_PRESETS: Record<string, Record<string, ProviderPreset>> = {
  text: {
    volcengine: {
      label: '火山引擎',
      baseUrl: 'https://ark.cn-beijing.volces.com',
      models: ['ep-20260316174217-nhvxp', 'ep-20260316174238-z89v4', 'ep-20260316174324-txh2n'],
      defaultName: '火山引擎',
      defaultDescription: '文本 · 豆包 / DeepSeek，Agent 对话与剧本处理',
    },
    ali: {
      label: '阿里云',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus'],
      defaultName: '阿里云',
      defaultDescription: '文本 · 通义 Qwen，Agent 对话',
    },
    minimax: {
      label: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/v1',
      models: ['abab6.5s-chat'],
      defaultName: 'MiniMax',
      defaultDescription: '文本 · abab，Agent 对话',
    },
    moonshot: {
      label: '月之暗面',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-8k'],
      defaultName: '月之暗面',
      defaultDescription: '文本 · Kimi，Agent 对话',
    },
    deepseek: {
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat'],
      defaultName: 'DeepSeek',
      defaultDescription: '文本 · 高性价比推理',
    },
  },
  image: {
    volcengine: {
      label: '火山引擎',
      baseUrl: 'https://ark.cn-beijing.volces.com',
      models: ['doubao-seedream-4-0-250828'],
      defaultName: '火山引擎',
      defaultDescription: '图片 · 豆包 Seedream，日常生图',
    },
    minimax: {
      label: 'MiniMax',
      baseUrl: 'https://api.minimax.chat',
      models: ['image-01'],
      defaultName: 'MiniMax',
      defaultDescription: '图片 · image-01，角色与场景图',
    },
    ali: {
      label: '阿里云',
      baseUrl: 'https://dashscope.aliyuncs.com',
      models: ['wanx2.1-t2i-turbo'],
      defaultName: '阿里云',
      defaultDescription: '图片 · 通义万相，静态图像生成',
    },
    openai: {
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com',
      models: ['gpt-image-1'],
      defaultName: 'OpenAI',
      defaultDescription: '图片 · GPT Image',
    },
  },
  video: {
    kling: {
      label: '快手',
      baseUrl: 'https://api.klingai.com',
      models: ['kling-v2-6'],
      defaultName: '快手',
      defaultDescription: '视频 · 可灵图生视频（需 Access Key + Secret Key）',
    },
    volcengine: {
      label: '火山引擎',
      baseUrl: 'https://ark.cn-beijing.volces.com',
      models: ['ep-20260409152046-7msh7'],
      defaultName: '火山引擎',
      defaultDescription: '视频 · 豆包 Seedance 2.0，支持首尾帧',
    },
    ali: {
      label: '阿里云',
      baseUrl: 'https://dashscope.aliyuncs.com',
      models: ['wan2.6-i2v-flash'],
      defaultName: '阿里云',
      defaultDescription: '视频 · 万相，图生视频',
    },
  },
  audio: {
    volcengine: {
      label: '火山引擎',
      baseUrl: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
      models: ['zh_male_guozhoudege_moon_bigtts'],
      defaultName: '火山引擎',
      defaultDescription: '音频 · 火山 TTS，旁白与对白',
    },
    minimax: {
      label: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com',
      models: ['speech-2.8-hd'],
      defaultName: 'MiniMax',
      defaultDescription: '音频 · 高清 TTS',
    },
  },
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

export const AGENT_DEFS = [
  { type: 'script_rewriter', label: '剧本改写', icon: '📝' },
  { type: 'extractor', label: '角色场景提取', icon: '🔍' },
  { type: 'storyboard_breaker', label: '分镜拆解', icon: '🎬' },
  { type: 'voice_assigner', label: '音色分配', icon: '🎙' },
  { type: 'grid_prompt_generator', label: '图片提示词生成', icon: '🖼' },
]

export const BASE_TABS = [
  { id: 'ai', label: 'AI 服务', icon: Cpu },
] as const

export const ADVANCED_TABS = [
  { id: 'agents', label: 'Agent 配置', icon: Bot },
  { id: 'skills', label: 'Skills', icon: FileText },
] as const

export function fmtModel(m: unknown): string {
  if (Array.isArray(m)) return m.join(', ')
  return m ? String(m) : '—'
}
