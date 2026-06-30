import { providerLabel } from '@/components/settings/settings-data'
import type { AudioConfigOption, ModelSelectOption } from '@/components/create/input-composer-types'
import type { AIServiceConfig } from '@/types/api'

type ConfigLike = AIServiceConfig & {
  serviceType?: string
  isActive?: boolean | number
  name?: string
  description?: string
}

function parseModels(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof raw !== 'string') return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean)
    }
  } catch {}
  if (trimmed.includes(',')) {
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return [trimmed]
}

function readServiceType(config: ConfigLike) {
  return String(config.service_type || config.serviceType || '')
}

function readConfigName(config: ConfigLike) {
  return String(config.name || '').trim()
}

function readConfigDescription(config: ConfigLike) {
  return String(config.description || '').trim()
}

function readConfigProvider(config: ConfigLike) {
  return String(config.provider || '').trim()
}

function isConfigActive(config: ConfigLike): boolean {
  const active = (config.is_active ?? config.isActive) as boolean | number | null | undefined
  if (active === false || active === 0) return false
  return active === true || active === 1
}

export function buildModelOptions(configs: AIServiceConfig[], serviceType: 'image' | 'video'): ModelSelectOption[] {
  const seen = new Set<string>()
  const activeConfigs = [...configs]
    .filter((config) => readServiceType(config as ConfigLike) === serviceType && isConfigActive(config as ConfigLike))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
  const options: ModelSelectOption[] = []
  for (const config of activeConfigs) {
    const models = parseModels(config.model)
    const displayName = readConfigName(config as ConfigLike) || providerLabel(readConfigProvider(config as ConfigLike))
    const displayDescription = readConfigDescription(config as ConfigLike)
    for (const model of models) {
      if (seen.has(model)) continue
      seen.add(model)
      options.push({
        label: displayName,
        description: displayDescription,
        tertiary: `${providerLabel(readConfigProvider(config as ConfigLike))} · ${model}`,
        value: model,
      })
    }
  }
  return options
}

// 音频服务商：每个激活的 audio 配置就是一个可选"服务商/账号"，音色按 provider 跟随。
export function buildAudioConfigOptions(configs: AIServiceConfig[]): AudioConfigOption[] {
  return [...configs]
    .filter((config) => readServiceType(config as ConfigLike) === 'audio' && isConfigActive(config as ConfigLike))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .map((config) => {
      const provider = readConfigProvider(config as ConfigLike)
      return {
        id: config.id,
        provider,
        label: readConfigName(config as ConfigLike) || providerLabel(provider),
        description: providerLabel(provider),
      }
    })
}
