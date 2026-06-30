import { AliVideoAdapter } from './videos.providers.ali'
import { KlingVideoAdapter } from './videos.providers.kling'
import { MiniMaxVideoAdapter } from './videos.providers.minimax'
import type { VideoProviderAdapter } from './videos.providers.types'
import { ViduVideoAdapter } from './videos.providers.vidu'
import { VolcEngineVideoAdapter } from './videos.providers.volcengine'

const videoAdapters: Record<string, VideoProviderAdapter> = {
  minimax: new MiniMaxVideoAdapter(),
  volcengine: new VolcEngineVideoAdapter(),
  vidu: new ViduVideoAdapter(),
  ali: new AliVideoAdapter(),
  kling: new KlingVideoAdapter(),
}

export function getVideoAdapter(provider: string) {
  return videoAdapters[provider.toLowerCase()] || videoAdapters.minimax
}
