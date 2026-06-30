import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { KnowledgeHistoryItem, ObjectHistoryItem, ObjectHistoryPreview, ReferenceNetwork, ReferenceNode } from '@/components/writing/types'
import { writingAPI } from '@/lib/api'

type Args = {
  writingId: number
  activeDocId: number | null
  highlightedProposalId: number | null
  knowledgeCards: Array<{ id: number }>
  loadDetail: () => Promise<void>
  loadDocument: (documentId: number) => Promise<void>
  setActiveDocId: (id: number | null | ((current: number | null) => number | null)) => void
  setHighlightedProposalId: (id: number | null | ((current: number | null) => number | null)) => void
}

export function useWritingKnowledgeWorkspace({
  writingId,
  activeDocId,
  highlightedProposalId,
  knowledgeCards,
  loadDetail,
  loadDocument,
  setActiveDocId,
  setHighlightedProposalId,
}: Args) {
  const [referenceNetwork, setReferenceNetwork] = useState<ReferenceNetwork | null>(null)
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [objectHistories, setObjectHistories] = useState<ObjectHistoryItem[]>([])
  const [objectHistoryLoading, setObjectHistoryLoading] = useState(false)
  const [objectHistoryPreview, setObjectHistoryPreview] = useState<ObjectHistoryPreview | null>(null)
  const [knowledgeHistories, setKnowledgeHistories] = useState<KnowledgeHistoryItem[]>([])
  const [knowledgeHistoryLoading, setKnowledgeHistoryLoading] = useState(false)
  const [selectedKnowledgeCardId, setSelectedKnowledgeCardId] = useState<number | null>(null)
  const [selectedObjectHistoryId, setSelectedObjectHistoryId] = useState<number | null>(null)
  const [objectKindFilter, setObjectKindFilter] = useState<'brief' | 'outline' | 'summary'>('brief')
  const [lastRestoredLabel, setLastRestoredLabel] = useState<string | null>(null)
  const [highlightedTarget, setHighlightedTarget] = useState<string | null>(null)

  const loadReferenceNetwork = useCallback(async () => {
    try {
      setReferenceLoading(true)
      const network = (await writingAPI.listReferenceNetwork(writingId, {
        proposal_id: highlightedProposalId ?? undefined,
        document_id: activeDocId ?? undefined,
      })) as ReferenceNetwork
      setReferenceNetwork(network)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setReferenceLoading(false)
    }
  }, [activeDocId, highlightedProposalId, writingId])

  const loadObjectHistories = useCallback(async (kind: 'brief' | 'outline' | 'summary') => {
    try {
      setObjectHistoryLoading(true)
      const rows = (await writingAPI.listObjectHistories(writingId, {
        object_kind: kind,
        document_id: activeDocId ?? undefined,
      })) as ObjectHistoryItem[]
      setObjectHistories(rows)
      setSelectedObjectHistoryId((current) => current ?? rows[0]?.id ?? null)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setObjectHistoryLoading(false)
    }
  }, [activeDocId, writingId])

  const loadKnowledgeHistories = useCallback(async (cardId: number) => {
    try {
      setSelectedKnowledgeCardId(cardId)
      setKnowledgeHistoryLoading(true)
      const rows = (await writingAPI.listKnowledgeCardHistories(writingId, cardId)) as KnowledgeHistoryItem[]
      setKnowledgeHistories(rows)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setKnowledgeHistoryLoading(false)
    }
  }, [writingId])

  const handleLoadObjectHistoryPreview = useCallback(async (historyId: number) => {
    try {
      setSelectedObjectHistoryId(historyId)
      setHighlightedTarget(`object-history-${historyId}`)
      const preview = (await writingAPI.previewObjectHistory(writingId, historyId)) as ObjectHistoryPreview
      setObjectHistoryPreview(preview)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [writingId])

  const handleRestoreObjectHistory = useCallback(async (historyId: number) => {
    try {
      await writingAPI.restoreObjectHistory(writingId, historyId)
      setLastRestoredLabel(`对象历史 #${historyId}`)
      setHighlightedTarget(`object-history-${historyId}`)
      toast.success('已恢复对象历史')
      await Promise.all([loadDetail(), loadObjectHistories(objectKindFilter), loadReferenceNetwork()])
      if (activeDocId != null) {
        await loadDocument(activeDocId)
      }
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [activeDocId, loadDetail, loadDocument, loadObjectHistories, loadReferenceNetwork, objectKindFilter, writingId])

  const handleRestoreKnowledgeHistory = useCallback(async (historyId: number) => {
    try {
      await writingAPI.restoreKnowledgeCardHistory(writingId, historyId)
      setLastRestoredLabel(`知识历史 #${historyId}`)
      setHighlightedTarget(`knowledge-history-${historyId}`)
      toast.success('已恢复知识历史')
      await Promise.all([loadDetail(), loadReferenceNetwork()])
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [loadDetail, loadReferenceNetwork, writingId])

  const handleSelectKnowledgeCard = useCallback(async (cardId: number) => {
    setHighlightedTarget(`knowledge-card-${cardId}`)
    await loadKnowledgeHistories(cardId)
  }, [loadKnowledgeHistories])

  const handleReferenceNodeClick = useCallback((node: ReferenceNode) => {
    setHighlightedTarget(`${node.type}-${node.id}`)
    if (node.type === 'document' && node.target_document_id) {
      setActiveDocId(node.target_document_id)
      void loadDocument(node.target_document_id)
      void loadReferenceNetwork()
      void loadObjectHistories(objectKindFilter)
      return
    }
    if (node.type === 'proposal') {
      setHighlightedProposalId(node.id)
      void loadReferenceNetwork()
    }
  }, [loadDocument, loadObjectHistories, loadReferenceNetwork, objectKindFilter, setActiveDocId, setHighlightedProposalId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReferenceNetwork()
  }, [loadReferenceNetwork])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadObjectHistories(objectKindFilter)
  }, [loadObjectHistories, objectKindFilter])

  useEffect(() => {
    if (selectedKnowledgeCardId != null) return
    const firstCardId = knowledgeCards[0]?.id
    if (firstCardId != null) {
      queueMicrotask(() => {
        void loadKnowledgeHistories(firstCardId)
      })
    }
  }, [knowledgeCards, loadKnowledgeHistories, selectedKnowledgeCardId])

  return {
    referenceNetwork,
    referenceLoading,
    objectHistories,
    objectHistoryLoading,
    objectHistoryPreview,
    knowledgeHistories,
    knowledgeHistoryLoading,
    selectedKnowledgeCardId,
    selectedObjectHistoryId,
    objectKindFilter,
    lastRestoredLabel,
    highlightedTarget,
    setObjectKindFilter,
    loadReferenceNetwork,
    loadObjectHistories,
    handleSelectKnowledgeCard,
    handleLoadObjectHistoryPreview,
    handleRestoreObjectHistory,
    handleRestoreKnowledgeHistory,
    handleReferenceNodeClick,
  }
}
