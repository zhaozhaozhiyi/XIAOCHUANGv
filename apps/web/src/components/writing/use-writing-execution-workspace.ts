import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { BatchExecutionDetail, BatchExecutionItem, BatchPlan, ProposalItem, RollbackPreview } from '@/components/writing/types'
import { writingAPI } from '@/lib/api'

type Args = {
  writingId: number
  activeDocId: number | null
  loadDetail: () => Promise<void>
  loadDocument: (documentId: number) => Promise<void>
}

export function useWritingExecutionWorkspace({ writingId, activeDocId, loadDetail, loadDocument }: Args) {
  const [proposals, setProposals] = useState<ProposalItem[]>([])
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
  const [highlightedExecutionTarget, setHighlightedExecutionTarget] = useState<string | null>(null)

  const refreshProposals = useCallback(async () => {
    try {
      setProposalLoading(true)
      const rows = (await writingAPI.listProposals(writingId)) as ProposalItem[]
      setProposals(rows)
      setHighlightedProposalId((current) => current ?? rows[0]?.id ?? null)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setProposalLoading(false)
    }
  }, [writingId])

  const refreshExecutions = useCallback(async () => {
    try {
      setExecutionsLoading(true)
      const rows = (await writingAPI.listBatchExecutions(writingId)) as BatchExecutionItem[]
      setExecutions(rows)
      setSelectedExecutionId((current) => current ?? rows[0]?.id ?? null)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setExecutionsLoading(false)
    }
  }, [writingId])

  const loadExecutionDetail = useCallback(async (executionId: number) => {
    try {
      setExecutionDetailLoading(true)
      const detail = (await writingAPI.getBatchExecutionDetail(writingId, executionId)) as BatchExecutionDetail
      setExecutionDetail(detail)
      setRollbackPreview(null)
      setHighlightedExecutionTarget(`execution-${executionId}`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setExecutionDetailLoading(false)
    }
  }, [writingId])

  const handleApplyProposal = useCallback(async (proposalId: number) => {
    try {
      await writingAPI.applyProposal(writingId, proposalId)
      setHighlightedExecutionTarget(`proposal-${proposalId}`)
      toast.success('提案已应用')
      await Promise.all([refreshProposals(), refreshExecutions(), loadDetail()])
      if (activeDocId != null) await loadDocument(activeDocId)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [activeDocId, loadDetail, loadDocument, refreshExecutions, refreshProposals, writingId])

  const handleRejectProposal = useCallback(async (proposalId: number) => {
    try {
      await writingAPI.rejectProposal(writingId, proposalId)
      setHighlightedExecutionTarget(`proposal-${proposalId}`)
      toast.success('提案已拒绝')
      await refreshProposals()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [refreshProposals, writingId])

  const handleBuildBatchPlan = useCallback(async () => {
    if (!selectedProposalIds.length) return
    try {
      setBatchPlanning(true)
      const plan = (await writingAPI.batchPlanProposals(writingId, { proposal_ids: selectedProposalIds })) as BatchPlan
      setBatchPlan(plan)
      setHighlightedExecutionTarget('batch-plan')
      toast.success('已生成批量计划')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBatchPlanning(false)
    }
  }, [selectedProposalIds, writingId])

  const handleApplyBatchPlan = useCallback(async () => {
    if (!batchPlan?.proposal_ids.length) return
    try {
      setBatchApplying(true)
      await writingAPI.batchApplyProposals(writingId, {
        proposal_ids: batchPlan.proposal_ids,
        allow_conflicts: false,
        stop_on_error: true,
      })
      setHighlightedExecutionTarget('batch-apply')
      toast.success('批量计划已执行')
      setBatchPlan(null)
      setSelectedProposalIds([])
      await Promise.all([refreshProposals(), refreshExecutions(), loadDetail()])
      if (activeDocId != null) await loadDocument(activeDocId)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBatchApplying(false)
    }
  }, [activeDocId, batchPlan, loadDetail, loadDocument, refreshExecutions, refreshProposals, writingId])

  const handlePreviewRollback = useCallback(async (executionId: number) => {
    try {
      setRollbackPreviewLoading(true)
      const preview = (await writingAPI.getBatchRollbackPreview(writingId, executionId)) as RollbackPreview
      setRollbackPreview(preview)
      setHighlightedExecutionTarget(`rollback-preview-${executionId}`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRollbackPreviewLoading(false)
    }
  }, [writingId])

  const handleRollbackExecution = useCallback(async (executionId: number) => {
    try {
      setRollingBack(true)
      await writingAPI.rollbackBatchExecution(writingId, executionId)
      setHighlightedExecutionTarget(`rollback-${executionId}`)
      toast.success('已完成回滚')
      setRollbackPreview(null)
      await Promise.all([refreshProposals(), refreshExecutions(), loadDetail()])
      await loadExecutionDetail(executionId)
      if (activeDocId != null) await loadDocument(activeDocId)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRollingBack(false)
    }
  }, [activeDocId, loadDetail, loadDocument, loadExecutionDetail, refreshExecutions, refreshProposals, writingId])

  const handleToggleProposal = useCallback(async (proposalId: number) => {
    setSelectedProposalIds((current) => (current.includes(proposalId) ? current.filter((item) => item !== proposalId) : [...current, proposalId]))
    setHighlightedProposalId(proposalId)
    setHighlightedExecutionTarget(`proposal-${proposalId}`)
    try {
      setProposalImpactLoading(true)
      const impact = await writingAPI.getProposalImpact(writingId, proposalId)
      setHighlightedProposalImpact(impact)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setProposalImpactLoading(false)
    }
  }, [writingId])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void refreshProposals()
    void refreshExecutions()
  }, [refreshExecutions, refreshProposals])

  useEffect(() => {
    if (selectedExecutionId == null) {
      setExecutionDetail(null)
      return
    }
    void loadExecutionDetail(selectedExecutionId)
  }, [loadExecutionDetail, selectedExecutionId])
  /* eslint-enable react-hooks/set-state-in-effect */

  return {
    proposals,
    highlightedProposalId,
    setHighlightedProposalId,
    proposalImpactLoading,
    highlightedProposalImpact,
    proposalLoading,
    selectedProposalIds,
    setSelectedProposalIds,
    batchPlanning,
    batchPlan,
    setBatchPlan,
    batchApplying,
    executions,
    executionsLoading,
    selectedExecutionId,
    setSelectedExecutionId,
    executionDetail,
    executionDetailLoading,
    rollbackPreview,
    rollbackPreviewLoading,
    rollingBack,
    highlightedExecutionTarget,
    refreshProposals,
    refreshExecutions,
    handleToggleProposal,
    handleApplyProposal,
    handleRejectProposal,
    handleBuildBatchPlan,
    handleApplyBatchPlan,
    handlePreviewRollback,
    handleRollbackExecution,
  }
}
