export const DRAMA_WORKSPACE_CONTRACT_VERSION = '2026-07-13.v1' as const

export const EPISODE_WORKSPACE_STAGES = [
  'script',
  'storyboard',
  'assets',
  'video',
  'final',
] as const

export type EpisodeWorkspaceStage = (typeof EPISODE_WORKSPACE_STAGES)[number]

export const DRAMA_REVIEW_SUBJECT_TYPES = [
  'episode_script',
  'storyboard_set',
  'episode_final',
] as const

export type DramaReviewSubjectType = (typeof DRAMA_REVIEW_SUBJECT_TYPES)[number]

export const DRAMA_REVIEW_STATUSES = [
  'pending_confirmation',
  'confirmed',
  'rework_required',
  'stale',
  'archived',
] as const

export type DramaReviewStatus = (typeof DRAMA_REVIEW_STATUSES)[number]

export interface EpisodeWorkspaceRouteContext {
  stage: EpisodeWorkspaceStage
  shot?: number | null
  asset?: number | null
  task?: number | null
  origin?: 'overview' | 'task' | 'assistant' | 'final' | 'final-gap' | string | null
}

export interface DramaReviewCheckpoint {
  subject_type: DramaReviewSubjectType
  subject_id: string
  episode_id: number
  episode_number: number
  label: string
  href: string
  version_key: string
  review_status: DramaReviewStatus
  reviewed_at: string | null
  review_note: string | null
}

export interface DramaReviewPrimaryAction {
  kind: 'confirm_script' | 'confirm_storyboard' | 'confirm_final' | 'review_project' | 'create_reviewable_output'
  title: string
  description: string
  href: string
  subject_type: DramaReviewSubjectType | null
  subject_id: string | null
}

export interface DramaReviewSummary {
  contract_version: typeof DRAMA_WORKSPACE_CONTRACT_VERSION
  primary_action: DramaReviewPrimaryAction
  review: {
    total: number
    confirmed: number
    needs_attention: number
    deliverable: boolean
    items: DramaReviewCheckpoint[]
  }
}

export interface ConfirmDramaReviewRequest {
  subject_type: DramaReviewSubjectType
  subject_id: string
  version_key: string
  note?: string
}

export interface RequireDramaReviewReworkRequest {
  subject_type: DramaReviewSubjectType
  subject_id: string
  reason_code: string
  note?: string
}

export interface DramaTaskSourceRoute {
  source_route: string
  source_stage: EpisodeWorkspaceStage
}

export type DramaProductionCandidateRole =
  | 'character_portrait'
  | 'scene_image'
  | 'first_frame'
  | 'voiceover'
  | 'shot_video'
  | 'composed_video'

export type DramaProductionQualityStatus = 'not_evaluated' | 'passed' | 'warning' | 'failed'

/**
 * The stable result emitted by media backfill. It deliberately describes a
 * reviewable candidate rather than a committed mainline asset.
 */
export interface DramaProductionCandidate {
  asset_link_id: number
  asset_id: number
  drama_id: number
  episode_id: number | null
  storyboard_id: number | null
  role: DramaProductionCandidateRole
  review_status: DramaReviewStatus
  quality_status: DramaProductionQualityStatus
  quality_reasons: Array<{ code: string; message: string; source?: string }>
  version_key: string
  source_task_id: number | null
  source_route: string
}
