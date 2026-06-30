import { toPublicMediaUrl as resolvePublicMediaUrl } from '../../common/media-url'

import { dramaStylePromptHint } from './images.drama-style'

export function appendDramaStyleHint(prompt: string, style: string | null | undefined): string {
  const trimmed = String(prompt || '').trim()
  if (!trimmed) return trimmed
  const hint = dramaStylePromptHint(style)
  if (!hint) return trimmed
  if (trimmed.toLowerCase().includes(hint.toLowerCase())) return trimmed
  return `${trimmed}，${hint}`
}

export function trimText(value: unknown, maxLength: number) {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length <= maxLength) return text
  if (maxLength <= 3) return text.slice(0, maxLength)
  return `${text.slice(0, maxLength - 3)}...`
}

export function sanitizePayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) return null
  const cleanEntries = Object.entries(payload).filter(([, value]) => value !== undefined)
  if (!cleanEntries.length) return null
  return JSON.stringify(Object.fromEntries(cleanEntries))
}

export function toPublicMediaUrl(value: string | null | undefined) {
  return resolvePublicMediaUrl(value)
}

export function parseConfigModelList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean)
    }
  } catch {}
  if (raw.includes(',')) {
    return raw.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return [raw.trim()]
}

export function resolveConfiguredModel(requested: string | undefined, allowedModels: string[], fallbackModel: string) {
  const fallback = allowedModels[0] || fallbackModel
  const normalized = String(requested || '').trim()
  if (!normalized) return fallback
  if (allowedModels.includes(normalized)) return normalized
  return fallback
}
