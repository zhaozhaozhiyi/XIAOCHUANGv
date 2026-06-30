import { klingAuthHeaders, readKlingSecretKey } from './kling-auth'
import type {
  VideoAIConfig,
  VideoGenerateResponse,
  VideoGenerationProviderRecord,
  VideoPollResponse,
  VideoProviderAdapter,
  VideoProviderRequest,
} from './videos.providers.types'
import { joinProviderUrl } from './videos.providers.url'

export class KlingVideoAdapter implements VideoProviderAdapter {
  readonly provider = 'kling'

  private authHeaders(config: VideoAIConfig) {
    const accessKey = String(config.apiKey || '').trim()
    const secretKey = readKlingSecretKey(config.settings)
    if (!accessKey || !secretKey) {
      throw new Error('Kling 需要 API Key（Access Key）与 settings.secretKey（Secret Key）')
    }
    return klingAuthHeaders(accessKey, secretKey)
  }

  buildGenerateRequest(config: VideoAIConfig, record: VideoGenerationProviderRecord): VideoProviderRequest {
    const modelName = String(record.model || config.model || 'kling-v2-6').trim()
    if (!modelName) throw new Error('Video model is not configured')

    const imageUrl = record.imageUrl ?? record.firstFrameUrl ?? ''
    if (!imageUrl) throw new Error('Kling 图生视频需要参考图片 URL')

    const body: Record<string, unknown> = {
      model_name: modelName,
      image: imageUrl,
      duration: String(this.normalizeDuration(record.duration)),
      mode: String(config.settings?.mode || 'std'),
    }

    const prompt = String(record.prompt || '').trim()
    if (prompt) body.prompt = prompt

    if (record.referenceMode === 'first_last' && record.lastFrameUrl) {
      body.image_tail = record.lastFrameUrl
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/videos/image2video'),
      method: 'POST',
      headers: this.authHeaders(config),
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenerateResponse {
    const data = result?.data
    if (data?.task_id) return { isAsync: true, taskId: String(data.task_id) }
    const videoUrl = data?.task_result?.videos?.[0]?.url
    if (videoUrl) return { isAsync: false, videoUrl: String(videoUrl) }
    throw new Error(`Unexpected Kling video response: ${JSON.stringify(result).slice(0, 200)}`)
  }

  buildPollRequest(config: VideoAIConfig, taskId: string): VideoProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/videos/image2video/${taskId}`),
      method: 'GET',
      headers: this.authHeaders(config),
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const data = result?.data
    const status = String(data?.task_status || '').toLowerCase()
    if (status === 'succeed') {
      const videoUrl = data?.task_result?.videos?.[0]?.url
      return videoUrl
        ? { status: 'completed', videoUrl: String(videoUrl) }
        : { status: 'failed', error: 'Task succeeded but no video URL returned' }
    }
    if (status === 'failed') {
      return { status: 'failed', error: data?.task_status_msg || 'Video generation failed' }
    }
    if (status === 'submitted' || status === 'processing') return { status: 'processing' }
    return { status: 'pending' }
  }

  extractVideoUrl(result: any): string | null {
    const url = result?.data?.task_result?.videos?.[0]?.url
    return url ? String(url) : null
  }

  private normalizeDuration(duration?: number | null) {
    const parsed = Math.round(Number(duration || 5))
    if (!Number.isFinite(parsed)) return 5
    return parsed >= 10 ? 10 : 5
  }
}
