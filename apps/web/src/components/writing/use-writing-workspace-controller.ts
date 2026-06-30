import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { BatchExecutionDetail, BatchExecutionItem, BatchPlan, BriefState, KnowledgeCardItem, RollbackPreview } from '@/components/writing/types'
import { writingAPI } from '@/lib/api'
import type { WritingDetail } from '@/types/api'

function parseBriefJson(value: string | null): BriefState {
  const fallback: BriefState = {
    worldview: '',
    background: '',
    main_plot: '',
    core_conflict: '',
    main_characters: '',
  }
  if (!value) return fallback
  try {
    return { ...fallback, ...(JSON.parse(value) as Partial<BriefState>) }
  } catch {
    return fallback
  }
}

export function parseStructuredOutline(value: string | null | undefined) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as {
      premise?: string
      arcs?: Array<{ title?: string; goal?: string; conflict?: string; turning_points?: string[]; chapters?: string[] }>
      open_questions?: string[]
    }
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

type Args = {
  writingId: number
}

export function useWritingWorkspaceController({ writingId }: Args) {
  const [detailLoading, setDetailLoading] = useState(true)
  const [detail, setDetail] = useState<WritingDetail | null>(null)
  const [briefDraft, setBriefDraft] = useState<BriefState>(parseBriefJson(null))
  const [briefDirty, setBriefDirty] = useState(false)
  const [briefSaving, setBriefSaving] = useState(false)
  const [briefStructuredPreview, setBriefStructuredPreview] = useState<Record<string, unknown> | null>(null)
  const [outlineStructuredPreview, setOutlineStructuredPreview] = useState<Record<string, unknown> | null>(null)

  const [docLoading, setDocLoading] = useState(false)
  const [activeDocId, setActiveDocId] = useState<number | null>(null)
  const [docTitle, setDocTitle] = useState('')
  const [contentMd, setContentMd] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingDocId, setPendingDocId] = useState<number | null>(null)

  const [knowledgeCards, setKnowledgeCards] = useState<KnowledgeCardItem[]>([])
  const [knowledgeLoading, setKnowledgeLoading] = useState(false)

  const [proposals, setProposals] = useState<any[]>([])
  const [highlightedProposalId, setHighlightedProposalId] = useState<number | null>(null)
  const [proposalImpactLoading, setProposalImpactLoading] = useState(false)
  const [highlightedProposalImpact, setHighlightedProposalImpact] = useState<any | null>(null)
  const [proposalLoading, setProposalLoading] = useState(false)
  const [selectedProposalIds, setSelectedProposalIds] = useState<number[]>([])
  const [batchPlanning, setBatchPlanning] = useState(false)
  const [batchPlan, setBatchPlan] = useState<BatchPlan | null>(null)
  const [batchApplying, setBatchApplying] = useState(false)
  const [executions, setExecutions] = useState<BatchExecutionItem[]>([])
  const [executionsLoading, setExecutionsLoading] = useState(false)
  const [selectedExecutionId, setSelectedExecutionId] = useState<number | null>(null)
  const [executionDetail, setExecutionDetail] = useState<BatchExecutionDetail | null>(null)
  const [executionDetailLoading, setExecutionDetailLoading] = useState(false)
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null)
  const [rollbackPreviewLoading, setRollbackPreviewLoading] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)

  const loadDetail = useCallback(async () => {
    if (!Number.isInteger(writingId) || writingId <= 0) return
    try {
      setDetailLoading(true)
      const nextDetail = await writingAPI.get(writingId)
      setDetail(nextDetail)
      setBriefDraft(parseBriefJson(nextDetail.brief_json))
      setBriefStructuredPreview(null)
      setOutlineStructuredPreview(parseStructuredOutline(nextDetail.outline_json || null) as Record<string, unknown> | null)
      setBriefDirty(false)
      setActiveDocId((current) => current ?? nextDetail.current_document_id ?? nextDetail.documents[0]?.id ?? null)
    } catch (error) {
      toast.error((error as Error).message)
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [writingId])

  const loadDocument = useCallback(async (documentId: number) => {
    if (!Number.isInteger(writingId) || writingId <= 0) return
    try {
      setDocLoading(true)
      const doc = await writingAPI.getDocument(writingId, documentId)
      setDocTitle(doc.title)
      setContentMd(doc.content_md)
      setDirty(false)
      await writingAPI.patch(writingId, { current_document_id: documentId })
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setDocLoading(false)
    }
  }, [writingId])

  const loadKnowledgeCards = useCallback(async () => {
    if (!('listKnowledgeCards' in writingAPI)) return
    try {
      setKnowledgeLoading(true)
      const rows = await ((writingAPI as typeof writingAPI & { listKnowledgeCards: (id: number) => Promise<KnowledgeCardItem[]> }).listKnowledgeCards(writingId) as Promise<KnowledgeCardItem[]>)
      setKnowledgeCards(rows)
    } catch {
      setKnowledgeCards([])
    } finally {
      setKnowledgeLoading(false)
    }
  }, [writingId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetail()
    void loadKnowledgeCards()
  }, [loadDetail, loadKnowledgeCards])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeDocId != null) void loadDocument(activeDocId)
  }, [activeDocId, loadDocument])

  const highlightedProposal = useMemo(
    () => proposals.find((item: { id: number }) => item.id === highlightedProposalId) ?? null,
    [highlightedProposalId, proposals],
  )

  const activeDoc = useMemo(
    () => detail?.documents.find((item) => item.id === activeDocId) ?? null,
    [activeDocId, detail],
  )
  const isOutlineDoc = activeDoc?.document_type === 'outline'

  const workspacePreview = useMemo(() => ({
    brief: briefStructuredPreview,
    outline: outlineStructuredPreview ?? parseStructuredOutline(contentMd),
    activeDoc,
    isOutlineDoc,
  }), [activeDoc, briefStructuredPreview, contentMd, isOutlineDoc, outlineStructuredPreview])

  const completion = useMemo(() => {
    const values = [briefDraft.worldview, briefDraft.background, briefDraft.main_plot, briefDraft.core_conflict, briefDraft.main_characters]
    return values.filter((item) => item.trim()).length
  }, [briefDraft])

  const uiState = useMemo(() => ({
    detailLoading,
    docLoading,
    knowledgeLoading,
    proposalLoading,
    proposalImpactLoading,
    executionsLoading,
    executionDetailLoading,
    rollbackPreviewLoading,
    briefSaving,
    batchPlanning,
    batchApplying,
    rollingBack,
    dirty,
    saving,
  }), [
    detailLoading,
    docLoading,
    knowledgeLoading,
    proposalLoading,
    proposalImpactLoading,
    executionsLoading,
    executionDetailLoading,
    rollbackPreviewLoading,
    briefSaving,
    batchPlanning,
    batchApplying,
    rollingBack,
    dirty,
    saving,
  ])

  const projectState = useMemo(() => ({
    detail,
    briefDraft,
    briefDirty,
    briefStructuredPreview,
    outlineStructuredPreview,
    activeDocId,
    activeDoc,
    docTitle,
    contentMd,
    pendingDocId,
    knowledgeCards,
    completion,
    workspacePreview,
    isOutlineDoc,
  }), [
    detail,
    briefDraft,
    briefDirty,
    briefStructuredPreview,
    outlineStructuredPreview,
    activeDocId,
    activeDoc,
    docTitle,
    contentMd,
    pendingDocId,
    knowledgeCards,
    completion,
    workspacePreview,
    isOutlineDoc,
  ])

  const reviewState = useMemo(() => ({
    proposals,
    highlightedProposalId,
    highlightedProposal,
    highlightedProposalImpact,
    proposalImpactLoading,
    selectedProposalIds,
    batchPlan,
    executions,
    selectedExecutionId,
    executionDetail,
    rollbackPreview,
  }), [
    proposals,
    highlightedProposalId,
    highlightedProposal,
    highlightedProposalImpact,
    proposalImpactLoading,
    selectedProposalIds,
    batchPlan,
    executions,
    selectedExecutionId,
    executionDetail,
    rollbackPreview,
  ])

  const actions = useMemo(() => ({
    setBriefDraft,
    setBriefDirty,
    setBriefSaving,
    setBriefStructuredPreview,
    setOutlineStructuredPreview,
    setActiveDocId,
    setDocTitle,
    setContentMd,
    setDirty,
    setSaving,
    setPendingDocId,
    setProposals,
    setProposalLoading,
    setHighlightedProposalId,
    setProposalImpactLoading,
    setHighlightedProposalImpact,
    setSelectedProposalIds,
    setBatchPlanning,
    setBatchPlan,
    setBatchApplying,
    setExecutions,
    setExecutionsLoading,
    setSelectedExecutionId,
    setExecutionDetail,
    setExecutionDetailLoading,
    setRollbackPreview,
    setRollbackPreviewLoading,
    setRollingBack,
    loadDetail,
    loadDocument,
    loadKnowledgeCards,
  }), [loadDetail, loadDocument, loadKnowledgeCards])

  return {
    detailLoading,
    detail,
    briefDraft,
    setBriefDraft,
    briefDirty,
    setBriefDirty,
    briefSaving,
    setBriefSaving,
    briefStructuredPreview,
    setBriefStructuredPreview,
    outlineStructuredPreview,
    setOutlineStructuredPreview,
    docLoading,
    activeDocId,
    setActiveDocId,
    docTitle,
    setDocTitle,
    contentMd,
    setContentMd,
    dirty,
    setDirty,
    saving,
    setSaving,
    pendingDocId,
    setPendingDocId,
    knowledgeCards,
    knowledgeLoading,
    proposals,
    setProposals,
    highlightedProposalId,
    setHighlightedProposalId,
    proposalImpactLoading,
    setProposalImpactLoading,
    highlightedProposalImpact,
    setHighlightedProposalImpact,
    highlightedProposal,
    proposalLoading,
    setProposalLoading,
    selectedProposalIds,
    setSelectedProposalIds,
    batchPlanning,
    setBatchPlanning,
    batchPlan,
    setBatchPlan,
    batchApplying,
    setBatchApplying,
    executions,
    setExecutions,
    executionsLoading,
    setExecutionsLoading,
    selectedExecutionId,
    setSelectedExecutionId,
    executionDetail,
    setExecutionDetail,
    executionDetailLoading,
    setExecutionDetailLoading,
    rollbackPreview,
    setRollbackPreview,
    rollbackPreviewLoading,
    setRollbackPreviewLoading,
    rollingBack,
    setRollingBack,
    loadDetail,
    loadDocument,
    loadKnowledgeCards,
    activeDoc,
    isOutlineDoc,
    workspacePreview,
    completion,
    uiState,
    projectState,
    reviewState,
    actions,
  }
}
