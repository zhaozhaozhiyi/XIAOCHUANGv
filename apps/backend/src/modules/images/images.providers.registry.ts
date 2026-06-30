import { AliImageAdapter } from './images.providers.ali'
import { GeminiImageAdapter } from './images.providers.gemini'
import { MiniMaxImageAdapter } from './images.providers.minimax'
import { OpenAIImageAdapter } from './images.providers.openai'
import type { ImageProviderAdapter } from './images.providers.types'
import { VolcEngineImageAdapter } from './images.providers.volcengine'

const imageAdapters: Record<string, ImageProviderAdapter> = {
  minimax: new MiniMaxImageAdapter(),
  openai: new OpenAIImageAdapter(),
  gemini: new GeminiImageAdapter(),
  volcengine: new VolcEngineImageAdapter(),
  ali: new AliImageAdapter(),
  chatfire: new OpenAIImageAdapter(),
}

export function getImageAdapter(provider: string) {
  return imageAdapters[provider.toLowerCase()] || imageAdapters.minimax
}
