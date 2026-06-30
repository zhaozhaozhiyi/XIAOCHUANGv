export interface VideoProviderRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

export interface VideoAIConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  settings?: Record<string, unknown>
}

export interface VideoGenerationProviderRecord {
  id: number
  model?: string | null
  prompt?: string | null
  referenceMode?: string | null
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string | null
  duration?: number | null
  aspectRatio?: string | null
}

export interface VideoGenerateResponse {
  isAsync: boolean
  taskId?: string
  videoUrl?: string
}

export interface VideoPollResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
}

export interface VideoProviderAdapter {
  provider: string
  buildGenerateRequest(config: VideoAIConfig, record: VideoGenerationProviderRecord): VideoProviderRequest
  parseGenerateResponse(result: any): VideoGenerateResponse
  buildPollRequest(config: VideoAIConfig, taskId: string): VideoProviderRequest
  parsePollResponse(result: any): VideoPollResponse
  extractVideoUrl(result: any): string | null
}
