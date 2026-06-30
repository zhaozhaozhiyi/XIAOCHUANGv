export type ComposerToolbarMode = 'image' | 'video' | 'audio'
export type ImageResolution = '2k' | '4k'

export type ModelSelectOption = {
  label: string
  description: string
  tertiary: string
  value: string
}

export type AudioConfigOption = {
  id: number
  provider: string
  label: string
  description: string
}

export interface ComposerSubmitPayload {
  prompt: string
  image_url?: string
  first_frame_url?: string
  last_frame_url?: string
  reference_image_urls?: string[]
  voice_id?: string
  audio_speed?: number
  audio_emotion?: string
  duration: number
  aspect_ratio: string
  toolbar_mode: ComposerToolbarMode
  video_model: string
  video_reference_mode: string
  audio_config_id?: number | null
}

export interface ComposerPrefill {
  nonce: number
  prompt: string
  toolbar_mode?: ComposerToolbarMode
  aspect_ratio?: string
  video_model?: string
  image_model?: string
  audio_config_id?: number | null
}
