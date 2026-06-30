export { cn } from './cn'

const PUBLIC_MEDIA_BASE_URL = String(process.env.NEXT_PUBLIC_MEDIA_BASE_URL || '').trim().replace(/\/+$/, '')

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 30) return `${days}天前`

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

/** Normalize a path to absolute static URL */
export function staticUrl(path: string | null | undefined): string {
  const raw = String(path || '').trim()
  if (!raw) return ''
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw

  const normalized = raw.replace(/^\/?static\//, '').replace(/^\/+/, '')
  if (raw.startsWith('/static/') || raw.startsWith('static/')) {
    return PUBLIC_MEDIA_BASE_URL ? `${PUBLIC_MEDIA_BASE_URL}/${normalized}` : raw
  }
  if (raw.startsWith('/')) return raw
  return PUBLIC_MEDIA_BASE_URL ? `${PUBLIC_MEDIA_BASE_URL}/${normalized}` : raw
}
