import type {
  VideoAIConfig,
  VideoGenerateResponse,
  VideoGenerationProviderRecord,
  VideoPollResponse,
  VideoProviderAdapter,
  VideoProviderRequest,
} from './videos.providers.types'
import { joinProviderUrl } from './videos.providers.url'

export class AliVideoAdapter implements VideoProviderAdapter {
  readonly provider = 'ali'

  buildGenerateRequest(config: VideoAIConfig, record: VideoGenerationProviderRecord): VideoProviderRequest {
    const model = String(record.model || config.model || '').trim()
    if (!model) throw new Error('Video model is not configured')

    return {
      url: joinProviderUrl(config.baseUrl, '/api/v1', '/services/aigc/video-generation/video-synthesis'),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model,
        input: {
          prompt: record.prompt,
          img_url: record.imageUrl ?? record.firstFrameUrl ?? '',
          ...(record.lastFrameUrl ? { last_img_url: record.lastFrameUrl } : {}),
        },
        parameters: {
          resolution: this.normalizeResolution(record.aspectRatio ?? '16:9'),
          duration: record.duration || 5,
          watermark: false,
          seed: Math.floor(Math.random() * 2147483647),
        },
      },
    }
  }

  parseGenerateResponse(result: any): VideoGenerateResponse {
    if (result.output?.task_status === 'PENDING' && result.output?.task_id) {
      return { isAsync: true, taskId: result.output.task_id }
    }
    if (result.output?.video_url) return { isAsync: false, videoUrl: result.output.video_url }
    throw new Error(`Unexpected Ali video response: ${JSON.stringify(result).slice(0, 200)}`)
  }

  buildPollRequest(config: VideoAIConfig, taskId: string): VideoProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v1', `/tasks/${taskId}`),
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = result.output?.task_status
    if (status === 'SUCCEEDED') return { status: 'completed', videoUrl: result.output?.video_url }
    if (status === 'FAILED') return { status: 'failed', error: result.message || 'Video generation failed' }
    if (status === 'PENDING' || status === 'RUNNING') return { status: 'processing' }
    return { status: 'pending' }
  }

  extractVideoUrl(result: any): string | null {
    return result.output?.video_url || null
  }

  private normalizeResolution(aspectRatio?: string) {
    if (aspectRatio === '9:16' || aspectRatio === '1:1') return '720P'
    return '1080P'
  }
}
