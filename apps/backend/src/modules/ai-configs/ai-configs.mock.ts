import type { aiServiceConfigs, aiVoices } from '../../db/schema'

type AiServiceConfigRow = typeof aiServiceConfigs.$inferSelect
type AiVoiceRow = typeof aiVoices.$inferSelect

function parseModelList(value: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean)
    }
  } catch {
    // ignore and fall through
  }
  const raw = String(value || '').trim()
  return raw ? [raw] : []
}

export function isMockAiConfigRow(row: Pick<AiServiceConfigRow, 'name' | 'baseUrl' | 'model' | 'apiKey'>) {
  const name = String(row.name || '').trim().toLowerCase()
  const baseUrl = String(row.baseUrl || '').trim().toLowerCase()
  const apiKey = String(row.apiKey || '').trim().toLowerCase()
  const models = parseModelList(row.model ?? null).map((item) => item.toLowerCase())

  return (
    name.startsWith('mock ')
    || baseUrl.includes('127.0.0.1:3099')
    || baseUrl.includes('localhost:3099')
    || apiKey.startsWith('mock-')
    || models.some((model) => model.startsWith('mock-'))
  )
}

export function isMockVoiceRow(row: Pick<AiVoiceRow, 'voiceId' | 'voiceName'>) {
  const voiceId = String(row.voiceId || '').trim().toLowerCase()
  const voiceName = String(row.voiceName || '').trim().toLowerCase()
  return voiceId.startsWith('mock-voice-') || voiceName.startsWith('mock ')
}
