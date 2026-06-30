export type ProposalStructured = {
  summary?: string
  reasons?: string[]
  risks?: string[]
  expected_effects?: string[]
  issues?: Array<{
    title?: string
    evidence?: string[]
    suggested_fix?: string[]
    target_object?: string | null
    severity?: 'low' | 'medium' | 'high' | null
    recommended_action?: string | null
  }>
} | null
export type BriefState = {
  worldview: string
  background: string
  main_plot: string
  core_conflict: string
  main_characters: string
}

export type KnowledgeCardItem = {
  id: number
  writing_id: number
  proposal_id: number | null
  card_type: 'character' | 'setting' | 'worldview' | 'term' | 'plotline' | 'foreshadowing'
  title: string
  content: string
  evidence: Array<{ kind: string; title: string; reason?: string; document_id?: number }>
  created_at: string
  updated_at: string
}

export type ProposalItem = {
  id: number
  writing_id: number
  source_run_id: number | null
  proposal_kind: string
  target_kind: string
  target_document_id: number | null
  title: string
  content: string
  structured: ProposalStructured
  references: Array<{ kind?: string; title?: string; reason?: string; document_id?: number }>
  status: 'pending' | 'applied' | 'rejected'
  created_at: string
  updated_at: string
  applied_at: string | null
  rejected_at: string | null
}

export type BatchPlan = {
  proposal_ids: number[]
  recommended_proposal_ids: number[]
  groups: Array<{ key: string; label: string; proposal_ids: number[] }>
  conflicts: Array<{
    key: string
    target_kind: string
    target_document_id: number | null
    proposal_ids: number[]
    proposal_titles: string[]
    severity: 'warning' | 'blocking'
    reason: string
  }>
  counts: {
    briefs: number
    outlines: number
    summaries: number
    documents: number
    knowledge_cards: number
    object_histories: number
    knowledge_histories: number
  }
  can_apply: boolean
}

export type BatchExecutionItem = {
  id: number
  writing_id: number
  proposal_ids: number[]
  recommended_proposal_ids: number[]
  applied_count: number
  stopped_at_proposal_id: number | null
  blocked_by_conflict: boolean
  note: string | null
  tag: string | null
  is_pinned?: boolean
  is_important?: boolean
  created_at: string
}

export type BatchExecutionDetail = BatchExecutionItem & {
  results: Array<{ proposal_id: number; title: string; status: 'applied' | 'skipped' | 'failed'; error?: string }>
  rollback_items: Array<Record<string, unknown>>
  diff_preview: Array<{ proposal_id: number; title: string; diff_lines: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
}

export type RollbackPreview = {
  execution_id: number
  items: Array<{ kind: string; title: string; target: string; proposal_id: number | null }>
}


export type ReferenceNode = {
  type: 'proposal' | 'knowledge_card' | 'object_history' | 'knowledge_history' | 'document'
  id: number
  title: string
  relation: string
  target_document_id?: number
  target_object_kind?: 'brief' | 'outline' | 'summary'
  source_proposal_id?: number | null
}

export type ReferenceNetwork = {
  proposals: ReferenceNode[]
  knowledge_cards: ReferenceNode[]
  object_histories: ReferenceNode[]
  knowledge_histories: ReferenceNode[]
  documents: ReferenceNode[]
}

export type ObjectHistoryItem = {
  id: number
  writing_id: number
  object_kind: string
  document_id: number | null
  snapshot_title: string | null
  content: string
  source_proposal_id: number | null
  source_run_id: number | null
  created_at: string
}

export type ObjectHistoryPreview = {
  history_id: number
  object_kind: string
  snapshot_title: string | null
  history_content: string
  current_content: string
  diff_lines: Array<{ type: 'same' | 'added' | 'removed'; text: string }>
}

export type KnowledgeHistoryItem = {
  id: number
  writing_id: number
  knowledge_card_id: number
  card_type: string
  title: string
  content: string
  evidence: Array<{ kind?: string; title?: string; reason?: string; document_id?: number }>
  source_proposal_id: number | null
  source_run_id: number | null
  created_at: string
}


export type ProposalImpact = {
  proposal: {
    id: number
    title: string
    proposal_kind: string
    target_kind: string
    target_document_id: number | null
    content: string
  }
  briefs: Array<{ title: string; diff_preview: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
  outlines: Array<{ title: string; diff_preview: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
  summaries: Array<{ id: number; title: string; diff_preview: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
  documents: Array<{ id: number; title: string; relation: string; diff_preview: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
  knowledge_cards: Array<{ id: number; title: string; relation: string; diff_preview: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }>
  object_histories: Array<{ id: number; title: string; relation: string }>
  knowledge_histories: Array<{ id: number; title: string; relation: string }>
  counts: {
    briefs: number
    outlines: number
    summaries: number
    documents: number
    knowledge_cards: number
    object_histories: number
    knowledge_histories: number
  }
}

