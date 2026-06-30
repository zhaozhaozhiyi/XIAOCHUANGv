import type {
  VideoAIConfig,
  VideoGenerateResponse,
  VideoGenerationProviderRecord,
  VideoPollResponse,
  VideoProviderAdapter,
  VideoProviderRequest,
} from './videos.providers.types'
import { joinProviderUrl } from './videos.providers.url'

export class ViduVideoAdapter implements VideoProviderAdapter {
  provider = 'vidu'

  buildGenerateRequest(config: VideoAIConfig, record: VideoGenerationProviderRecord): VideoProviderRequest {
    const model = String(record.model || config.model || '').trim()
    if (!model) throw new Error('Video model is not configured')

    const body: any = {
      model,
      images: [],
      prompt: record.prompt,
    }
    if (record.referenceMode === 'single' && record.imageUrl) {
      body.images.push(record.imageUrl)
    } else if (record.referenceMode === 'first_last') {
      if (record.firstFrameUrl) body.images.push(record.firstFrameUrl)
      if (record.lastFrameUrl) body.images.push(record.lastFrameUrl)
    } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
      try {
        const refs = JSON.parse(record.referenceImageUrls)
        body.images.push(...refs)
      } catch {}
    }
    if (record.duration) body.duration = record.duration
    if (record.aspectRatio) {
      const ratioMap: Record<string, string> = { '16:9': '720p', '9:16': '720p', '1:1': '720p' }
      body.resolution = ratioMap[record.aspectRatio] || '720p'
    }

    return {
      url: joinProviderUrl(config.baseUrl, '', '/ent/v2/img2video'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenerateResponse {
    if (result.task_id) return { isAsync: true, taskId: result.task_id }
    if (result.video_url) return { isAsync: false, videoUrl: result.video_url }
    throw new Error('No task_id in Vidu response')
  }

  buildPollRequest(): VideoProviderRequest {
    return { url: 'vidu://no-polling-endpoint', method: 'GET', headers: {}, body: undefined }
  }

  parsePollResponse(): VideoPollResponse {
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result.video_url || null
  }
}
