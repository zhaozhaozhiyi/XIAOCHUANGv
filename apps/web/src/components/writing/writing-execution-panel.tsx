'use client'

import { Check, ExternalLink, GitBranch, History, Loader2, Undo2, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

import type { BatchExecutionDetail, BatchExecutionItem, BatchPlan, ProposalImpact, ProposalItem, RollbackPreview } from './types'

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
}


function renderDiffPreview(lines: Array<{ type: 'same' | 'added' | 'removed'; text: string }>) {
  return (
    <div className="mt-2 space-y-1 rounded-[var(--radius-sm)] border border-border bg-bg-0 px-2 py-2">
      {lines.slice(0, 4).map((line, index) => (
        <div
          key={index}
          className={line.type === 'added' ? 'text-[10px] text-success' : line.type === 'removed' ? 'text-[10px] text-error' : 'text-[10px] text-text-3'}
        >
          <span className="mr-1">{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : '·'}</span>
          <span className="break-all">{line.text || '（空）'}</span>
        </div>
      ))}
    </div>
  )
}

function summarizeDiffLines(lines: Array<{ type: 'same' | 'added' | 'removed'; text: string }>) {
  const added = lines.filter((line) => line.type === 'added').length
  const removed = lines.filter((line) => line.type === 'removed').length
  return `+${added} / -${removed}`
}

function renderStructuredProposal(structured: ProposalItem['structured']) {
  if (!structured) return null
  const items: Array<{ label: string; value: string }> = []
  if (structured.summary) items.push({ label: '摘要', value: structured.summary })
  if (structured.reasons?.length) items.push({ label: '原因', value: structured.reasons.join('；') })
  if (structured.risks?.length) items.push({ label: '风险', value: structured.risks.join('；') })
  if (structured.expected_effects?.length) items.push({ label: '预期影响', value: structured.expected_effects.join('；') })

  return (
    <div className="mt-3 space-y-2 rounded-[var(--radius-sm)] border border-border bg-bg-0 p-3">
      <div className="text-xs font-medium text-text-1">结构化信息</div>
      {items.map((item) => (
        <div key={item.label} className="text-xs text-text-3">
          <span className="font-medium text-text-1">{item.label}：</span>{item.value}
        </div>
      ))}
      {structured.issues?.length ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-text-1">问题列表</div>
          {structured.issues.slice(0, 4).map((issue, index) => (
            <div key={`${issue.title || 'issue'}-${index}`} className="rounded-[var(--radius-sm)] border border-border bg-bg-1/40 p-2 text-xs text-text-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-text-1">{issue.title || '未命名问题'}</span>
                {issue.severity ? <Badge variant="outline" className="rounded-full text-[10px]">{issue.severity}</Badge> : null}
              </div>
              {issue.evidence?.length ? <div className="mt-1">证据：{issue.evidence.join('；')}</div> : null}
              {issue.suggested_fix?.length ? <div className="mt-1">建议：{issue.suggested_fix.join('；')}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
function renderImpactSummary(impact: ProposalImpact) {
  const summaryItems = [
    { label: '创作准备', value: impact.counts.briefs },
    { label: '大纲', value: impact.counts.outlines },
    { label: '摘要', value: impact.counts.summaries },
    { label: '正文', value: impact.counts.documents },
    { label: '知识卡', value: impact.counts.knowledge_cards },
  ].filter((item) => item.value > 0)

  if (!summaryItems.length) return null

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] text-text-3 md:grid-cols-3">
      {summaryItems.map((item) => (
        <div key={item.label} className="rounded-[var(--radius-sm)] border border-border bg-bg-1/40 px-3 py-2">
          <div className="font-medium text-text-1">{item.label}</div>
          <div className="mt-1">影响 {item.value} 项</div>
        </div>
      ))}
    </div>
  )
}

export function WritingExecutionPanel(props: Props) {
  const pendingProposals = props.proposals.filter((item) => item.status === 'pending')
  const highlightedProposal = props.proposals.find((item) => item.id === props.highlightedProposalId) ?? null

  return (
    <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg-0">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-0"><GitBranch className="size-4" />提案与批量执行</div>
            <Button size="sm" type="button" disabled={!props.selectedProposalIds.length || props.batchPlanning} onClick={props.onBuildPlan}>
              {props.batchPlanning ? <Loader2 className="size-4 animate-spin" /> : '生成计划'}
            </Button>
          </div>
          <div className="mt-1 text-xs text-text-3">AI 产出先沉淀为提案，再由你确认应用或批量执行。</div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-3 p-4">
            {highlightedProposal ? (
              <div className="rounded-[var(--radius-md)] border border-accent bg-accent/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-text-1">提案详情</div>
                  <Badge variant="outline" className="rounded-full text-[10px]">#{highlightedProposal.id}</Badge>
                </div>
                <div className="mt-2 text-sm font-medium text-text-1">{highlightedProposal.title}</div>
                <div className="mt-1 text-xs text-text-3">目标：{highlightedProposal.target_kind}{highlightedProposal.target_document_id ? ` · 文档 ${highlightedProposal.target_document_id}` : ''}</div>
                <div className="mt-2 text-xs text-text-3 whitespace-pre-wrap">{highlightedProposal.content}</div>
                {renderStructuredProposal(highlightedProposal.structured)}
                <div className="mt-3 rounded-[var(--radius-sm)] border border-border bg-bg-0 p-3">
                  <div className="text-xs font-medium text-text-1">引用来源</div>
                  {!highlightedProposal.references.length ? <div className="mt-2 text-[11px] text-text-3">暂无引用来源</div> : null}
                  <div className="mt-2 space-y-2">
                    {highlightedProposal.references.map((ref, index) => (
                      <div key={`${highlightedProposal.id}-${index}`} className="rounded-[var(--radius-sm)] border border-border bg-bg-1/40 px-3 py-2 text-[11px] text-text-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-text-1">{ref.title || ref.kind || `引用 ${index + 1}`}</div>
                          <div className="flex gap-2">
                            {ref.document_id ? <Button size="sm" variant="outline" type="button" className="h-6 px-2 text-[10px]" onClick={() => props.onOpenReferenceDocument(ref.document_id!)}><ExternalLink className="mr-1 size-3" />文档</Button> : null}
                            <Button size="sm" variant="outline" type="button" className="h-6 px-2 text-[10px]" onClick={() => props.onOpenReferenceProposal(highlightedProposal.id)}><ExternalLink className="mr-1 size-3" />提案</Button>
                          </div>
                        </div>
                        <div className="mt-1">类型：{ref.kind || 'unknown'}{ref.document_id ? ` · 文档 ${ref.document_id}` : ''}</div>
                        {ref.reason ? <div className="mt-1">原因：{ref.reason}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-3 rounded-[var(--radius-sm)] border border-border bg-bg-0 p-3">
                  <div className="text-xs font-medium text-text-1">影响对象</div>
                  {props.proposalImpactLoading ? <div className="mt-2 text-[11px] text-text-3">正在分析影响对象...</div> : null}
                  {!props.proposalImpactLoading && !props.highlightedProposalImpact ? <div className="mt-2 text-[11px] text-text-3">暂无影响对象数据</div> : null}
                  {props.highlightedProposalImpact ? (
                    <div className="mt-2 space-y-2 text-[11px] text-text-3">
                      {renderImpactSummary(props.highlightedProposalImpact)}
                      {props.highlightedProposalImpact.briefs.slice(0, 2).map((item, index) => (
                        <div key={`brief-${index}`} className="rounded-[var(--radius-sm)] border border-border bg-bg-1/40 px-3 py-2">
                          <div className="font-medium text-text-1">创作准备 · {item.title}</div>
                          <div className="mt-1">{summarizeDiffLines(item.diff_preview)}</div>
                          {renderDiffPreview(item.diff_preview)}
                        </div>
                      ))}
                      {props.highlightedProposalImpact.outlines.slice(0, 2).map((item, index) => (
                        <div key={`outline-${index}`} className="rounded-[var(--radius-sm)] border border-border bg-bg-1/40 px-3 py-2">
                          <div className="font-medium text-text-1">大纲 · {item.title}</div>
                          <div className="mt-1">{summarizeDiffLines(item.diff_preview)}</div>
                          {renderDiffPreview(item.diff_preview)}
                        </div>
                      ))}
                      {props.highlightedProposalImpact.documents.slice(0, 3).map((item) => (
                        <div key={`doc-${item.id}`} className="rounded-[var(--radius-sm)] border border-border bg-bg-1/40 px-3 py-2">
                          <div className="flex items-center justify-between gap-2"><div className="font-medium text-text-1">文档 · {item.title}</div><Button size="sm" variant="outline" type="button" className="h-6 px-2 text-[10px]" onClick={() => props.onOpenImpactDocument(item.id)}>跳转</Button></div>
                          <div className="mt-1">{item.relation} · {summarizeDiffLines(item.diff_preview)}</div>
                          {renderDiffPreview(item.diff_preview)}
                        </div>
                      ))}
                      {props.highlightedProposalImpact.knowledge_cards.slice(0, 3).map((item) => (
                        <div key={`kc-${item.id}`} className="rounded-[var(--radius-sm)] border border-border bg-bg-1/40 px-3 py-2">
                          <div className="flex items-center justify-between gap-2"><div className="font-medium text-text-1">知识卡 · {item.title}</div><Button size="sm" variant="outline" type="button" className="h-6 px-2 text-[10px]" onClick={() => props.onOpenImpactKnowledgeCard(item.id)}>定位</Button></div>
                          <div className="mt-1">{item.relation} · {summarizeDiffLines(item.diff_preview)}</div>
                          {renderDiffPreview(item.diff_preview)}
                        </div>
                      ))}
                      {props.highlightedProposalImpact.object_histories.slice(0, 3).map((item) => (
                        <div key={`oh-${item.id}`} className="rounded-[var(--radius-sm)] border border-border bg-bg-1/40 px-3 py-2">
                          <div className="flex items-center justify-between gap-2"><div className="font-medium text-text-1">对象历史 · {item.title}</div><Button size="sm" variant="outline" type="button" className="h-6 px-2 text-[10px]" onClick={() => props.onOpenImpactObjectHistory(item.id)}>定位</Button></div>
                          <div className="mt-1">{item.relation}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {props.proposalLoading ? <div className="flex items-center gap-2 text-xs text-text-3"><Loader2 className="size-4 animate-spin" />加载提案中...</div> : null}
            {!props.proposalLoading && !props.proposals.length ? <div className="rounded-[var(--radius-md)] border border-dashed border-border p-3 text-xs text-text-3">暂无 AI 提案。</div> : null}
            {pendingProposals.map((proposal) => {
              const selected = props.selectedProposalIds.includes(proposal.id)
              const highlighted = proposal.id === props.highlightedProposalId
              return (
                <div key={proposal.id} className={highlighted ? 'rounded-[var(--radius-md)] border border-accent bg-accent/10 p-3 ring-1 ring-accent/40' : 'rounded-[var(--radius-md)] border border-border bg-bg-1/40 p-3'}>
                  <div className="flex items-start gap-2">
                    <input type="checkbox" checked={selected} onChange={() => props.onToggleProposal(proposal.id)} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-text-1">{proposal.title}</div>
                        <Badge variant="outline" className="rounded-full text-[10px]">{proposal.target_kind}</Badge>
                      </div>
                      <div className="mt-1 line-clamp-3 text-xs text-text-3">{proposal.content}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" type="button" className="h-7 gap-1" onClick={() => props.onApplyProposal(proposal.id)}><Check className="size-3.5" />应用</Button>
                        <Button size="sm" variant="outline" type="button" className="h-7 gap-1" onClick={() => props.onRejectProposal(proposal.id)}><X className="size-3.5" />拒绝</Button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {props.batchPlan ? (
              <div className="rounded-[var(--radius-md)] border border-accent/40 bg-accent/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-text-1">批量计划</div>
                  <Badge className={props.batchPlan.can_apply ? 'rounded-full bg-success-bg text-success' : 'rounded-full bg-error-bg text-error'}>{props.batchPlan.can_apply ? '可执行' : '存在阻塞冲突'}</Badge>
                </div>
                <div className="mt-2 text-xs text-text-3">推荐顺序：{props.batchPlan.recommended_proposal_ids.join(' → ') || '无'}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-text-3">
                  <div>设定变更 {props.batchPlan.counts.briefs}</div>
                  <div>大纲变更 {props.batchPlan.counts.outlines}</div>
                  <div>摘要变更 {props.batchPlan.counts.summaries}</div>
                  <div>知识卡 {props.batchPlan.counts.knowledge_cards}</div>
                </div>
                {props.batchPlan.conflicts.length ? (
                  <div className="mt-3 space-y-2">
                    {props.batchPlan.conflicts.map((conflict) => (
                      <div key={conflict.key} className="rounded-[var(--radius-sm)] border border-border bg-bg-0 px-3 py-2 text-[11px] text-text-3">
                        <div className="font-medium text-text-1">{conflict.reason}</div>
                        <div className="mt-1">{conflict.proposal_titles.join('、')}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 rounded-[var(--radius-sm)] border border-border bg-bg-0 p-3 text-[11px] text-text-3">
                  <div className="text-xs font-medium text-text-1">执行解释</div>
                  <div className="mt-2">推荐顺序依据：优先处理设定/大纲/摘要等全局对象，再处理知识卡与局部对象，降低后续冲突概率。</div>
                  <div className="mt-2">当前风险：{props.batchPlan.conflicts.length ? '存在冲突，需要先审阅冲突项' : '未检测到显著冲突，可直接执行'}</div>
                  <div className="mt-2">阻塞判断：{props.batchPlan.can_apply ? '无阻塞项' : '存在 blocking 冲突，建议逐条确认后执行'}</div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                    <div className="rounded-[var(--radius-sm)] border border-success/30 bg-success-bg px-3 py-2">
                      <div className="font-medium text-success">低风险</div>
                      <div className="mt-1">文档 {props.batchPlan.counts.documents} / 知识卡 {props.batchPlan.counts.knowledge_cards}</div>
                    </div>
                    <div className="rounded-[var(--radius-sm)] border border-warning/30 bg-warning-bg px-3 py-2">
                      <div className="font-medium text-warning">中风险</div>
                      <div className="mt-1">大纲 {props.batchPlan.counts.outlines} / 摘要 {props.batchPlan.counts.summaries}</div>
                    </div>
                    <div className="rounded-[var(--radius-sm)] border border-error/30 bg-error-bg px-3 py-2">
                      <div className="font-medium text-error">高风险</div>
                      <div className="mt-1">设定 {props.batchPlan.counts.briefs} / 阻塞冲突 {props.batchPlan.conflicts.filter((item) => item.severity === 'blocking').length}</div>
                    </div>
                  </div>
                  {props.batchPlan.conflicts.length ? (
                    <div className="mt-3 space-y-2">
                      {props.batchPlan.conflicts.map((conflict) => (
                        <div key={conflict.key} className={conflict.severity === 'blocking' ? 'rounded-[var(--radius-sm)] border border-error/30 bg-error-bg px-3 py-2' : 'rounded-[var(--radius-sm)] border border-warning/30 bg-warning-bg px-3 py-2'}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-text-1">{conflict.reason}</div>
                            <Badge className={conflict.severity === 'blocking' ? 'rounded-full bg-error text-on-accent' : 'rounded-full bg-warning text-on-accent'}>{conflict.severity}</Badge>
                          </div>
                          <div className="mt-1">{conflict.proposal_titles.join('、')}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" type="button" disabled={!props.batchPlan.can_apply || props.batchApplying} onClick={props.onApplyBatchPlan}>{props.batchApplying ? <Loader2 className="size-4 animate-spin" /> : '执行批量计划'}</Button>
                  <Button size="sm" variant="outline" type="button" onClick={props.onClearBatchPlan}>清空计划</Button>
                </div>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg-0">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-0"><History className="size-4" />批量历史与回滚</div>
          <div className="mt-1 text-xs text-text-3">每次批量执行都会留下历史、差异摘要与回滚入口。</div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-3 p-4">
            {props.executionsLoading ? <div className="flex items-center gap-2 text-xs text-text-3"><Loader2 className="size-4 animate-spin" />加载历史中...</div> : null}
            {!props.executionsLoading && !props.executions.length ? <div className="rounded-[var(--radius-md)] border border-dashed border-border p-3 text-xs text-text-3">暂无批量执行历史。</div> : null}
            {props.executions.slice(0, 4).map((execution) => {
              const active = execution.id === props.selectedExecutionId
              return (
                <button key={execution.id} type="button" onClick={() => props.onSelectExecution(execution.id)} className={active ? 'w-full rounded-[var(--radius-md)] border border-accent bg-accent/10 p-3 text-left' : 'w-full rounded-[var(--radius-md)] border border-border bg-bg-1/40 p-3 text-left'}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-text-1">执行 #{execution.id}</div>
                    <Badge variant="outline" className="rounded-full text-[10px]">应用 {execution.applied_count}</Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-text-3">{new Date(execution.created_at).toLocaleString('zh-CN')} · 提案 {execution.proposal_ids.length} 条</div>
                </button>
              )
            })}
            {props.selectedExecutionId ? (
              <div className="rounded-[var(--radius-md)] border border-border bg-bg-1/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-text-1">执行详情</div>
                  <Button size="sm" variant="outline" type="button" disabled={props.rollbackPreviewLoading} onClick={() => props.onPreviewRollback(props.selectedExecutionId!)}>
                    {props.rollbackPreviewLoading ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-3.5" />}预览回滚
                  </Button>
                </div>
                {props.executionDetailLoading ? <div className="text-xs text-text-3">正在加载详情...</div> : null}
                {props.executionDetail ? (
                  <div className="space-y-2 text-xs text-text-3">
                    <div>结果：{props.executionDetail.results.map((item) => `${item.title}(${item.status})`).join('、') || '暂无'}</div>
                    <div>差异摘要：{props.executionDetail.diff_preview.map((item) => `${item.title} ${summarizeDiffLines(item.diff_lines)}`).join('；') || '暂无'}</div>
                  </div>
                ) : null}
                {props.rollbackPreview ? (
                  <div className="mt-3 rounded-[var(--radius-sm)] border border-border bg-bg-0 p-3">
                    <div className="text-xs font-medium text-text-1">回滚预览</div>
                    <div className="mt-2 space-y-1 text-[11px] text-text-3">
                      {props.rollbackPreview.items.map((item, index) => <div key={`${item.kind}-${index}`}>{item.kind} · {item.title} · {item.target}</div>)}
                    </div>
                    <div className="mt-3">
                      <Button size="sm" type="button" disabled={props.rollingBack} onClick={() => props.onRollbackExecution(props.rollbackPreview!.execution_id)}>{props.rollingBack ? <Loader2 className="size-4 animate-spin" /> : '执行回滚'}</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}



