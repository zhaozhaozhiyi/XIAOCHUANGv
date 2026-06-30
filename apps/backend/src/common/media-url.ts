function normalizeMediaBaseUrl(value: string | null | undefined) {
  const raw = String(value || '').trim()
  return raw ? raw.replace(/\/+$/, '') : ''
}

export function toPublicMediaUrl(value: string | null | undefined, publicBaseUrl?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw

  const mediaBaseUrl = normalizeMediaBaseUrl(publicBaseUrl ?? process.env.STORAGE_PUBLIC_BASE_URL)
  const normalized = raw.replace(/^\/?static\//, '').replace(/^\/+/, '')

  if (raw.startsWith('/static/') || raw.startsWith('static/')) {
    return mediaBaseUrl ? `${mediaBaseUrl}/${normalized}` : `/static/${normalized}`
  }

  if (raw.startsWith('/')) return raw
  return mediaBaseUrl ? `${mediaBaseUrl}/${normalized}` : `/static/${normalized}`
}
