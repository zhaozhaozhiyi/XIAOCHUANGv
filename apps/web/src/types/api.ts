export type {
  AIServiceConfig,
  AIVoice,
  AgentConfig,
  AdaptationBrief,
  AssetKind,
  AssetRecord,
  Character,
  Drama,
  DramaAiFirstStage,
  Episode,
  EpisodeBlueprintPayload,
  ImageGeneration,
  Prop,
  Scene,
  SourceAnalysis,
  SourceHealth,
  SourceTraceItem,
  Storyboard,
  TaskListPayload,
  TaskRecord,
  TaskResultSummary,
  VideoGeneration,
  WritingAiAction,
  WritingDetail,
  WritingDocumentNode,
  WritingDocumentPayload,
  WritingDocumentType,
  WritingExportFormat,
  WritingKind,
  WritingListItem,
  WritingListPayload,
  WritingStatus,
} from '@xiaochuang/contracts'

export interface EpisodeComposeStatusResponse {
  composed_videos: number
  total_storyboards: number
  completed_storyboards: number
  pending_storyboards: number
  progress_percent: number
  latest_task_id?: number | null
  items?: Array<{
    id: number
    status: string
    task_id?: number | null
    composed_video_url?: string | null
    error_message?: string | null
  }>
}

export interface EpisodeMergeStatusResponse {
  has_merge: boolean
  status: string
  merge_id?: number | null
  merged_url?: string | null
  progress?: number | null
  error_message?: string | null
}
