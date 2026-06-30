import type { AIConfig, ProviderRequest, TTSGenerateParams, TTSGenerateResponse, TTSProviderAdapter } from './audio.providers.types'
import { joinProviderUrl } from './audio.providers.url'

export class MiniMaxTTSAdapter implements TTSProviderAdapter {
  readonly provider = 'minimax'

  buildGenerateRequest(config: AIConfig, params: TTSGenerateParams): ProviderRequest {
    const model = String(params.model || config.model || '').trim()
    if (!model) throw new Error('Audio model is not configured')

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/t2a_v2'),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model,
        text: params.text,
        stream: false,
        voice_setting: {
          voice_id: params.voice,
          speed: params.speed ?? 1,
          vol: 1,
          pitch: 0,
          emotion: params.emotion || 'happy',
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
        subtitle_enable: false,
      },
    }
  }

  parseResponse(result: any): TTSGenerateResponse {
    if (result.base_resp?.status_code !== 0) {
      throw new Error(result.base_resp?.status_msg || 'TTS generation failed')
    }

    const data = result.data
    if (!data?.audio) {
      throw new Error('No audio data in response')
    }

    return {
      audioHex: data.audio,
      audioLength: data.extra_info?.audio_length || 0,
      sampleRate: data.extra_info?.audio_sample_rate || 32000,
      bitrate: data.extra_info?.bitrate || 128000,
      format: data.extra_info?.audio_format || 'mp3',
      channel: data.extra_info?.audio_channel || 1,
    }
  }
}
