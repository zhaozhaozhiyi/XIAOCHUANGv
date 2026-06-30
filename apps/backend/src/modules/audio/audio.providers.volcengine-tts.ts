import { randomUUID } from 'crypto'
import WebSocket from 'ws'

import type { AIConfig, ProviderRequest, TTSGenerateParams, TTSGenerateResponse, TTSProviderAdapter } from './audio.providers.types'

process.env.WS_NO_BUFFER_UTIL = '1'
process.env.WS_NO_UTF_8_VALIDATE = '1'

const EVENT_START_CONNECTION = 1
const EVENT_FINISH_CONNECTION = 2
const EVENT_CONNECTION_STARTED = 50
const EVENT_CONNECTION_FAILED = 51
const EVENT_CONNECTION_FINISHED = 52
const EVENT_START_SESSION = 100
const EVENT_FINISH_SESSION = 102
const EVENT_SESSION_STARTED = 150
const EVENT_SESSION_FINISHED = 152
const EVENT_SESSION_FAILED = 153
const EVENT_TASK_REQUEST = 200
const EVENT_TTS_ENDED = 359

const MSG_FULL_CLIENT_REQUEST = 0b0001
const MSG_FULL_SERVER_RESPONSE = 0b1001
const MSG_AUDIO_ONLY_SERVER = 0b1011
const MSG_ERROR = 0b1111

const FLAG_WITH_EVENT = 0b0100
const SERIALIZATION_JSON = 0b0001
const COMPRESSION_NONE = 0
const DEFAULT_FORMAT = 'mp3'
const DEFAULT_SAMPLE_RATE = 24000
const DEFAULT_BIT_RATE = 128000
const DEFAULT_CHANNELS = 1
const DEFAULT_BITS_PER_SAMPLE = 16

interface VolcMessage {
  msgType: number
  flag: number
  eventType: number
  sessionId: string
  connectId: string
  errorCode: number
  payload: Buffer
}

function settingValue(config: AIConfig, key: string) {
  return config.settings?.[key]
}

function settingString(config: AIConfig, key: string) {
  const value = settingValue(config, key)
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  return ''
}

function getEnvFromSetting(config: AIConfig, keys: string[], fallbackEnvKey?: string) {
  for (const key of keys) {
    const envKey = settingString(config, key)
    if (envKey) {
      const value = String(process.env[envKey] || '').trim()
      if (value) return value
    }
  }
  return fallbackEnvKey ? String(process.env[fallbackEnvKey] || '').trim() : ''
}

function getSetting(config: AIConfig, keys: string[], envKey?: string) {
  for (const key of keys) {
    const value = settingString(config, key)
    if (value) return value
  }
  return envKey ? String(process.env[envKey] || '').trim() : ''
}

function getSettingOrEnvRef(config: AIConfig, keys: string[], envRefKeys: string[], envKey: string) {
  return getSetting(config, keys) || getEnvFromSetting(config, envRefKeys, envKey)
}

function getNumberSetting(config: AIConfig, keys: string[], envKey: string | undefined, fallback: number) {
  const raw = getSetting(config, keys, envKey)
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function getNumberSettingOrEnvRef(config: AIConfig, keys: string[], envRefKeys: string[], envKey: string, fallback: number) {
  const raw = getSetting(config, keys) || getEnvFromSetting(config, envRefKeys, envKey)
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function getBooleanSetting(config: AIConfig, keys: string[], fallback: boolean) {
  for (const key of keys) {
    const value = settingValue(config, key)
    if (typeof value === 'boolean') return value
    if (typeof value === 'string' && value.trim()) {
      const normalized = value.trim().toLowerCase()
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
      if (['0', 'false', 'no', 'off'].includes(normalized)) return false
    }
  }
  return fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function speedRatioToSpeechRate(speed?: number | null) {
  if (speed == null) return null
  const numeric = Number(speed)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.round(clamp((numeric - 1) * 100, -50, 100))
}

function normalizeFormat(format: string) {
  const normalized = format.trim().toLowerCase().replace(/^audio\//, '')
  if (normalized === 'mpeg') return 'mp3'
  return normalized || DEFAULT_FORMAT
}

function resourceIdForSpeaker(resourceId: string, speaker: string) {
  const normalizedResource = resourceId.trim()
  const normalizedSpeaker = speaker.trim().toLowerCase()

  if (normalizedSpeaker.includes('_uranus_bigtts')) return 'seed-tts-2.0'
  if (
    normalizedResource === 'seed-tts-2.0' &&
    (normalizedSpeaker.includes('_moon_bigtts') || normalizedSpeaker.includes('_mars_bigtts'))
  ) {
    return 'seed-tts-1.0'
  }

  return normalizedResource
}

function extensionForFormat(format: string) {
  const normalized = normalizeFormat(format)
  if (normalized === 'ogg_opus') return 'ogg'
  return normalized
}

function parseWavMetadata(audio: Buffer) {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    return null
  }

  let offset = 12
  let channels = DEFAULT_CHANNELS
  let sampleRate = DEFAULT_SAMPLE_RATE
  let bitsPerSample = DEFAULT_BITS_PER_SAMPLE
  let dataSize = 0

  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString('ascii', offset, offset + 4)
    const chunkSize = audio.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const nextOffset = chunkStart + chunkSize + (chunkSize % 2)

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkStart + 16 <= audio.length) {
      channels = audio.readUInt16LE(chunkStart + 2) || channels
      sampleRate = audio.readUInt32LE(chunkStart + 4) || sampleRate
      bitsPerSample = audio.readUInt16LE(chunkStart + 14) || bitsPerSample
    }

    if (chunkId === 'data') {
      dataSize = Math.min(chunkSize, Math.max(0, audio.length - chunkStart))
      break
    }

    if (nextOffset <= offset) break
    offset = nextOffset
  }

  if (!dataSize) return null
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8)
  return {
    channels,
    sampleRate,
    bitsPerSample,
    dataSize,
    durationMs: bytesPerSecond > 0 ? Math.round((dataSize / bytesPerSecond) * 1000) : 0,
    bitrate: sampleRate * channels * bitsPerSample,
  }
}

function estimateAudioMetadata(audio: Buffer, format: string, sampleRate: number, bitRate: number) {
  const normalizedFormat = normalizeFormat(format)
  const wavMetadata = normalizedFormat === 'wav' ? parseWavMetadata(audio) : null
  if (wavMetadata) {
    return {
      audioLength: wavMetadata.durationMs,
      sampleRate: wavMetadata.sampleRate,
      bitrate: wavMetadata.bitrate,
      channel: wavMetadata.channels,
    }
  }

  if (normalizedFormat === 'pcm') {
    const bitrate = sampleRate * DEFAULT_CHANNELS * DEFAULT_BITS_PER_SAMPLE
    return {
      audioLength: Math.round((audio.length * 8 / bitrate) * 1000),
      sampleRate,
      bitrate,
      channel: DEFAULT_CHANNELS,
    }
  }

  const bitrate = bitRate > 0 ? bitRate : DEFAULT_BIT_RATE
  return {
    audioLength: bitrate > 0 ? Math.round((audio.length * 8 / bitrate) * 1000) : 0,
    sampleRate,
    bitrate,
    channel: DEFAULT_CHANNELS,
  }
}

function writeUInt32(value: number) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value, 0)
  return buffer
}

function createMessage(eventType: number, payload: unknown, sessionId?: string) {
  const header = Buffer.from([
    (1 << 4) | 1,
    (MSG_FULL_CLIENT_REQUEST << 4) | FLAG_WITH_EVENT,
    (SERIALIZATION_JSON << 4) | COMPRESSION_NONE,
    0,
  ])
  const payloadBuffer = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))
  const parts = [header, writeUInt32(eventType)]

  if (![EVENT_START_CONNECTION, EVENT_FINISH_CONNECTION].includes(eventType)) {
    const sessionBuffer = Buffer.from(sessionId || '')
    parts.push(writeUInt32(sessionBuffer.length), sessionBuffer)
  }

  parts.push(writeUInt32(payloadBuffer.length), payloadBuffer)
  return Buffer.concat(parts)
}

function readString(buffer: Buffer, offset: number) {
  const length = buffer.readUInt32BE(offset)
  const start = offset + 4
  const end = start + length
  return { value: buffer.subarray(start, end).toString('utf8'), offset: end }
}

function parseMessage(data: Buffer): VolcMessage {
  if (data.length < 8) throw new Error(`VolcEngine TTS response is too short: ${data.length}`)

  const headerSize = (data[0]! & 0x0f) * 4
  const msgType = (data[1]! >> 4) & 0x0f
  const flag = data[1]! & 0x0f
  let offset = headerSize
  let eventType = 0

  if (flag & FLAG_WITH_EVENT) {
    eventType = data.readUInt32BE(offset)
    offset += 4
  }

  let sessionId = ''
  let connectId = ''
  let errorCode = 0

  if (msgType === MSG_FULL_SERVER_RESPONSE || msgType === MSG_ERROR) {
    const session = readString(data, offset)
    sessionId = session.value
    offset = session.offset
  }

  if (msgType === MSG_AUDIO_ONLY_SERVER || msgType === MSG_ERROR || msgType === MSG_FULL_SERVER_RESPONSE) {
    if (offset + 4 <= data.length) {
      const connect = readString(data, offset)
      connectId = connect.value
      offset = connect.offset
    }
  }

  if (msgType === MSG_ERROR && offset + 4 <= data.length) {
    errorCode = data.readUInt32BE(offset)
    offset += 4
  }

  let payload: Buffer = Buffer.alloc(0)
  if (offset + 4 <= data.length) {
    const payloadLength = data.readUInt32BE(offset)
    offset += 4
    payload = Buffer.from(data.subarray(offset, offset + payloadLength))
  }

  return {
    msgType,
    flag,
    eventType,
    sessionId,
    connectId,
    errorCode,
    payload,
  }
}

function messagePayloadText(message: VolcMessage) {
  if (!message.payload.length) return ''
  try {
    return message.payload.toString('utf8')
  } catch {
    return ''
  }
}

function rawDataToBuffer(chunk: WebSocket.RawData) {
  if (typeof chunk === 'string') return Buffer.from(chunk)
  if (Array.isArray(chunk)) {
    return Buffer.concat(chunk.map((item) => Buffer.from(item)))
  }
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk)
  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  }
  return Buffer.from(chunk)
}

export class VolcEngineTTSAdapter implements TTSProviderAdapter {
  readonly provider = 'volcengine'

  buildGenerateRequest(_config: AIConfig, _params: TTSGenerateParams): ProviderRequest {
    throw new Error('VolcEngine TTS uses WebSocket streaming and cannot build a fetch request')
  }

  parseResponse(_result: any): TTSGenerateResponse {
    throw new Error('VolcEngine TTS uses WebSocket streaming and cannot parse a JSON response')
  }

  async generate(config: AIConfig, params: TTSGenerateParams): Promise<TTSGenerateResponse> {
    const appId = getSettingOrEnvRef(config, ['appId', 'app_id'], ['appIdEnv', 'app_id_env'], 'VOLC_APP_ID')
    const accessKey = getSettingOrEnvRef(config, ['accessKey', 'access_key'], ['accessKeyEnv', 'access_key_env'], 'VOLC_ACCESS_KEY')
    const endpoint = getSettingOrEnvRef(config, ['endpoint'], ['endpointEnv'], 'VOLC_ENDPOINT')
    const resourceId = getSettingOrEnvRef(config, ['resourceId', 'resource_id'], ['resourceIdEnv', 'resource_id_env'], 'VOLC_RESOURCE_ID') || 'volc.service_type.10029'
    const encoding = getSettingOrEnvRef(config, ['encoding'], ['encodingEnv'], 'VOLC_ENCODING') || DEFAULT_FORMAT
    const sampleRate = getNumberSettingOrEnvRef(config, ['sampleRate', 'sample_rate'], ['sampleRateEnv', 'sample_rate_env'], 'VOLC_SAMPLE_RATE', DEFAULT_SAMPLE_RATE)
    const bitRate = getNumberSettingOrEnvRef(config, ['bitRate', 'bit_rate'], ['bitRateEnv', 'bit_rate_env'], 'VOLC_BIT_RATE', DEFAULT_BIT_RATE)
    const loudnessRate = Number(getSetting(config, ['loudnessRate', 'loudness_rate'], 'VOLC_LOUDNESS_RATE') || 0)
    const emotionScale = getNumberSetting(config, ['emotionScale', 'emotion_scale'], 'VOLC_EMOTION_SCALE', 4)
    const voice = String(params.voice || getSetting(config, ['voice'], 'VOLC_VOICE') || '').trim()
    const model = String(params.model || getSetting(config, ['ttsModel', 'tts_model', 'volcModel', 'volc_model']) || '').trim()
    const explicitLanguage = getSetting(config, ['explicitLanguage', 'explicit_language'], 'VOLC_EXPLICIT_LANGUAGE')
    const disableMarkdownFilter = getBooleanSetting(config, ['disableMarkdownFilter', 'disable_markdown_filter'], false)
    const authToken = accessKey || config.apiKey
    const wsUrl = String(config.baseUrl || '').trim() || 'wss://openspeech.bytedance.com/api/v3/tts/bidirection'

    if (!appId) throw new Error('VolcEngine appId is not configured')
    if (!authToken) throw new Error('VolcEngine access token is not configured')
    if (!voice) throw new Error('VolcEngine TTS voice is not configured')

    const sessionId = randomUUID()
    const connectId = randomUUID()
    const requestId = randomUUID()
    const resourceIdForVoice = resourceIdForSpeaker(resourceId, voice)
    const speedRatio = speedRatioToSpeechRate(params.speed)

    const speaker = {
      speaker: voice,
    } as Record<string, unknown>
    if (model) speaker.model = model
    if (explicitLanguage) speaker.language = explicitLanguage
    if (speedRatio != null) speaker.speed_ratio = speedRatio
    if (params.emotion) {
      speaker.emotion = params.emotion
      speaker.emotion_scale = emotionScale
    }
    if (Number.isFinite(loudnessRate)) speaker.loudness_ratio = loudnessRate

    const cleanText = disableMarkdownFilter
      ? params.text
      : params.text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
        .trim()

    const audioFormat = normalizeFormat(encoding)
    const payload = {
      app: {
        appid: appId,
        cluster: endpoint || '',
        token: authToken,
      },
      user: {
        uid: requestId,
      },
      audio: {
        voice_type: voice,
        encoding: audioFormat,
        sample_rate: sampleRate,
        bitrate: bitRate,
        channel: DEFAULT_CHANNELS,
        language: explicitLanguage || undefined,
      },
      request: {
        reqid: requestId,
        text: cleanText,
        operation: 'submit',
        text_type: 'plain',
        speaker,
        resource_id: resourceIdForVoice,
      },
    }

    const startConnection = createMessage(EVENT_START_CONNECTION, {
      app: {
        appid: appId,
        token: authToken,
      },
      user: {
        uid: requestId,
      },
      audio: {
        sample_rate: sampleRate,
        bitrate: bitRate,
        channel: DEFAULT_CHANNELS,
      },
      request: {
        request_id: requestId,
      },
      session: {
        session_id: sessionId,
        connect_id: connectId,
        namespace: 'BidirectionalTTS',
      },
    })

    const startSession = createMessage(EVENT_START_SESSION, {
      request_id: requestId,
      tts: payload,
    }, sessionId)

    const taskRequest = createMessage(EVENT_TASK_REQUEST, payload, sessionId)
    const finishSession = createMessage(EVENT_FINISH_SESSION, {}, sessionId)
    const finishConnection = createMessage(EVENT_FINISH_CONNECTION, {})

    const audioChunks: Buffer[] = []

    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })

      const timeout = setTimeout(() => {
        client.close()
        reject(new Error('Timed out waiting for VolcEngine TTS response'))
      }, 120_000)

      const cleanup = () => clearTimeout(timeout)

      client.on('open', () => {
        client.send(startConnection)
        client.send(startSession)
        client.send(taskRequest)
      })

      client.on('message', (chunk: WebSocket.RawData) => {
        try {
          const message = parseMessage(rawDataToBuffer(chunk))

          if (message.msgType === MSG_ERROR || message.eventType === EVENT_CONNECTION_FAILED || message.eventType === EVENT_SESSION_FAILED) {
            cleanup()
            client.close()
            reject(new Error(messagePayloadText(message) || `VolcEngine TTS error ${message.errorCode || message.eventType}`))
            return
          }

          if (message.msgType === MSG_AUDIO_ONLY_SERVER && message.payload.length) {
            audioChunks.push(message.payload)
          }

          if (message.eventType === EVENT_CONNECTION_STARTED || message.eventType === EVENT_SESSION_STARTED) {
            return
          }

          if (message.eventType === EVENT_SESSION_FINISHED || message.eventType === EVENT_TTS_ENDED) {
            client.send(finishSession)
            client.send(finishConnection)
            cleanup()
            client.close()
            resolve()
          }
        } catch (error) {
          cleanup()
          client.close()
          reject(error)
        }
      })

      client.on('error', (error: Error) => {
        cleanup()
        client.close()
        reject(error)
      })

      client.on('close', () => {
        cleanup()
      })
    })

    const audio = Buffer.concat(audioChunks)
    if (!audio.length) throw new Error('No audio data in VolcEngine TTS response')

    const format = extensionForFormat(audioFormat)
    const metadata = estimateAudioMetadata(audio, format, sampleRate, bitRate)

    return {
      audioHex: audio.toString('hex'),
      audioLength: metadata.audioLength,
      sampleRate: metadata.sampleRate,
      bitrate: metadata.bitrate,
      format,
      channel: metadata.channel,
    }
  }
}
