export type StoryboardSaveInput = {
  shot_number: number
  title?: string
  shot_type?: string
  angle?: string
  movement?: string
  location?: string
  time?: string
  action?: string
  dialogue?: string
  description?: string
  result?: string
  atmosphere?: string
  image_prompt?: string
  video_prompt?: string
  bgm_prompt?: string
  sound_effect?: string
  duration?: number
  scene_id?: number | null
  character_ids?: number[]
}
