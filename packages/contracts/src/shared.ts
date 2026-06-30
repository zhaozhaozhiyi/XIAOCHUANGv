export interface Drama {
  id: number
  title: string
  description: string | null
  genre: string | null
  style: string | null
  total_episodes: number
  total_duration: number | null
  status: string
  thumbnail: string | null
  tags: string | null
  metadata: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  episode_count?: number
  character_count?: number
  scene_count?: number
  script_progress_percent?: number
  read_only?: boolean
  episodes?: Episode[]
  characters?: Character[]
  scenes?: Scene[]
  props?: Prop[]
}

export interface Episode {
  id: number
  drama_id: number
  episode_number: number
  title: string | null
  content: string | null
  script_content: string | null
  description: string | null
  duration: number | null
  status: string
  video_url: string | null
  thumbnail: string | null
  image_config_id: number | null
  video_config_id: number | null
  audio_config_id: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Character {
  id: number
  drama_id: number
  name: string
  role: string | null
  description: string | null
  appearance: string | null
  personality: string | null
  voice_style: string | null
  image_url: string | null
  reference_images: string | null
  seed_value: number | null
  sort_order: number
  voice_sample_url: string | null
  voice_provider: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Scene {
  id: number
  drama_id: number
  episode_id: number | null
  location: string | null
  time: string | null
  prompt: string | null
  storyboard_count: number
  image_url: string | null
  status: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Storyboard {
  id: number
  episode_id: number
  scene_id: number | null
  storyboard_number: number
  title: string | null
  location: string | null
  time: string | null
  shot_type: string | null
  angle: string | null
  movement: string | null
  action: string | null
  result: string | null
  atmosphere: string | null
  image_prompt: string | null
  video_prompt: string | null
  bgm_prompt: string | null
  sound_effect: string | null
  dialogue: string | null
  description: string | null
  duration: number | null
  composed_image: string | null
  first_frame_image: string | null
  last_frame_image: string | null
  reference_images: string | null
  video_url: string | null
  tts_audio_url: string | null
  subtitle_url: string | null
  composed_video_url: string | null
  status: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  characters?: Character[]
}

export interface AIServiceConfig {
  id: number
  user_id?: number | null
  service_type: string
  provider: string
  name: string
  description: string
  base_url: string
  api_key: string
  model: string
  endpoint: string | null
  query_endpoint: string | null
  priority: number
  is_default: number
  is_active: number
  settings: string | null
  created_at: string
  updated_at: string
}

export interface AgentConfig {
  id: number
  agent_type: string
  name: string
  description: string | null
  model: string | null
  system_prompt: string | null
  temperature: number | null
  max_tokens: number | null
  max_iterations: number | null
  is_active: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface AIVoice {
  id: number
  voice_id: string
  voice_name: string
  description: string | null
  language: string | null
  provider: string
  created_at: string
}

export interface Prop {
  id: number
  drama_id: number
  name: string
  type: string | null
  description: string | null
  prompt: string | null
  image_url: string | null
  reference_images: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface TaskResultSummary {
  video_url?: string | null
  image_url?: string | null
  audio_url?: string | null
  provider_url?: string | null
  width?: number | null
  height?: number | null
  duration?: number | null
}

export interface TaskRecord {
  id: number
  type: string
  status: string
  title: string | null
  progress: number | null
  source_type: string
  drama_id: number | null
  episode_id: number | null
  storyboard_id: number | null
  ai_config_id: number | null
  domain_table: string
  domain_id: number
  provider_task_id: string | null
  attempt_count: number | null
  locked_by: string | null
  locked_at: string | null
  lock_expires_at: string | null
  payload: Record<string, unknown> | null
  result_summary: TaskResultSummary | null
  error_kind: string | null
  error_message: string | null
  error_details: Record<string, unknown> | null
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  deleted_at: string | null
  domain?: Record<string, unknown> | null
}

export interface TaskListPayload {
  items: TaskRecord[]
  total: number
  page: number
  page_size: number
}

export interface ImageGeneration {
  id: number
  storyboard_id: number | null
  drama_id: number | null
  scene_id: number | null
  character_id: number | null
  prop_id: number | null
  image_type: string | null
  frame_type: string | null
  provider: string | null
  prompt: string | null
  model: string | null
  size: string | null
  image_url: string | null
  status: string
  task_id: string | null
  error_msg: string | null
  width: number | null
  height: number | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface VideoGeneration {
  id: number
  storyboard_id: number | null
  drama_id: number | null
  provider: string | null
  prompt: string | null
  model: string | null
  reference_mode: string | null
  duration: number | null
  aspect_ratio: string | null
  video_url: string | null
  status: string
  task_id: string | null
  error_msg: string | null
  width: number | null
  height: number | null
  created_at: string
  updated_at: string
  completed_at: string | null
  deleted_at: string | null
}

export type AssetKind = 'video' | 'image' | 'audio'

export interface AssetRecord {
  id: number
  kind: AssetKind
  title: string
  provider: string | null
  mime_type: string | null
  source_type: string
  source_id: number | null
  source_path: string | null
  drama_id: number | null
  episode_id: number | null
  storyboard_id: number | null
  task_id: number | null
  image_generation_id: number | null
  video_generation_id: number | null
  url: string | null
  thumbnail_url: string | null
  metadata_json: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type WritingKind = 'novel' | 'screenplay' | 'outline'
export type WritingStatus = 'draft' | 'active' | 'archived'
export type WritingDocumentType = 'root' | 'chapter' | 'scene' | 'note' | 'brief' | 'summary' | 'outline'
export type WritingExportFormat = 'md'
export type WritingAiAction = 'continue' | 'polish' | 'summarize' | 'extract_outline'

export interface WritingListItem {
  id: number
  title: string
  kind: WritingKind
  status: WritingStatus
  synopsis: string | null
  updated_at: string
  document_count: number
  current_document_id: number | null
}

export interface WritingDocumentNode {
  id: number
  parent_id: number | null
  title: string
  document_type: WritingDocumentType
  sort_order: number
  summary?: string | null
  updated_at: string
}

export interface WritingDetail {
  id: number
  title: string
  kind: WritingKind
  status: WritingStatus
  synopsis: string | null
  outline_json: string | null
  brief_json: string | null
  current_document_id: number | null
  updated_at: string
  created_at: string
  documents: WritingDocumentNode[]
}

export interface WritingDocumentPayload {
  id: number
  writing_id: number
  parent_id: number | null
  title: string
  document_type: WritingDocumentType
  sort_order: number
  content_md: string
  summary: string | null
  word_count: number | null
  updated_at: string
  created_at: string
}

export type WritingObjectHistoryKind = 'brief' | 'outline' | 'summary'

export interface WritingObjectHistory {
  id: number
  writing_id: number
  object_kind: WritingObjectHistoryKind
  document_id: number | null
  snapshot_title: string | null
  content: string
  source_proposal_id: number | null
  source_run_id: number | null
  created_at: string
}

export type WritingProposalStatus = 'pending' | 'applied' | 'rejected'
export type WritingKnowledgeCardType = 'character' | 'setting' | 'worldview' | 'term' | 'plotline' | 'foreshadowing'

export interface WritingKnowledgeCard {
  id: number
  writing_id: number
  proposal_id: number | null
  source_run_id: number | null
  source_proposal_title: string | null
  source_proposal_kind: string | null
  card_type: WritingKnowledgeCardType
  title: string
  content: string
  evidence: Array<{ kind: string; title: string; reason?: string; document_id?: number }>
  created_at: string
  updated_at: string
}

export interface WritingKnowledgeCardHistory {
  id: number
  writing_id: number
  knowledge_card_id: number
  card_type: WritingKnowledgeCardType
  title: string
  content: string
  evidence: Array<{ kind: string; title: string; reason?: string; document_id?: number }>
  source_proposal_id: number | null
  source_run_id: number | null
  created_at: string
}


export interface WritingProposal {
  id: number
  writing_id: number
  source_run_id: number | null
  proposal_kind: string
  target_kind: string
  target_document_id: number | null
  title: string
  content: string
  structured?: { issues?: Array<{ title: string; evidence?: string[]; suggested_fix?: string[]; target_object?: string | null; severity?: 'low' | 'medium' | 'high' | null; recommended_action?: string | null }> } | null
  references: Array<{ kind: string; title: string; reason?: string; document_id?: number }>
  status: WritingProposalStatus
  created_at: string
  updated_at: string
  applied_at: string | null
  rejected_at: string | null
}

export interface WritingReferenceEdge {
  type: 'proposal' | 'knowledge_card' | 'object_history' | 'knowledge_history' | 'document'
  id: number
  title: string
  relation: string
  target_document_id?: number | null
  target_object_kind?: 'brief' | 'outline' | 'summary' | null
  source_proposal_id?: number | null
}

export interface WritingReferenceNetwork {
  proposals: WritingReferenceEdge[]
  knowledge_cards: WritingReferenceEdge[]
  object_histories: WritingReferenceEdge[]
  knowledge_histories: WritingReferenceEdge[]
  documents: WritingReferenceEdge[]
}

export interface WritingProposalImpact {
  proposal: { id: number; title: string; proposal_kind: string; target_kind: string; target_document_id: number | null; content: string }
  briefs: Array<{ title: string; diff_preview?: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
  outlines: Array<{ title: string; diff_preview?: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
  summaries: Array<{ id: number; title: string; diff_preview?: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
  documents: Array<{ id: number; title: string; relation: string; diff_preview?: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
  knowledge_cards: Array<{ id: number; title: string; relation: string; diff_preview?: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
  object_histories: Array<{ id: number; title: string; relation: string }>
  knowledge_histories: Array<{ id: number; title: string; relation: string }>
  counts: { briefs: number; outlines: number; summaries: number; documents: number; knowledge_cards: number; object_histories: number; knowledge_histories: number }
}


export interface WritingBatchPlanConflict {
  key: string
  target_kind: string
  target_document_id: number | null
  proposal_ids: number[]
  proposal_titles: string[]
  severity: 'warning' | 'blocking'
  reason: string
}

export interface WritingBatchPlanGroup {
  key: string
  label: string
  proposal_ids: number[]
}

export interface WritingBatchPlan {
  proposal_ids: number[]
  recommended_proposal_ids: number[]
  ordered_impacts: WritingProposalImpact[]
  groups: WritingBatchPlanGroup[]
  conflicts: WritingBatchPlanConflict[]
  counts: { briefs: number; outlines: number; summaries: number; documents: number; knowledge_cards: number; object_histories: number; knowledge_histories: number }
  can_apply: boolean
}


export interface WritingBatchApplyResultItem {
  proposal_id: number
  title: string
  status: 'applied' | 'skipped' | 'failed'
  error?: string
}

export interface WritingBatchApplyResult {
  applied: number
  stopped_at: number | null
  results: WritingBatchApplyResultItem[]
  blocked_by_conflict?: boolean
}


export interface WritingBatchExecutionDetail {
  id: number
  writing_id: number
  proposal_ids: number[]
  recommended_proposal_ids: number[]
  results: Array<Record<string, unknown>>
  rollback_items: Array<Record<string, unknown>>
  applied_count: number
  stopped_at_proposal_id: number | null
  blocked_by_conflict: boolean
  created_at: string
}

export interface WritingBatchRollbackPreview {
  execution_id: number
  items: Array<{ kind: string; label: string; target_id?: number | null; proposal_id?: number | null }>
}

export interface WritingListPayload {
  items: WritingListItem[]
  pagination: { page: number; page_size: number; total: number }
}

export interface AdminUser {
  id: number
  adminUserId?: string | null
  accountType?: string
  email: string | null
  phone?: string | null
  displayName: string
  role: string
  status?: string
}

export type JsonValuePayload =
  | string
  | number
  | boolean
  | null
  | JsonObjectPayload
  | JsonValuePayload[]

export interface JsonObjectPayload {
  [key: string]: JsonValuePayload
}

export interface AiRuntimeReferenceItem {
  kind: string
  title: string
  reason?: string
  document_id?: number
  writing_id?: number
  target_id?: number
  knowledge_card_id?: number
  metadata?: JsonObjectPayload | null
}

export interface AiRuntimeApplyResultPayload {
  type: string
  success?: boolean
  message?: string
  target_id?: number | null
  document_id?: number | null
  proposal_id?: number | null
  knowledge_card_id?: number | null
  metadata?: JsonObjectPayload | null
}

export interface AiRuntimeActionItem {
  type: string
  title?: string
  description?: string
  content?: string
  evidence?: AiRuntimeReferenceItem[]
  structured?: JsonObjectPayload | null
  applied?: boolean
  applied_at?: string
  apply_result?: AiRuntimeApplyResultPayload
  [key: string]: unknown
}
