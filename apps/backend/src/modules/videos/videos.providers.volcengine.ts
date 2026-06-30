import type {
  VideoAIConfig,
  VideoGenerateResponse,
  VideoGenerationProviderRecord,
  VideoPollResponse,
  VideoProviderAdapter,
  VideoProviderRequest,
} from './videos.providers.types'
import { joinProviderUrl } from './videos.providers.url'

export class VolcEngineVideoAdapter implements VideoProviderAdapter {
  provider = 'volcengine'

  buildGenerateRequest(config: VideoAIConfig, record: VideoGenerationProviderRecord): VideoProviderRequest {
    const model = String(record.model || config.model || '').trim()
    if (!model) throw new Error('Video model is not configured')

    const content: any[] = [{ type: 'text', text: record.prompt || '' }]

    if (record.referenceMode === 'single' && record.imageUrl) {
      content.push({ type: 'image_url', image_url: { url: record.imageUrl } })
    } else if (record.referenceMode === 'first_last') {
      if (record.firstFrameUrl) content.push({ type: 'image_url', image_url: { url: record.firstFrameUrl }, role: 'first_frame' })
      if (record.lastFrameUrl) content.push({ type: 'image_url', image_url: { url: record.lastFrameUrl }, role: 'last_frame' })
    } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
      try {
        const refs = JSON.parse(record.referenceImageUrls)
        for (const url of refs) content.push({ type: 'image_url', image_url: { url } })
      } catch {}
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', '/contents/generations/tasks'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: {
        model,
        content,
        generate_audio: true,
        ratio: record.aspectRatio || 'adaptive',
        duration: this.normalizeDuration(record.duration),
        watermark: false,
      },
    }
  }

  parseGenerateResponse(result: any): VideoGenerateResponse {
    if (result.id) return { isAsync: true, taskId: result.id }
    const videoUrl = result.video_url || result.content?.video_url || result.data?.video_url
    if (videoUrl) return { isAsync: false, videoUrl }
    throw new Error('No task_id or video_url in response')
  }

  buildPollRequest(config: VideoAIConfig, taskId: string): VideoProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', `/contents/generations/tasks/${taskId}`),
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = result.status
    if (status === 'succeeded') {
      return { status: 'completed', videoUrl: result.video_url || result.content?.video_url || result.data?.video_url }
    }
    if (status === 'failed') return { status: 'failed', error: result.error || 'Video generation failed' }
    if (status === 'pending' || status === 'queued') {
      return { status: 'pending' }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result.video_url || result.content?.video_url || result.data?.video_url || null
  }

  private normalizeDuration(duration?: number | null) {
    const parsed = Math.round(Number(duration || 5))
    if (!Number.isFinite(parsed)) return 5
    return Math.min(12, Math.max(4, parsed))
  }
}
