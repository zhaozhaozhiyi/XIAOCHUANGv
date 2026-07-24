import { AliVideoAdapter } from "./videos.providers.ali";
import { KlingVideoAdapter } from "./videos.providers.kling";
import { MiniMaxVideoAdapter } from "./videos.providers.minimax";
import type {
  VideoProviderAdapter,
  VideoReferenceCapabilities,
} from "./videos.providers.types";
import { ViduVideoAdapter } from "./videos.providers.vidu";
import { VolcEngineVideoAdapter } from "./videos.providers.volcengine";

const videoAdapters: Record<string, VideoProviderAdapter> = {
  minimax: new MiniMaxVideoAdapter(),
  volcengine: new VolcEngineVideoAdapter(),
  vidu: new ViduVideoAdapter(),
  ali: new AliVideoAdapter(),
  kling: new KlingVideoAdapter(),
};

const referenceCapabilities: Record<string, VideoReferenceCapabilities> = {
  ali: {
    supportsStartAnchor: true,
    supportsEndAnchor: true,
    supportsMultipleIdentityRefs: false,
    supportsPrivateOrSignedUrl: true,
    supportsAudioDrivenLipSync: false,
  },
  kling: {
    supportsStartAnchor: true,
    supportsEndAnchor: true,
    supportsMultipleIdentityRefs: false,
    supportsPrivateOrSignedUrl: true,
    supportsAudioDrivenLipSync: false,
  },
  minimax: {
    supportsStartAnchor: true,
    supportsEndAnchor: true,
    supportsMultipleIdentityRefs: true,
    supportsPrivateOrSignedUrl: true,
    supportsAudioDrivenLipSync: false,
  },
  vidu: {
    supportsStartAnchor: true,
    supportsEndAnchor: true,
    supportsMultipleIdentityRefs: true,
    supportsPrivateOrSignedUrl: true,
    supportsAudioDrivenLipSync: false,
  },
  volcengine: {
    supportsStartAnchor: true,
    supportsEndAnchor: true,
    supportsMultipleIdentityRefs: true,
    supportsPrivateOrSignedUrl: true,
    supportsAudioDrivenLipSync: false,
  },
};

export function getVideoAdapter(provider: string) {
  return videoAdapters[provider.toLowerCase()] || videoAdapters.minimax;
}

export function getVideoProviderCapabilities(
  provider: string | null | undefined,
): VideoReferenceCapabilities {
  return (
    referenceCapabilities[String(provider || "").toLowerCase()] ||
    referenceCapabilities.minimax
  );
}
