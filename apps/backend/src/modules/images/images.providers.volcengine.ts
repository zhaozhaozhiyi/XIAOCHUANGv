import type {
  ImageAIConfig,
  ImageGenerationProviderRecord,
  ImageGenerateResponse,
  ImagePollResponse,
  ImageProviderAdapter,
  ImageProviderRequest,
} from './images.providers.types'
import { joinProviderUrl } from './images.providers.url'

export class VolcEngineImageAdapter implements ImageProviderAdapter {
  provider = 'volcengine'

  buildGenerateRequest(config: ImageAIConfig, record: ImageGenerationProviderRecord): ImageProviderRequest {
    const model = String(record.model || config.model || '').trim()
    if (!model) throw new Error('Image model is not configured')

    const body: any = {
      model,
      prompt: record.prompt,
    }
    if (record.referenceImages) {
      try {
        const refs = JSON.parse(record.referenceImages)
          .map((item: unknown) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 6)
        if (refs.length) {
          body.image = refs.length === 1 ? refs[0] : refs
          body.reference_images = refs
        }
      } catch {}
    }
    if (record.size) {
      const [w, h] = record.size.split('x')
      if (w && h) {
        body.width = parseInt(w)
        body.height = parseInt(h)
      }
    }
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', '/images/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenerateResponse {
    if (result.task_id || result.id) return { isAsync: true, taskId: result.task_id || result.id }
    const imageUrl = result.data?.[0]?.url || result.url
    if (imageUrl) return { isAsync: false, imageUrl }
    throw new Error('No image URL in response')
  }

  buildPollRequest(config: ImageAIConfig, taskId: string): ImageProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', `/images/generations/${taskId}`),
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const status = result.status
    if (status === 'succeeded') return { status: 'completed', imageUrl: result.data?.[0]?.url || result.image_url }
    if (status === 'failed') return { status: 'failed', error: result.error || 'Generation failed' }
    if (status === 'pending' || status === 'queued') {
      return { status: 'pending' }
    }
    return { status: 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.data?.[0]?.url || result.image_url || null
  }

  extractImageBase64(): { data: string; mimeType: string } | null {
    return null
  }
}
