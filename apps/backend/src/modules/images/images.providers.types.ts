export interface ImageProviderRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

export interface ImageAIConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  settings?: Record<string, unknown>
}

export interface ImageGenerationProviderRecord {
  id: number
  model?: string | null
  prompt?: string | null
  size?: string | null
  frameType?: string | null
  referenceImages?: string | null
}

export interface ImageGenerateResponse {
  isAsync: boolean
  taskId?: string
  imageUrl?: string
}

export interface ImagePollResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  imageUrl?: string
  error?: string
}

export interface ImageProviderAdapter {
  provider: string
  buildGenerateRequest(config: ImageAIConfig, record: ImageGenerationProviderRecord): ImageProviderRequest
  parseGenerateResponse(result: any): ImageGenerateResponse
  buildPollRequest(config: ImageAIConfig, taskId: string): ImageProviderRequest
  parsePollResponse(result: any): ImagePollResponse
  extractImageUrl(result: any): string | null
  extractImageBase64(result: any): { data: string; mimeType: string } | null
}
