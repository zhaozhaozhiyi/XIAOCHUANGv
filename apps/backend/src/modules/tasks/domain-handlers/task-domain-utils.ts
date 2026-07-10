import type { TaskRecord } from './task-domain-handler'

const RESUME_MAX_AGE_MS = 12 * 60 * 60_000

export function parseJsonValue(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function parseTaskPayload(task: TaskRecord): Record<string, unknown> {
  const parsed = parseJsonValue(task.payloadJson)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

export function sanitizePayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) return null
  const cleanEntries = Object.entries(payload).filter(([, value]) => value !== undefined)
  if (!cleanEntries.length) return null
  return JSON.stringify(Object.fromEntries(cleanEntries))
}

export function trimText(value: unknown, maxLength: number) {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length <= maxLength) return text
  if (maxLength <= 3) return text.slice(0, maxLength)
  return `${text.slice(0, maxLength - 3)}...`
}

export function mapGenerationStatus(status: string | null | undefined) {
  switch (String(status || '').trim().toLowerCase()) {
    case 'pending':
      return 'queued'
    case 'processing':
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'canceled':
    case 'cancelled':
      return 'canceled'
    default:
      return 'queued'
  }
}

export function inferErrorKind(message: string | null | undefined) {
  const text = String(message || '').toLowerCase()
  if (!text) return 'internal'
  if (text.includes('cancel')) return 'canceled'
  if (text.includes('moderat')) return 'moderation'
  if (text.includes('429') || text.includes('quota') || text.includes('rate limit') || text.includes('too many requests')) {
    return 'quota'
  }
  if (
    text.includes('timeout')
    || text.includes('timed out')
    || text.includes('network')
    || text.includes('fetch failed')
    || text.includes('econn')
    || text.includes('enotfound')
    || text.includes('socket')
  ) {
    return 'network'
  }
  if (text.includes('invalid') || text.includes('required') || text.includes('not found')) {
    return 'validation'
  }
  return 'provider'
}

export function isTaskTooOldForResume(task: TaskRecord) {
  const createdAt = task.createdAt instanceof Date ? task.createdAt.getTime() : Date.parse(String(task.createdAt || ''))
  if (!Number.isFinite(createdAt)) return true
  return Date.now() - createdAt > RESUME_MAX_AGE_MS
}

export function isStaleRunningTask(task: TaskRecord) {
  const updatedAt =
    task.updatedAt instanceof Date
      ? task.updatedAt.getTime()
      : Date.parse(String(task.updatedAt || task.startedAt || task.createdAt || ''))
  if (!Number.isFinite(updatedAt)) return true
  return Date.now() - updatedAt > 5 * 60_000
}
