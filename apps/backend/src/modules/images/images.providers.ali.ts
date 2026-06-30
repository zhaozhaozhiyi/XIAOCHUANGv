import type {
  ImageAIConfig,
  ImageGenerationProviderRecord,
  ImageGenerateResponse,
  ImagePollResponse,
  ImageProviderAdapter,
  ImageProviderRequest,
} from './images.providers.types'
import { joinProviderUrl } from './images.providers.url'

export class AliImageAdapter implements ImageProviderAdapter {
  readonly provider = 'ali'

  buildGenerateRequest(config: ImageAIConfig, record: ImageGenerationProviderRecord): ImageProviderRequest {
    const model = String(record.model || config.model || '').trim()
    if (!model) throw new Error('Image model is not configured')

    return {
      url: joinProviderUrl(config.baseUrl, '/api/v1', '/services/aigc/image-generation/generation'),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: {
        model,
        input: {
          messages: [{ role: 'user', content: [{ text: record.prompt }] }],
        },
        parameters: {
          size: this.normalizeSize(record.size || '1280*1280'),
          n: 1,
          negative_prompt: '',
          prompt_extend: true,
          watermark: false,
          seed: record.referenceImages ? undefined : Math.floor(Math.random() * 2147483647),
        },
      },
    }
  }

  parseGenerateResponse(result: any): ImageGenerateResponse {
    if (result.output?.task_status === 'PENDING' && result.output?.task_id) {
      return { isAsync: true, taskId: result.output.task_id }
    }
    if (result.output?.choices?.[0]?.message?.content?.[0]?.image) {
      return { isAsync: false, imageUrl: result.output.choices[0].message.content[0].image }
    }
    throw new Error(`Unexpected Ali image response: ${JSON.stringify(result).slice(0, 200)}`)
  }

  buildPollRequest(config: ImageAIConfig, taskId: string): ImageProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v1', `/tasks/${taskId}`),
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const status = result.output?.task_status
    if (status === 'SUCCEEDED') return { status: 'completed', imageUrl: result.output?.choices?.[0]?.message?.content?.[0]?.image }
    if (status === 'FAILED') return { status: 'failed', error: result.message || 'Generation failed' }
    if (status === 'PENDING' || status === 'RUNNING') return { status: 'processing' }
    return { status: 'pending' }
  }

  extractImageBase64() {
    return null
  }

  extractImageUrl(result: any) {
    return result.output?.choices?.[0]?.message?.content?.[0]?.image || null
  }

  private normalizeSize(size: string) {
    const [w, h] = size.split('x').map(Number)
    if (w && h) {
      const aspect = w / h
      if (aspect > 1.7) return '1696*960'
      if (aspect < 0.8) return '960*1696'
      return '1280*1280'
    }
    return '1280*1280'
  }
}
