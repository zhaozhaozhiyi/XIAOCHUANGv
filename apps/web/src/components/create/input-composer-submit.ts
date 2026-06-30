import type { ComposerSubmitPayload, ComposerToolbarMode } from '@/components/create/input-composer-types'

interface BuildComposerSubmitPayloadInput {
  prompt: string
  pastedImageUrls: string[]
  imageUrl: string
  firstFrameUrl: string
  lastFrameUrl: string
  referenceImagesText: string
  selectedVoiceId: string
  audioSpeed: number
  audioEmotion: string
  duration: number | string
  aspectRatio: string | number
  imageAspectRatio: string
  toolbarMode: ComposerToolbarMode
  imageModel: string
  videoModel: string
  videoReferenceMode: string
  isFirstLastFrameMode: boolean
  audioConfigId: number | null
}

export function validateComposerSubmit(input: Pick<BuildComposerSubmitPayloadInput, 'prompt' | 'toolbarMode'>) {
  const normalizedPrompt = input.prompt.trim()
  if (normalizedPrompt) return null
  return input.toolbarMode === 'audio' ? '请先输入要转换的文字' : '请先输入生成描述'
}

export function buildComposerSubmitPayload(input: BuildComposerSubmitPayloadInput): ComposerSubmitPayload {
  const normalizedPrompt = input.prompt.trim()
  const mergedPastedUrls = input.pastedImageUrls.filter(Boolean)
  const fallbackImageUrl = input.isFirstLastFrameMode
    ? undefined
    : input.imageUrl.trim() || mergedPastedUrls[0] || undefined
  const referenceImageUrls = input.referenceImagesText
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .concat(mergedPastedUrls)

  return {
    prompt: normalizedPrompt,
    image_url: fallbackImageUrl,
    first_frame_url: input.isFirstLastFrameMode ? input.firstFrameUrl.trim() || undefined : undefined,
    last_frame_url: input.isFirstLastFrameMode ? input.lastFrameUrl.trim() || undefined : undefined,
    reference_image_urls: input.isFirstLastFrameMode ? undefined : (referenceImageUrls.length ? referenceImageUrls : undefined),
    voice_id: input.toolbarMode === 'audio' ? input.selectedVoiceId || undefined : undefined,
    audio_speed: input.toolbarMode === 'audio' ? input.audioSpeed : undefined,
    audio_emotion: input.toolbarMode === 'audio' ? input.audioEmotion || undefined : undefined,
    audio_config_id: input.toolbarMode === 'audio' ? input.audioConfigId ?? undefined : undefined,
    duration: Number(input.duration),
    aspect_ratio: input.toolbarMode === 'image' ? input.imageAspectRatio : String(input.aspectRatio),
    toolbar_mode: input.toolbarMode,
    video_model: input.toolbarMode === 'image' ? input.imageModel : input.videoModel,
    video_reference_mode: input.videoReferenceMode,
  }
}
