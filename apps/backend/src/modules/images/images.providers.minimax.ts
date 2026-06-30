import type {
  ImageAIConfig,
  ImageGenerationProviderRecord,
  ImageGenerateResponse,
  ImagePollResponse,
  ImageProviderAdapter,
  ImageProviderRequest,
} from './images.providers.types'
import { joinProviderUrl } from './images.providers.url'

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

function sizeToAspectRatio(size?: string | null) {
  if (!size) return '1:1'
  const match = String(size).match(/^(\d+)x(\d+)$/i)
  if (!match) return '1:1'
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '1:1'
  const factor = gcd(width, height)
  return `${Math.round(width / factor)}:${Math.round(height / factor)}`
}

export class MiniMaxImageAdapter implements ImageProviderAdapter {
  provider = 'minimax'

  buildGenerateRequest(config: ImageAIConfig, record: ImageGenerationProviderRecord): ImageProviderRequest {
    const body: Record<string, unknown> = {
      model: record.model || config.model,
      prompt: record.prompt,
      aspect_ratio: sizeToAspectRatio(record.size),
      response_format: 'url',
      n: 1,
    }

    if (record.referenceImages) {
      try {
        const refs = JSON.parse(record.referenceImages)
          .map((item: unknown) => String(item || '').trim())
          .filter(Boolean)
        if (refs.length > 0) {
          body.subject_reference = refs.map((imageFile: string) => ({
            type: 'character',
            image_file: imageFile,
          }))
        }
      } catch {}
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/image_generation'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenerateResponse {
    if (result.base_resp?.status_code !== undefined && result.base_resp.status_code !== 0) {
      throw new Error(result.base_resp?.status_msg || 'MiniMax image generation failed')
    }

    const imageUrls = result.data?.image_urls
    if (Array.isArray(imageUrls) && imageUrls[0]) {
      return { isAsync: false, imageUrl: String(imageUrls[0]) }
    }

    // MiniMax image API is synchronous; `id` is a trace id, not a poll task id.
    if (result.task_id) {
      return { isAsync: true, taskId: String(result.task_id) }
    }

    throw new Error('No image URL in MiniMax response')
  }

  buildPollRequest(config: ImageAIConfig, taskId: string): ImageProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/query/image_generation?task_id=${encodeURIComponent(taskId)}`),
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    if (result.base_resp?.status_code !== undefined && result.base_resp.status_code !== 0) {
      return { status: 'failed', error: result.base_resp?.status_msg || 'MiniMax poll failed' }
    }

    const imageUrls = result.data?.image_urls
    if (Array.isArray(imageUrls) && imageUrls[0]) {
      return { status: 'completed', imageUrl: String(imageUrls[0]) }
    }

    const status = result.status || result.state
    if (status === 'completed' || status === 'succeeded' || status === 'Success') {
      return {
        status: 'completed',
        imageUrl: result.image_url || result.data?.image_url || result.url || result.data?.url,
      }
    }
    if (status === 'failed' || status === 'error' || status === 'Fail') {
      return { status: 'failed', error: result.error_msg || result.error || 'Generation failed' }
    }
    if (status === 'pending' || status === 'queued' || status === 'Queueing') {
      return { status: 'pending' }
    }
    return { status: 'processing' }
  }

  extractImageUrl(result: any): string | null {
    const imageUrls = result.data?.image_urls
    if (Array.isArray(imageUrls) && imageUrls[0]) return String(imageUrls[0])
    return result.image_url || result.data?.image_url || result.url || result.data?.url || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const encoded = result.data?.image_base64?.[0] || result.data?.images?.[0]
    if (!encoded) return null
    return { data: String(encoded), mimeType: 'image/jpeg' }
  }
}
