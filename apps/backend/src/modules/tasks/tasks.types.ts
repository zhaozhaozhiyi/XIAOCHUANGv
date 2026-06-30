export type TaskActionResponse = {
  task_id?: number | null
  image_generation_id?: number
  video_generation_id?: number
  storyboard_id?: number
  merge_id?: number
  status?: string
  canceled?: boolean
}
