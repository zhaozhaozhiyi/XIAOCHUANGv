'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

import { WritingChatPanel } from '@/components/writing/writing-chat-panel'
import { BriefStepPanel } from '@/components/writing/steps/brief-step-panel'
import { ChapterWriteStepPanel } from '@/components/writing/steps/chapter-write-step-panel'
import { ExportStepPanel } from '@/components/writing/steps/export-step-panel'
import { OutlineStepPanel } from '@/components/writing/steps/outline-step-panel'
import { ReviewStepPanel } from '@/components/writing/steps/review-step-panel'
import { WritingStepSidebar } from '@/components/writing/writing-step-sidebar'
import { WritingStudioTopbar } from '@/components/writing/writing-studio-topbar'
import {
  computeStepProgress,
  findOutlineDocumentId,
  inferDefaultStep,
  isWritingStepKey,
  resolveAiContext,
  type WritingStepKey,
} from '@/components/writing/writing-steps'
import { useWritingExecutionWorkspace } from '@/components/writing/use-writing-execution-workspace'
import { useWritingKnowledgeWorkspace } from '@/components/writing/use-writing-knowledge-workspace'
import { useWritingWorkspaceController } from '@/components/writing/use-writing-workspace-controller'
import { writingAPI } from '@/lib/api'
import { Button } from '@/components/ui/button'

const AI_PANEL_WIDTH_KEY = 'writing:ai-panel-width'
const AI_PANEL_DEFAULT_WIDTH = 320
const AI_PANEL_MIN_WIDTH = 280
const AI_PANEL_MAX_WIDTH = 640

export default function WritingWorkspacePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const writingId = Number(params.id)

  const controller = useWritingWorkspaceController({ writingId })
  const {
    detailLoading,
    detail,
    briefDraft,
    setBriefDraft,
    briefDirty,
    setBriefDirty,
    briefStructuredPreview,
    setBriefStructuredPreview,
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
    knowledgeCards,
    loadDetail,
    loadDocument,
  } = controller

  const execution = useWritingExecutionWorkspace({
    writingId,
    activeDocId,
    loadDetail,
    loadDocument,
  })

  const {
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
    handleSelectKnowledgeCard,
    handleLoadObjectHistoryPreview,
    handleRestoreObjectHistory,
    handleRestoreKnowledgeHistory,
    handleReferenceNodeClick,
  } = useWritingKnowledgeWorkspace({
    writingId,
    activeDocId,
    highlightedProposalId: execution.highlightedProposalId,
    knowledgeCards,
    loadDetail,
    loadDocument,
    setActiveDocId,
    setHighlightedProposalId: execution.setHighlightedProposalId,
  })

  const [step, setStep] = useState<WritingStepKey | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [titleSaving, setTitleSaving] = useState(false)
  const [outlineDocId, setOutlineDocId] = useState<number | null>(null)
  const [outlineEnsuring, setOutlineEnsuring] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [aiWidth, setAiWidth] = useState(AI_PANEL_DEFAULT_WIDTH)
  const aiWidthRef = useRef(aiWidth)

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(AI_PANEL_WIDTH_KEY))
    if (saved >= AI_PANEL_MIN_WIDTH && saved <= AI_PANEL_MAX_WIDTH) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAiWidth(saved)
      aiWidthRef.current = saved
    }
  }, [])

  const handleAiResizeStart = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = aiWidthRef.current

    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        AI_PANEL_MAX_WIDTH,
        Math.max(AI_PANEL_MIN_WIDTH, startWidth + (startX - moveEvent.clientX)),
      )
      aiWidthRef.current = next
      setAiWidth(next)
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.localStorage.setItem(AI_PANEL_WIDTH_KEY, String(Math.round(aiWidthRef.current)))
    }

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const pendingProposalCount = useMemo(
    () => execution.proposals.filter((item) => item.status === 'pending').length,
    [execution.proposals],
  )

  const stepProgress = useMemo(
    () => computeStepProgress(detail, briefDraft, contentMd.trim().length > 0, pendingProposalCount),
    [briefDraft, contentMd, detail, pendingProposalCount],
  )

  const syncStepToUrl = useCallback(
    (nextStep: WritingStepKey) => {
      const next = new URLSearchParams(searchParams.toString())
      next.set('step', nextStep)
      router.replace(`/writing/${writingId}?${next.toString()}`, { scroll: false })
    },
    [router, searchParams, writingId],
  )

  const autosaveDocument = useCallback(async () => {
    if (activeDocId == null) return
    try {
      setSaveStatus('saving')
      await writingAPI.patchDocument(writingId, activeDocId, { title: docTitle, content_md: contentMd })
      setDirty(false)
      setSaveStatus('saved')
    } catch (error) {
      setSaveStatus('error')
      toast.error((error as Error).message)
    }
  }, [activeDocId, contentMd, docTitle, setDirty, writingId])

  const autosaveBrief = useCallback(async () => {
    try {
      setSaveStatus('saving')
      await writingAPI.patch(writingId, { brief_json: JSON.stringify(briefDraft) })
      setBriefDirty(false)
      setSaveStatus('saved')
    } catch (error) {
      setSaveStatus('error')
      toast.error((error as Error).message)
    }
  }, [briefDraft, setBriefDirty, writingId])

  const flushSave = useCallback(async () => {
    if (step === 'brief' && briefDirty) {
      await autosaveBrief()
    } else if ((step === 'outline' || step === 'write') && dirty && activeDocId != null) {
      await autosaveDocument()
    }
  }, [activeDocId, autosaveBrief, autosaveDocument, briefDirty, dirty, step])

  const handleStepChange = useCallback(
    (nextStep: WritingStepKey) => {
      void flushSave()
      setStep(nextStep)
      syncStepToUrl(nextStep)

      if (nextStep === 'outline') {
        const targetId = findOutlineDocumentId(detail)
        if (targetId != null) {
          setOutlineDocId(targetId)
          setActiveDocId(targetId)
        }
      }

      if (nextStep === 'write' && activeDocId == null && detail?.documents.length) {
        const firstWriteDoc = detail.documents.find((doc) => doc.document_type === 'chapter') ?? detail.documents[0]
        setActiveDocId(firstWriteDoc.id)
      }
    },
    [activeDocId, detail, flushSave, setActiveDocId, syncStepToUrl],
  )

  useEffect(() => {
    if (!detail || step != null) return
    const fromUrl = searchParams.get('step')
    const initial = isWritingStepKey(fromUrl) ? fromUrl : inferDefaultStep(briefDraft)
    const task = window.setTimeout(() => {
      setStep(initial)
      if (!isWritingStepKey(fromUrl)) syncStepToUrl(initial)

      if (initial === 'outline') {
        const targetId = findOutlineDocumentId(detail)
        if (targetId != null) {
          setOutlineDocId(targetId)
          setActiveDocId(targetId)
        }
      }

      if (initial === 'write') {
        const firstWriteDoc = detail.documents.find((doc) => doc.document_type === 'chapter') ?? detail.documents[0]
        if (firstWriteDoc && activeDocId == null) setActiveDocId(firstWriteDoc.id)
      }
    }, 0)
    return () => {
      window.clearTimeout(task)
    }
  }, [activeDocId, briefDraft, detail, searchParams, setActiveDocId, step, syncStepToUrl])

  useEffect(() => {
    if (!detail) return
    const task = window.setTimeout(() => {
      setOutlineDocId(findOutlineDocumentId(detail))
    }, 0)
    return () => {
      window.clearTimeout(task)
    }
  }, [detail])

  useEffect(() => {
    if (step !== 'outline' || !detail) return
    const existingId = findOutlineDocumentId(detail)
    if (existingId != null) {
      const task = window.setTimeout(() => {
        if (outlineDocId !== existingId) setOutlineDocId(existingId)
        if (activeDocId !== existingId) {
          setActiveDocId(existingId)
          void loadDocument(existingId)
        }
      }, 0)
      return () => {
        window.clearTimeout(task)
      }
    }
    if (outlineEnsuring) return

    let cancelled = false
    const task = window.setTimeout(() => {
      setOutlineEnsuring(true)
      void (async () => {
        try {
          const { document_id } = await writingAPI.addDocument(writingId, { title: '作品大纲', document_type: 'outline' })
          if (cancelled) return
          await loadDetail()
          setOutlineDocId(document_id)
          setActiveDocId(document_id)
          await loadDocument(document_id)
        } catch (error) {
          if (!cancelled) toast.error((error as Error).message)
        } finally {
          if (!cancelled) setOutlineEnsuring(false)
        }
      })()
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(task)
    }
  }, [activeDocId, detail, loadDetail, loadDocument, outlineDocId, outlineEnsuring, setActiveDocId, step, writingId])

  useEffect(() => {
    if (step == null) return
    if (step === 'brief') {
      if (!briefDirty) return
      const timer = setTimeout(() => void autosaveBrief(), 1000)
      return () => clearTimeout(timer)
    }
    if (step === 'outline' || step === 'write') {
      if (!dirty || activeDocId == null) return
      const timer = setTimeout(() => void autosaveDocument(), 1000)
      return () => clearTimeout(timer)
    }
  }, [activeDocId, autosaveBrief, autosaveDocument, briefDirty, dirty, step])

  const addChapter = useCallback(async () => {
    try {
      const nextTitle = `新章节 ${(detail?.documents.filter((doc) => doc.document_type === 'chapter').length ?? 0) + 1}`
      const { document_id } = await writingAPI.addDocument(writingId, { title: nextTitle, document_type: 'chapter' })
      toast.success('已添加章节')
      await loadDetail()
      setActiveDocId(document_id)
      await loadDocument(document_id)
      handleStepChange('write')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [detail, handleStepChange, loadDetail, loadDocument, setActiveDocId, writingId])

  const saveTitle = useCallback(
    async (nextTitle: string) => {
      try {
        setTitleSaving(true)
        await writingAPI.patch(writingId, { title: nextTitle })
        toast.success('已更新作品名')
        await loadDetail()
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setTitleSaving(false)
      }
    },
    [loadDetail, writingId],
  )

  const exportMarkdown = useCallback(async () => {
    try {
      setExporting(true)
      const { blob, filename } = await writingAPI.exportMarkdown(writingId)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      window.URL.revokeObjectURL(url)
      toast.success('已导出 Markdown')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setExporting(false)
    }
  }, [writingId])

  const importDrama = useCallback(async () => {
    try {
      setImporting(true)
      const result = await writingAPI.importToDrama(writingId, {
        document_id: activeDocId ?? undefined,
      })
      toast.success('已导入短剧')
      router.push(`/drama/${result.drama_id}`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setImporting(false)
    }
  }, [activeDocId, router, writingId])

  const handleSelectDocument = useCallback(
    (documentId: number) => {
      if (documentId === activeDocId) return
      void flushSave()
      setActiveDocId(documentId)
      void loadDocument(documentId)
    },
    [activeDocId, flushSave, loadDocument, setActiveDocId],
  )

  const handleOpenDocumentFromReview = useCallback(
    (documentId: number) => {
      setActiveDocId(documentId)
      void loadDocument(documentId)
      handleStepChange('write')
    },
    [handleStepChange, loadDocument, setActiveDocId],
  )

  const saveIndicator = useMemo<'saving' | 'pending' | 'saved' | 'error' | null>(() => {
    if (step !== 'brief' && step !== 'outline' && step !== 'write') return null
    const activeDirty = step === 'brief' ? briefDirty : dirty
    if (saveStatus === 'saving') return 'saving'
    if (activeDirty) return 'pending'
    if (saveStatus === 'error') return 'error'
    if (saveStatus === 'saved') return 'saved'
    return null
  }, [briefDirty, dirty, saveStatus, step])

  const aiContext = useMemo(() => {
    if (!detail || !step) {
      return { documentId: null as number | null, documentTitle: '', documentContent: '' }
    }
    return resolveAiContext(step, detail, briefDraft, outlineDocId, activeDocId, docTitle, contentMd)
  }, [activeDocId, briefDraft, contentMd, detail, docTitle, outlineDocId, step])

  const handleInsertAiContent = useCallback(
    (value: string) => {
      if (step === 'brief') {
        setBriefDraft((prev) => ({
          ...prev,
          main_plot: `${prev.main_plot}${prev.main_plot && !prev.main_plot.endsWith('\n') ? '\n' : ''}${value}`,
        }))
        setBriefDirty(true)
        return
      }

      setContentMd((prev) => `${prev}${prev.endsWith('\n') || !prev ? '' : '\n'}${value}`)
      setDirty(true)
    },
    [setBriefDirty, setBriefDraft, setContentMd, setDirty, step],
  )

  const handleAiReload = useCallback(() => {
    void loadDetail()
    void execution.refreshProposals()
    void execution.refreshExecutions()
    if (activeDocId != null) void loadDocument(activeDocId)
  }, [activeDocId, execution, loadDetail, loadDocument])

  if (!Number.isInteger(writingId) || writingId <= 0) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-6 text-text-3">
        <div className="rounded-[var(--radius-lg)] border border-border bg-bg-0 px-6 py-5 text-center">
          <div className="text-base font-medium text-text-1">无效的作品 ID</div>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/writing">返回作品列表</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (detailLoading || !detail || step == null) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center text-text-3">
        <Loader2 className="size-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-page">
      <WritingStudioTopbar
        title={detail.title}
        saveIndicator={saveIndicator}
        titleSaving={titleSaving}
        onTitleSave={saveTitle}
      />

      <div className="flex min-h-0 flex-1">
        <WritingStepSidebar
          step={step}
          stepDone={stepProgress.stepDone}
          progressDone={stepProgress.done}
          progressTotal={stepProgress.total}
          detail={detail}
          activeDocId={step === 'write' ? activeDocId : null}
          pendingProposalCount={pendingProposalCount}
          onStepChange={handleStepChange}
          onSelectDocument={handleSelectDocument}
          onAddChapter={() => void addChapter()}
        />

        <div
          className="grid min-h-0 min-w-0 flex-1"
          style={{ gridTemplateColumns: `minmax(0,1fr) ${aiWidth}px` }}
        >
          <main className="min-h-0 overflow-hidden bg-bg-page">
          {step === 'brief' ? (
            <BriefStepPanel
              briefDraft={briefDraft}
              briefStructuredPreview={briefStructuredPreview}
              onBriefChange={(patch) => {
                setBriefDraft((prev) => ({ ...prev, ...patch }))
                setBriefDirty(true)
              }}
            />
          ) : null}

          {step === 'outline' ? (
            outlineDocId == null || outlineEnsuring ? (
              <div className="flex h-full items-center justify-center text-text-3">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : (
              <OutlineStepPanel
                contentMd={contentMd}
                onContentChange={(value) => {
                  setContentMd(value)
                  setDirty(true)
                }}
              />
            )
          ) : null}

          {step === 'write' ? (
            <ChapterWriteStepPanel
              docTitle={docTitle}
              contentMd={contentMd}
              onTitleChange={(value) => {
                setDocTitle(value)
                setDirty(true)
              }}
              onContentChange={(value) => {
                setContentMd(value)
                setDirty(true)
              }}
            />
          ) : null}

          {step === 'review' ? (
            <ReviewStepPanel
              proposals={execution.proposals}
              proposalLoading={execution.proposalLoading}
              selectedProposalIds={execution.selectedProposalIds}
              batchPlanning={execution.batchPlanning}
              batchPlan={execution.batchPlan}
              batchApplying={execution.batchApplying}
              executions={execution.executions}
              executionsLoading={execution.executionsLoading}
              selectedExecutionId={execution.selectedExecutionId}
              executionDetail={execution.executionDetail}
              executionDetailLoading={execution.executionDetailLoading}
              rollbackPreview={execution.rollbackPreview}
              rollbackPreviewLoading={execution.rollbackPreviewLoading}
              rollingBack={execution.rollingBack}
              highlightedProposalId={execution.highlightedProposalId}
              highlightedProposalImpact={execution.highlightedProposalImpact}
              proposalImpactLoading={execution.proposalImpactLoading}
              knowledgeCards={knowledgeCards}
              knowledgeLoading={controller.knowledgeLoading}
              referenceNetwork={referenceNetwork}
              referenceLoading={referenceLoading}
              objectHistories={objectHistories}
              objectHistoryLoading={objectHistoryLoading}
              objectHistoryPreview={objectHistoryPreview}
              knowledgeHistories={knowledgeHistories}
              knowledgeHistoryLoading={knowledgeHistoryLoading}
              selectedKnowledgeCardId={selectedKnowledgeCardId}
              selectedObjectHistoryId={selectedObjectHistoryId}
              objectKindFilter={objectKindFilter}
              lastRestoredLabel={lastRestoredLabel}
              highlightedTarget={highlightedTarget}
              onToggleProposal={(proposalId) => void execution.handleToggleProposal(proposalId)}
              onBuildPlan={() => void execution.handleBuildBatchPlan()}
              onApplyProposal={(proposalId) => void execution.handleApplyProposal(proposalId)}
              onRejectProposal={(proposalId) => void execution.handleRejectProposal(proposalId)}
              onApplyBatchPlan={() => void execution.handleApplyBatchPlan()}
              onClearBatchPlan={() => {
                execution.setBatchPlan(null)
                execution.setSelectedProposalIds([])
              }}
              onSelectExecution={execution.setSelectedExecutionId}
              onPreviewRollback={(executionId) => void execution.handlePreviewRollback(executionId)}
              onRollbackExecution={(executionId) => void execution.handleRollbackExecution(executionId)}
              onOpenReferenceDocument={handleOpenDocumentFromReview}
              onOpenReferenceProposal={execution.setHighlightedProposalId}
              onOpenImpactDocument={handleOpenDocumentFromReview}
              onOpenImpactKnowledgeCard={() => {}}
              onOpenImpactObjectHistory={() => {}}
              onSelectKnowledgeCard={handleSelectKnowledgeCard}
              onLoadObjectHistoryPreview={handleLoadObjectHistoryPreview}
              onRestoreObjectHistory={handleRestoreObjectHistory}
              onRestoreKnowledgeHistory={handleRestoreKnowledgeHistory}
              onObjectKindChange={setObjectKindFilter}
              onReferenceNodeClick={handleReferenceNodeClick}
            />
          ) : null}

          {step === 'export' ? (
            <ExportStepPanel
              exporting={exporting}
              importing={importing}
              onExportMarkdown={() => void exportMarkdown()}
              onImportDrama={() => void importDrama()}
            />
          ) : null}
          </main>

          <aside className="relative min-h-0 border-l border-border bg-bg-page">
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整 AI 助手宽度"
              onPointerDown={handleAiResizeStart}
              className="absolute left-0 top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-primary/40 active:bg-primary/60"
            />
            <WritingChatPanel
              key={step}
              className="h-full rounded-none border-0"
              writingId={writingId}
              documentId={aiContext.documentId}
              documentTitle={aiContext.documentTitle}
              documentContent={aiContext.documentContent}
              onInsertContent={handleInsertAiContent}
              getSelection={() => ''}
              onBriefStructuredApplied={(structured) => setBriefStructuredPreview(structured)}
              onOutlineStructuredApplied={(structured) => setOutlineStructuredPreview(structured)}
              onReloadRequested={handleAiReload}
            />
          </aside>
        </div>
      </div>
    </div>
  )
}
