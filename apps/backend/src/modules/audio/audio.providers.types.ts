export interface ProviderRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

export interface AIConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  settings?: Record<string, unknown>
}

export interface TTSGenerateParams {
  text: string
  voice: string
  model?: string | null
  speed?: number | null
  emotion?: string | null
}

export interface TTSGenerateResponse {
  audioHex: string
  audioLength: number
  sampleRate: number
  bitrate: number
  format: string
  channel: number
}

export interface TTSProviderAdapter {
  provider: string
  buildGenerateRequest(config: AIConfig, params: TTSGenerateParams): ProviderRequest
  parseResponse(result: any): TTSGenerateResponse
  generate?(config: AIConfig, params: TTSGenerateParams): Promise<TTSGenerateResponse>
}
