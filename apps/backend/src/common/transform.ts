import { toPublicMediaUrl } from './media-url'

type SnakeCasePublicMediaOptions = {
  urlFields?: readonly string[]
  jsonArrayFields?: readonly string[]
}

function toSnakeKey(key: string) {
  return key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
}

function normalizePublicMediaArrayValue(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return raw

    const normalized = [...new Set(
      parsed
        .map((item) => typeof item === 'string' ? toPublicMediaUrl(item) : null)
        .filter((item): item is string => Boolean(item)),
    )]

    return normalized.length ? JSON.stringify(normalized) : null
  } catch {
    return toPublicMediaUrl(raw)
  }
}

function normalizePublicMediaRecord(
  obj: Record<string, unknown>,
  options: SnakeCasePublicMediaOptions,
) {
  const result = { ...obj }

  for (const key of options.urlFields || []) {
    result[key] = toPublicMediaUrl(result[key] as string | null | undefined)
  }

  for (const key of options.jsonArrayFields || []) {
    result[key] = normalizePublicMediaArrayValue(result[key])
  }

  return result
}

export function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'localPath') continue
    const snakeKey = toSnakeKey(key)
    result[snakeKey] = value
  }
  return result
}

export function toSnakeCaseArray(arr: Record<string, unknown>[]) {
  return arr.map(toSnakeCase)
}

export function toSnakeCaseWithPublicMedia(
  obj: Record<string, unknown>,
  options: SnakeCasePublicMediaOptions = {},
) {
  return toSnakeCase(normalizePublicMediaRecord(obj, options))
}

export function toSnakeCaseArrayWithPublicMedia(
  arr: Record<string, unknown>[],
  options: SnakeCasePublicMediaOptions = {},
) {
  return arr.map((item) => toSnakeCaseWithPublicMedia(item, options))
}
