import { Bot, Cpu, FileText } from 'lucide-react'
import {
  ENDPOINT_PREFIXES as SHARED_ENDPOINT_PREFIXES,
  PROVIDER_COLORS as SHARED_PROVIDER_COLORS,
  PROVIDER_LABELS as SHARED_PROVIDER_LABELS,
  PROVIDER_PRESETS as SHARED_PROVIDER_PRESETS,
  PROVIDERS as SHARED_PROVIDERS,
  SERVICE_META as SHARED_SERVICE_META,
  SERVICE_TYPES as SHARED_SERVICE_TYPES,
  providerLabel,
  type ProviderPreset,
} from '@xiaochuang/contracts'

export const SERVICE_TYPES = [...SHARED_SERVICE_TYPES]
export const SERVICE_META: Record<string, { label: string; desc: string }> = SHARED_SERVICE_META
export const PROVIDER_LABELS: Record<string, string> = SHARED_PROVIDER_LABELS
export const PROVIDER_COLORS: Record<string, string> = SHARED_PROVIDER_COLORS
export const PROVIDERS = [...SHARED_PROVIDERS]
export const PROVIDER_PRESETS: Record<string, Record<string, ProviderPreset>> = SHARED_PROVIDER_PRESETS
export const ENDPOINT_PREFIXES: Record<string, string> = SHARED_ENDPOINT_PREFIXES

export { providerLabel }

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
