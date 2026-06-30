import type {
  VideoAIConfig,
  VideoGenerateResponse,
  VideoGenerationProviderRecord,
  VideoPollResponse,
  VideoProviderAdapter,
  VideoProviderRequest,
} from './videos.providers.types'
import { joinProviderUrl } from './videos.providers.url'

export class MiniMaxVideoAdapter implements VideoProviderAdapter {
  provider = 'minimax'

  buildGenerateRequest(config: VideoAIConfig, record: VideoGenerationProviderRecord): VideoProviderRequest {
    const model = String(record.model || config.model || '').trim()
    if (!model) throw new Error('Video model is not configured')

    let promptText = record.prompt || ''
    promptText += `  --ratio ${record.aspectRatio || '16:9'}  --dur ${record.duration || 5}`
    const content: any[] = [{ type: 'text', text: promptText }]

    if (record.referenceMode === 'single' && record.imageUrl) {
      content.push({ type: 'image_url', image_url: { url: record.imageUrl }, role: 'reference_image' })
    } else if (record.referenceMode === 'first_last') {
      if (record.firstFrameUrl) content.push({ type: 'image_url', image_url: { url: record.firstFrameUrl }, role: 'first_frame' })
      if (record.lastFrameUrl) content.push({ type: 'image_url', image_url: { url: record.lastFrameUrl }, role: 'last_frame' })
    } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
      try {
        const refs = JSON.parse(record.referenceImageUrls)
        for (const url of refs) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
      } catch {}
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/video_generation'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: { model, content },
    }
  }

  parseGenerateResponse(result: any): VideoGenerateResponse {
    const taskId = result.task_id || result.id || result.data?.id
    if (!taskId) {
      const videoUrl = result.video_url || result.data?.video_url || result.content?.video_url
      if (videoUrl) return { isAsync: false, videoUrl }
      throw new Error('No task_id or video_url in response')
    }
    return { isAsync: true, taskId }
  }

  buildPollRequest(config: VideoAIConfig, taskId: string): VideoProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/video_generation/task/${taskId}`),
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = result.status || result.state || result.data?.status
    if (status === 'completed' || status === 'succeeded') {
      return { status: 'completed', videoUrl: result.video_url || result.data?.video_url || result.content?.video_url }
    }
    if (status === 'failed' || status === 'error') {
      return { status: 'failed', error: result.error_msg || result.error || 'Video generation failed' }
    }
    if (status === 'pending' || status === 'queued') {
      return { status: 'pending' }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result.video_url || result.data?.video_url || result.content?.video_url || null
  }
}
