import { parseDataUrl } from './images.storage'
import type {
  ImageAIConfig,
  ImageGenerationProviderRecord,
  ImageGenerateResponse,
  ImagePollResponse,
  ImageProviderAdapter,
  ImageProviderRequest,
} from './images.providers.types'
import { joinProviderUrl } from './images.providers.url'

export class GeminiImageAdapter implements ImageProviderAdapter {
  provider = 'gemini'

  buildGenerateRequest(config: ImageAIConfig, record: ImageGenerationProviderRecord): ImageProviderRequest {
    const modelName = String(record.model || config.model || '').trim()
    if (!modelName) throw new Error('Image model is not configured')
    const model = modelName.startsWith('models/') ? modelName : `models/${modelName}`

    const parts: any[] = []
    if (record.referenceImages) {
      try {
        const refs = JSON.parse(record.referenceImages)
        for (const ref of refs) {
          const parsed = parseDataUrl(String(ref || ''))
          if (parsed) {
            parts.push({ inline_data: { mime_type: parsed.mimeType, data: parsed.data } })
          }
        }
      } catch {}
    }
    parts.push({ text: record.prompt || '' })

    const url = new URL(joinProviderUrl(config.baseUrl, '/v1beta', `/${model}:generateContent`))
    url.searchParams.set('key', config.apiKey)

    return {
      url: url.toString(),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: {
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          imageConfig: {
            aspectRatio: this.parseAspectRatio(record.size),
            imageSize: this.parseImageSize(record.size),
          },
        },
      },
    }
  }

  parseGenerateResponse(result: any): ImageGenerateResponse {
    const firstCandidate = result?.candidates?.[0]
    const finishReason = firstCandidate?.finishReason || firstCandidate?.finish_reason
    const finishMessage = firstCandidate?.finishMessage || firstCandidate?.finish_message

    if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
      throw new Error(finishMessage || `Gemini generation stopped: ${finishReason}`)
    }
    if (this.extractImageUrl(result)) return { isAsync: false, imageUrl: this.extractImageUrl(result) || undefined }
    if (this.extractImageBase64(result)) return { isAsync: false }
    if (result.task_id || result.id) return { isAsync: true, taskId: result.task_id || result.id }
    if (result.error) throw new Error(result.error.message || 'Gemini generation failed')
    throw new Error('No image data in Gemini response')
  }

  parsePollResponse(): ImagePollResponse {
    return { status: 'completed' }
  }

  buildPollRequest(config: ImageAIConfig, taskId: string): ImageProviderRequest {
    const url = new URL(joinProviderUrl(config.baseUrl, '/v1beta', `/${taskId}`))
    url.searchParams.set('key', config.apiKey)
    return {
      url: url.toString(),
      method: 'GET',
      headers: {
        'x-goog-api-key': config.apiKey,
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  extractImageUrl(result: any): string | null {
    return result?.data?.[0]?.url || result?.image_url || result?.url || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const b64 = result?.data?.[0]?.b64_json
    if (b64) return { data: b64, mimeType: 'image/png' }
    const parts = result.candidates?.[0]?.content?.parts || []
    for (const part of parts) {
      const inline = part.inlineData || part.inline_data
      if (inline) return { data: inline.data, mimeType: inline.mimeType || inline.mime_type || 'image/png' }
    }
    return null
  }

  private parseAspectRatio(size?: string | null) {
    if (!size) return '16:9'
    const [w, h] = size.split('x').map(Number)
    if (!w || !h) return '16:9'
    const gcd = this.gcd(w, h)
    return `${w / gcd}:${h / gcd}`
  }

  private parseImageSize(size?: string | null) {
    if (!size) return '1K'
    const [w] = size.split('x').map(Number)
    if (!w) return '1K'
    if (w >= 2048) return '4K'
    if (w >= 1024) return '2K'
    if (w >= 512) return '1K'
    return '512'
  }

  private gcd(a: number, b: number): number {
    return b === 0 ? a : this.gcd(b, a % b)
  }
}
