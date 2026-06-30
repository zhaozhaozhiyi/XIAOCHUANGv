'use client'

import { WritingExecutionPanel } from '@/components/writing/writing-execution-panel'
import { WritingKnowledgePanel } from '@/components/writing/writing-knowledge-panel'
import type {
  BatchExecutionDetail,
  BatchExecutionItem,
  BatchPlan,
  KnowledgeCardItem,
  KnowledgeHistoryItem,
  ObjectHistoryItem,
  ObjectHistoryPreview,
  ProposalImpact,
  ProposalItem,
  ReferenceNetwork,
  ReferenceNode,
  RollbackPreview,
} from '@/components/writing/types'
import { ScrollArea } from '@/components/ui/scroll-area'

type Props = {
  proposals: ProposalItem[]
  proposalLoading: boolean
  selectedProposalIds: number[]
  batchPlanning: boolean
  batchPlan: BatchPlan | null
  batchApplying: boolean
  executions: BatchExecutionItem[]
  executionsLoading: boolean
  selectedExecutionId: number | null
  executionDetail: BatchExecutionDetail | null
  executionDetailLoading: boolean
  rollbackPreview: RollbackPreview | null
  rollbackPreviewLoading: boolean
  rollingBack: boolean
  highlightedProposalId: number | null
  highlightedProposalImpact: ProposalImpact | null
  proposalImpactLoading: boolean
  knowledgeCards: KnowledgeCardItem[]
  knowledgeLoading: boolean
  referenceNetwork: ReferenceNetwork | null
  referenceLoading: boolean
  objectHistories: ObjectHistoryItem[]
  objectHistoryLoading: boolean
  objectHistoryPreview: ObjectHistoryPreview | null
  knowledgeHistories: KnowledgeHistoryItem[]
  knowledgeHistoryLoading: boolean
  selectedKnowledgeCardId: number | null
  selectedObjectHistoryId: number | null
  objectKindFilter: 'brief' | 'outline' | 'summary'
  lastRestoredLabel: string | null
  highlightedTarget: string | null
  onToggleProposal: (proposalId: number) => void
  onBuildPlan: () => void
  onApplyProposal: (proposalId: number) => void
  onRejectProposal: (proposalId: number) => void
  onApplyBatchPlan: () => void
  onClearBatchPlan: () => void
  onSelectExecution: (executionId: number) => void
  onPreviewRollback: (executionId: number) => void
  onRollbackExecution: (executionId: number) => void
  onOpenReferenceDocument: (documentId: number) => void
  onOpenReferenceProposal: (proposalId: number) => void
  onOpenImpactDocument: (documentId: number) => void
  onOpenImpactKnowledgeCard: (cardId: number) => void
  onOpenImpactObjectHistory: (historyId: number) => void
  onSelectKnowledgeCard: (cardId: number) => void
  onLoadObjectHistoryPreview: (historyId: number) => void
  onRestoreObjectHistory: (historyId: number) => void
  onRestoreKnowledgeHistory: (historyId: number) => void
  onObjectKindChange: (kind: 'brief' | 'outline' | 'summary') => void
  onReferenceNodeClick: (node: ReferenceNode) => void
}

export function ReviewStepPanel(props: Props) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <div>
          <h2 className="text-lg font-semibold text-text-0">审阅</h2>
          <p className="mt-1 text-sm text-text-3">查看 AI 提案、执行记录与知识一致性，决定是否应用修改。</p>
        </div>
        <WritingExecutionPanel
          proposals={props.proposals}
          proposalLoading={props.proposalLoading}
          selectedProposalIds={props.selectedProposalIds}
          batchPlanning={props.batchPlanning}
          batchPlan={props.batchPlan}
          batchApplying={props.batchApplying}
          executions={props.executions}
          executionsLoading={props.executionsLoading}
          selectedExecutionId={props.selectedExecutionId}
          executionDetail={props.executionDetail}
          executionDetailLoading={props.executionDetailLoading}
          rollbackPreview={props.rollbackPreview}
          rollbackPreviewLoading={props.rollbackPreviewLoading}
          rollingBack={props.rollingBack}
          highlightedProposalId={props.highlightedProposalId}
          highlightedProposalImpact={props.highlightedProposalImpact}
          proposalImpactLoading={props.proposalImpactLoading}
          onToggleProposal={props.onToggleProposal}
          onBuildPlan={props.onBuildPlan}
          onApplyProposal={props.onApplyProposal}
          onRejectProposal={props.onRejectProposal}
          onApplyBatchPlan={props.onApplyBatchPlan}
          onClearBatchPlan={props.onClearBatchPlan}
          onSelectExecution={props.onSelectExecution}
          onPreviewRollback={props.onPreviewRollback}
          onRollbackExecution={props.onRollbackExecution}
          onOpenReferenceDocument={props.onOpenReferenceDocument}
          onOpenReferenceProposal={props.onOpenReferenceProposal}
          onOpenImpactDocument={props.onOpenImpactDocument}
          onOpenImpactKnowledgeCard={props.onOpenImpactKnowledgeCard}
          onOpenImpactObjectHistory={props.onOpenImpactObjectHistory}
        />
        {props.highlightedTarget ? (
          <div className="rounded-[var(--radius-md)] border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
            当前联动定位：{props.highlightedTarget}
          </div>
        ) : null}
        <WritingKnowledgePanel
          knowledgeCards={props.knowledgeCards}
          knowledgeLoading={props.knowledgeLoading}
          referenceNetwork={props.referenceNetwork}
          referenceLoading={props.referenceLoading}
          objectHistories={props.objectHistories}
          objectHistoryLoading={props.objectHistoryLoading}
          objectHistoryPreview={props.objectHistoryPreview}
          knowledgeHistories={props.knowledgeHistories}
          knowledgeHistoryLoading={props.knowledgeHistoryLoading}
          selectedKnowledgeCardId={props.selectedKnowledgeCardId}
          selectedObjectHistoryId={props.selectedObjectHistoryId}
          objectKindFilter={props.objectKindFilter}
          lastRestoredLabel={props.lastRestoredLabel}
          onSelectKnowledgeCard={props.onSelectKnowledgeCard}
          onLoadObjectHistoryPreview={props.onLoadObjectHistoryPreview}
          onRestoreObjectHistory={props.onRestoreObjectHistory}
          onRestoreKnowledgeHistory={props.onRestoreKnowledgeHistory}
          onObjectKindChange={props.onObjectKindChange}
          onReferenceNodeClick={props.onReferenceNodeClick}
        />
      </div>
    </ScrollArea>
  )
}
