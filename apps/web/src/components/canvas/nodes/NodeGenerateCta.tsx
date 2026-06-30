'use client'

import { Sparkles } from 'lucide-react'

import { cn } from '@/lib/cn'
import { useNodesStore } from '@/lib/canvas/store'
import { useNodeGenerate } from '@/lib/canvas/hooks/useNodeGenerate'
import { getGenerateButtonLabel } from '@/lib/canvas/utils/nodeGenerate'

interface Props {
  nodeId: string
  /** 覆盖默认动作文案，如「生成形象」 */
  label?: string
  className?: string
  compact?: boolean
}

/**
 * 节点空态上的生成入口 — 中间素材随时可生成，作为成片输入。
 */
export function NodeGenerateCta({ nodeId, label, className, compact }: Props) {
  const node = useNodesStore((s) => s.nodes.find((n) => n.id === nodeId))
  const { generateFromNode, openGenerate } = useNodeGenerate()

  if (!node) return null

  const buttonLabel = label ?? getGenerateButtonLabel(node)

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await generateFromNode(nodeId)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'pointer-events-auto flex items-center justify-center gap-1 rounded-md font-medium transition-colors',
        'bg-accent/90 text-on-accent shadow-primary-glow hover:bg-accent',
        compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs',
        className,
      )}
    >
      <Sparkles className={compact ? 'size-3' : 'size-3.5'} />
      <span>{buttonLabel}</span>
    </button>
  )
}
