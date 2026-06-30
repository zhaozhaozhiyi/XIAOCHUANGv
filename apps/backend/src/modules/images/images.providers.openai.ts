import type {
  ImageAIConfig,
  ImageGenerationProviderRecord,
  ImageGenerateResponse,
  ImagePollResponse,
  ImageProviderAdapter,
  ImageProviderRequest,
} from './images.providers.types'
import { joinProviderUrl } from './images.providers.url'

export class OpenAIImageAdapter implements ImageProviderAdapter {
  provider = 'openai'

  buildGenerateRequest(config: ImageAIConfig, record: ImageGenerationProviderRecord): ImageProviderRequest {
    const model = String(record.model || config.model || '').trim()
    if (!model) throw new Error('Image model is not configured')

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: {
        model,
        prompt: record.prompt,
        size: record.size || '1024x1024',
        n: 1,
        response_format: 'url',
      },
    }
  }

  parseGenerateResponse(result: any): ImageGenerateResponse {
    if (result.task_id || result.id) return { isAsync: true, taskId: result.task_id || result.id }
    const imageUrl = result.data?.[0]?.url || result.url
    if (imageUrl) return { isAsync: false, imageUrl }
    if (result.data?.[0]?.b64_json) return { isAsync: false }
    throw new Error('No image URL in response')
  }

  buildPollRequest(config: ImageAIConfig, taskId: string): ImageProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/images/task/${taskId}`),
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const status = result.status
    if (status === 'completed' || status === 'succeeded') {
      return { status: 'completed', imageUrl: result.image_url || result.data?.[0]?.url || null }
    }
    if (status === 'failed' || status === 'error') {
      return { status: 'failed', error: result.error?.message || 'Generation failed' }
    }
    if (status === 'pending' || status === 'queued') {
      return { status: 'pending' }
    }
    return { status: 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.data?.[0]?.url || result.image_url || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const b64 = result.data?.[0]?.b64_json
    return b64 ? { data: b64, mimeType: 'image/png' } : null
  }
}
