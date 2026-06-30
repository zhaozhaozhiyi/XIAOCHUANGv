'use client'

import { BookMarked, Network, RotateCcw, ScrollText } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

import type { KnowledgeCardItem, KnowledgeHistoryItem, ObjectHistoryItem, ObjectHistoryPreview, ReferenceNetwork, ReferenceNode } from './types'

type ObjectKindFilter = 'brief' | 'outline' | 'summary'

type Props = {
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
  objectKindFilter: ObjectKindFilter
  lastRestoredLabel: string | null
  onSelectKnowledgeCard: (cardId: number) => void
  onLoadObjectHistoryPreview: (historyId: number) => void
  onRestoreObjectHistory: (historyId: number) => void
  onRestoreKnowledgeHistory: (historyId: number) => void
  onObjectKindChange: (kind: ObjectKindFilter) => void
  onReferenceNodeClick: (node: ReferenceNode) => void
}

function renderPreviewSummary(preview: ObjectHistoryPreview | null) {
  if (!preview) return '选择一条对象历史查看差异预览。'
  const added = preview.diff_lines.filter((line) => line.type === 'added').length
  const removed = preview.diff_lines.filter((line) => line.type === 'removed').length
  return `差异摘要：+${added} / -${removed}`
}

function renderNode(node: ReferenceNode, onClick: (node: ReferenceNode) => void) {
  return (
    <button
      key={`${node.type}-${node.id}`}
      type="button"
      onClick={() => onClick(node)}
      className="w-full rounded-[var(--radius-sm)] border border-border bg-bg-0 px-3 py-2 text-left hover:bg-bg-hover"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-xs font-medium text-text-1">{node.title}</div>
        <Badge variant="outline" className="rounded-full text-[10px]">{node.type}</Badge>
      </div>
      <div className="mt-1 text-[11px] text-text-3">{node.relation}</div>
    </button>
  )
}

export function WritingKnowledgePanel(props: Props) {
  const groups = props.referenceNetwork ? [
    { label: '提案', items: props.referenceNetwork.proposals },
    { label: '知识', items: props.referenceNetwork.knowledge_cards },
    { label: '对象历史', items: props.referenceNetwork.object_histories },
    { label: '知识历史', items: props.referenceNetwork.knowledge_histories },
    { label: '文档', items: props.referenceNetwork.documents },
  ] : []

  const relationPaths = props.referenceNetwork?.proposals.slice(0, 4).map((proposal) => {
    const objectLinks = props.referenceNetwork?.object_histories.filter((item) => item.source_proposal_id === proposal.id).slice(0, 2) ?? []
    const knowledgeLinks = props.referenceNetwork?.knowledge_cards.filter((item) => item.source_proposal_id === proposal.id).slice(0, 2) ?? []
    return {
      proposal,
      objectLinks,
      knowledgeLinks,
    }
  }) ?? []

  return (
    <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg-0">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-0"><BookMarked className="size-4" />知识卡与知识历史</div>
          <div className="mt-1 text-xs text-text-3">知识卡是小说长期记忆，支持查看历史并恢复。</div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-3 p-4">
            {props.lastRestoredLabel ? <div className="rounded-[var(--radius-md)] border border-success/30 bg-success-bg p-3 text-xs text-success">最近恢复：{props.lastRestoredLabel}</div> : null}
            {props.knowledgeLoading ? <div className="text-xs text-text-3">加载知识卡中...</div> : null}
            {!props.knowledgeLoading && !props.knowledgeCards.length ? <div className="rounded-[var(--radius-md)] border border-dashed border-border p-3 text-xs text-text-3">暂无知识卡。</div> : null}
            {props.knowledgeCards.slice(0, 6).map((card) => {
              const active = card.id === props.selectedKnowledgeCardId
              return (
                <button key={card.id} type="button" onClick={() => props.onSelectKnowledgeCard(card.id)} className={active ? 'w-full rounded-[var(--radius-md)] border border-accent bg-accent/10 p-3 text-left ring-1 ring-accent/40' : 'w-full rounded-[var(--radius-md)] border border-border bg-bg-1/40 p-3 text-left'}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-text-1">{card.title}</div>
                    <Badge variant="outline" className="rounded-full text-[10px]">{card.card_type}</Badge>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] text-text-3">{card.content}</div>
                </button>
              )
            })}
            {props.selectedKnowledgeCardId ? (
              <div className="rounded-[var(--radius-md)] border border-border bg-bg-1/40 p-3">
                <div className="mb-2 text-sm font-semibold text-text-1">知识历史</div>
                {props.knowledgeHistoryLoading ? <div className="text-xs text-text-3">加载知识历史中...</div> : null}
                <div className="space-y-2">
                  {props.knowledgeHistories.slice(0, 4).map((item) => (
                    <div key={item.id} className="rounded-[var(--radius-sm)] border border-border bg-bg-0 p-2">
                      <div className="text-xs font-medium text-text-1">{item.title}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] text-text-3">{item.content}</div>
                      <div className="mt-2"><Button size="sm" variant="outline" type="button" onClick={() => props.onRestoreKnowledgeHistory(item.id)}>恢复此版本</Button></div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg-0">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-0"><Network className="size-4" />参考网络</div>
          <div className="mt-1 text-xs text-text-3">按关系分组展示，并显示提案到对象/知识的关系路径。</div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4 text-xs text-text-3">
            {props.referenceLoading ? <div>加载参考网络中...</div> : null}
            {!props.referenceLoading && !props.referenceNetwork ? <div className="rounded-[var(--radius-md)] border border-dashed border-border p-3">暂无参考网络数据。</div> : null}
            {props.referenceNetwork ? (
              <>
                <div className="rounded-[var(--radius-md)] border border-border bg-bg-1/40 p-3">
                  <div className="text-xs font-semibold text-text-1">关系路径</div>
                  <div className="mt-2 space-y-2">
                    {relationPaths.map((item) => (
                      <div key={`path-${item.proposal.id}`} className="rounded-[var(--radius-sm)] border border-border bg-bg-0 px-3 py-2">
                        <div className="font-medium text-text-1">{item.proposal.title}</div>
                        <div className="mt-1 text-[11px] text-text-3">
                          提案 → {item.objectLinks.map((node) => node.title).join(' / ') || '无对象历史'} → {item.knowledgeLinks.map((node) => node.title).join(' / ') || '无知识卡'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {groups.map((group) => (
                  <div key={group.label} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-text-1">{group.label}</div>
                      <Badge variant="outline" className="rounded-full text-[10px]">{group.items.length}</Badge>
                    </div>
                    {!group.items.length ? <div className="rounded-[var(--radius-sm)] border border-dashed border-border px-3 py-2">暂无节点</div> : null}
                    {group.items.slice(0, 5).map((node) => renderNode(node, props.onReferenceNodeClick))}
                  </div>
                ))}
              </>
            ) : null}
          </div>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg-0">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-sm font-semibold text-text-0"><span className="inline-flex items-center gap-2"><ScrollText className="size-4" />对象历史</span></div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(['brief', 'outline', 'summary'] as ObjectKindFilter[]).map((kind) => (
              <Button key={kind} size="sm" variant={props.objectKindFilter === kind ? 'default' : 'outline'} type="button" onClick={() => props.onObjectKindChange(kind)}>{kind}</Button>
            ))}
          </div>
          <div className="mt-1 text-xs text-text-3">对设定/大纲/摘要等关键对象保留版本快照并支持恢复。</div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-3 p-4">
            {props.objectHistoryLoading ? <div className="text-xs text-text-3">加载对象历史中...</div> : null}
            {!props.objectHistoryLoading && !props.objectHistories.length ? <div className="rounded-[var(--radius-md)] border border-dashed border-border p-3 text-xs text-text-3">暂无对象历史。</div> : null}
            {props.objectHistories.slice(0, 5).map((item) => {
              const active = item.id === props.selectedObjectHistoryId
              return (
                <button key={item.id} type="button" onClick={() => props.onLoadObjectHistoryPreview(item.id)} className={active ? 'w-full rounded-[var(--radius-md)] border border-accent bg-accent/10 p-3 text-left ring-1 ring-accent/40' : 'w-full rounded-[var(--radius-md)] border border-border bg-bg-1/40 p-3 text-left'}>
                  <div className="text-sm font-medium text-text-1">{item.snapshot_title || item.object_kind}</div>
                  <div className="mt-1 text-[11px] text-text-3">{item.object_kind} · {new Date(item.created_at).toLocaleString('zh-CN')}</div>
                </button>
              )
            })}
            <div className="rounded-[var(--radius-md)] border border-border bg-bg-1/40 p-3">
              <div className="text-sm font-semibold text-text-1">预览</div>
              <div className="mt-2 text-xs text-text-3">{renderPreviewSummary(props.objectHistoryPreview)}</div>
              {props.objectHistoryPreview ? <div className="mt-3"><Button size="sm" type="button" onClick={() => props.onRestoreObjectHistory(props.objectHistoryPreview!.history_id)}><RotateCcw className="mr-1 size-3.5" />恢复该版本</Button></div> : null}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
