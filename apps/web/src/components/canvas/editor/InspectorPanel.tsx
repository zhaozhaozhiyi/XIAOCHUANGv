'use client'

/**
 * InspectorPanel — 右侧统一检视面板（v2.2 PR-A2）
 *
 * 把原「制作流程栏」与「底部节点编辑栏」合并为右侧一张卡片 + Tab 切换：
 *   - 流程 Tab：短剧制作流程清单（仅智能画布模式）
 *   - 属性 Tab：选中节点的完整编辑器（两种模式都在）
 *
 * 自动切 Tab：
 *   - 选中节点 / 触发业务动作 → 属性
 *   - 无选中（智能画布）→ 流程
 *   - 导演模式 → 只有属性 Tab
 *
 * 收起态为一颗悬浮按钮；展开态为 340px 卡片，面板内部滚动。
 */

import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  ListChecks,
  Loader2,
  MousePointerClick,
  SlidersHorizontal,
  X,
} from 'lucide-react'

import { cn } from '@/lib/cn'
import { useNodesStore, useUiStore } from '@/lib/canvas/store'
import {
  PIPELINE_PERSONAS,
  usePipelineStore,
  type PipelineStep,
} from '@/lib/canvas/store/pipelineStore'

import { ExpandedEditor } from './BottomBar/ExpandedEditor'

type Tab = 'pipeline' | 'props'

/** 选中节点的展示名（与 NarrowBar 同源：title > label > name > 兜底） */
function nodeDisplayName(node: { type?: string; data?: unknown } | undefined): string {
  if (!node) return '属性'
  const d = (node.data ?? {}) as Record<string, unknown>
  return (
    (d.title as string) ||
    (d.label as string) ||
    (d.name as string) ||
    (typeof d.text === 'string' && d.text ? d.text.slice(0, 12) : '') ||
    (node.type === 'storyboard' ? '未命名分镜' : '节点')
  )
}

export function InspectorPanel() {
  const canvasMode = usePipelineStore((s) => s.canvasMode)
  const open = usePipelineStore((s) => s.railOpen)
  const toggle = usePipelineStore((s) => s.toggleRail)
  const steps = usePipelineStore((s) => s.steps)

  const selectedNodeId = useUiStore((s) => s.selectedNodeId)
  const pendingAction = useUiStore((s) => s.pendingAction)
  const selectedNode = useNodesStore((s) => s.nodes.find((n) => n.id === selectedNodeId))
  const hasSelection = !!selectedNodeId || !!pendingAction

  // 属性 Tab 直接显示节点名（业务动作时显示动作名）；无选中时兜底「属性」
  const propsLabel = pendingAction
    ? pendingAction.action.label
    : selectedNode
      ? nodeDisplayName(selectedNode)
      : '属性'

  const showPipelineTab = canvasMode === 'chat'
  const doneCount = steps.filter((s) => s.status === 'done').length
  const total = steps.length

  const [tab, setTab] = useState<Tab>('pipeline')

  // 自动切 Tab：选中节点 → 属性；否则（智能画布）→ 流程；导演模式恒属性。
  // 仅依赖选中态 / 模式变化，手动切换在下一次选中态变化前保持。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!showPipelineTab) {
      setTab('props')
      return
    }
    setTab(hasSelection ? 'props' : 'pipeline')
  }, [hasSelection, showPipelineTab])
  /* eslint-enable react-hooks/set-state-in-effect */

  // 导演模式下没有「流程」Tab，强制属性
  const effectiveTab: Tab = showPipelineTab ? tab : 'props'

  if (!open) {
    return (
      <div className="pointer-events-none absolute right-3 top-4 z-30">
        <button
          type="button"
          onClick={toggle}
          className="pointer-events-auto flex items-center gap-2 rounded-full canvas-chrome px-3.5 py-2 text-sm font-medium transition-colors hover:bg-bg-hover"
        >
          {hasSelection ? (
            <>
              <SlidersHorizontal className="size-4 text-accent" />
              检视
            </>
          ) : (
            <>
              <ListChecks className="size-4 text-accent" />
              流程 {doneCount}/{total}
            </>
          )}
        </button>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 top-4 z-30 flex w-[340px] max-w-[calc(100%-1.5rem)]">
      <div className="pointer-events-auto flex w-full flex-col overflow-hidden rounded-2xl canvas-chrome">
        {/* Tab 头 */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <TabButton
              active={effectiveTab === 'props'}
              onClick={() => setTab('props')}
              icon={<SlidersHorizontal className="size-3.5" />}
              label={propsLabel}
              labelClassName="max-w-[150px] truncate"
            />
            {showPipelineTab && (
              <TabButton
                active={effectiveTab === 'pipeline'}
                onClick={() => setTab('pipeline')}
                icon={<ListChecks className="size-3.5" />}
                label="流程"
              />
            )}
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label="收起检视面板"
            className="flex size-7 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-bg-hover hover:text-text-0"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tab 内容 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {effectiveTab === 'pipeline' ? (
            <PipelineTab steps={steps} doneCount={doneCount} total={total} />
          ) : hasSelection ? (
            <ExpandedEditor />
          ) : (
            <EmptyProps />
          )}
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  labelClassName,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  labelClassName?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-bg-2 text-text-0'
          : 'text-text-2 hover:bg-bg-hover hover:text-text-0',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className={labelClassName}>{label}</span>
    </button>
  )
}

function EmptyProps() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <MousePointerClick className="size-7 text-text-3" />
      <p className="text-sm text-text-2">选择一个节点查看属性</p>
      <p className="text-xs text-text-3">选中节点后可随时生成形象 / 场景 / 分镜画面</p>
    </div>
  )
}

function PipelineTab({
  steps,
  doneCount,
  total,
}: {
  steps: PipelineStep[]
  doneCount: number
  total: number
}) {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <ListChecks className="size-4 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text-0">制作流程</div>
          <div className="text-[11px] text-text-3">
            已完成 {doneCount}/{total}
          </div>
        </div>
      </div>
      <ol className="space-y-0.5 p-2">
        {steps.map((step, i) => (
          <StepRow key={step.id} step={step} index={i + 1} isLast={i === steps.length - 1} />
        ))}
      </ol>
    </div>
  )
}

function StepRow({
  step,
  index,
  isLast,
}: {
  step: PipelineStep
  index: number
  isLast: boolean
}) {
  const persona = PIPELINE_PERSONAS[step.agent]

  return (
    <li className="relative flex items-center gap-2.5 rounded-lg px-2 py-2">
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[1.4rem] top-9 h-[calc(100%-0.5rem)] w-px bg-border"
        />
      )}
      <StatusIcon status={step.status} index={index} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-sm',
            step.status === 'done'
              ? 'text-text-2'
              : step.status === 'active'
                ? 'font-medium text-text-0'
                : 'text-text-1',
          )}
        >
          {step.title}
        </div>
        <div className="flex items-center gap-1 text-[11px] text-text-3">
          <span>{persona?.avatar}</span>
          <span className="truncate">{persona?.name}</span>
        </div>
      </div>
    </li>
  )
}

function StatusIcon({ status, index }: { status: PipelineStep['status']; index: number }) {
  if (status === 'done') {
    return <CheckCircle2 className="size-5 shrink-0 text-success" />
  }
  if (status === 'active') {
    return <Loader2 className="size-5 shrink-0 animate-spin text-accent" />
  }
  return (
    <span className="relative flex size-5 shrink-0 items-center justify-center">
      <Circle className="size-5 text-border" />
      <span className="absolute text-[10px] font-medium text-text-3">{index}</span>
    </span>
  )
}
