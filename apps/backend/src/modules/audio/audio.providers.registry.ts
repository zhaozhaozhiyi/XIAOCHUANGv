import { MiniMaxTTSAdapter } from './audio.providers.minimax-tts'
import type { TTSProviderAdapter } from './audio.providers.types'
import { VolcEngineTTSAdapter } from './audio.providers.volcengine-tts'

const ttsAdapters: Record<string, TTSProviderAdapter> = {
  minimax: new MiniMaxTTSAdapter(),
  volcengine: new VolcEngineTTSAdapter(),
}

export function getTTSAdapter(provider: string) {
  return ttsAdapters[provider.toLowerCase()] || ttsAdapters.minimax
}
