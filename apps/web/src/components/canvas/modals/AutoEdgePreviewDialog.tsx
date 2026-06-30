'use client'

/**
 * AutoEdgePreviewDialog — 自动连线预览（v0.2.0 PR4，PRD §11.4）
 *
 * 在"开始生成成片"前如果存在未连线的孤立 storyboard → 弹此对话框。
 * 用户决策：
 *   ☑ 接受并自动写入连线（推荐，默认勾）  →  批量 edgesStore.addEdge + markEditing
 *   ☐ 仅本次生效  →  返回 inferred 但不入库
 *
 * 预览：横向缩略图链 + 实线箭头；显示新增的 N 条连线。
 */

import { useState } from 'react'
import { ArrowRight, ImageIcon } from 'lucide-react'

import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogHeaderBar,
  DialogMain,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import type { FlowNode } from '@/lib/canvas/store'
import type { InferredEdge } from '@/lib/canvas/utils/inferAutoEdges'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  inferred: InferredEdge[]
  nodesById: Map<string, FlowNode>
  /** 用户决定后回调；persist=true 表示写入 store，false 仅本次返回 inferred */
  onConfirm: (persist: boolean) => void
  onCancel: () => void
}

export function AutoEdgePreviewDialog({
  open,
  onOpenChange,
  inferred,
  nodesById,
  onConfirm,
  onCancel,
}: Props) {
  const [persist, setPersist] = useState(true)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="panel" className="max-w-2xl">
        <DialogHeaderBar>
          <DialogTitle>检测到 {inferred.length} 条建议连线</DialogTitle>
          <p className="mt-1 text-xs text-text-2">
            画布上的分镜尚未串成顺序。系统按位置推断了一条叙事链，建议补上 narrative
            连线再生成成片。
          </p>
        </DialogHeaderBar>

        <DialogMain>
          {/* 推断链可视化（横向滚动） */}
          <div className="overflow-x-auto">
            <div className="flex items-center gap-1 pb-2">
              {chainPreview(inferred, nodesById).map((node, i, arr) => (
                <div key={node.id} className="flex shrink-0 items-center gap-1">
                  <NodePreview node={node} />
                  {i < arr.length - 1 && (
                    <ArrowRight className="size-4 shrink-0 text-accent" />
                  )}
                </div>
              ))}
            </div>
          </div>

          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={persist}
              onChange={(e) => setPersist(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--color-accent)]"
            />
            <div>
              <div className="text-text-0">接受并写入连线（推荐）</div>
              <div className="text-xs text-text-3">
                取消勾选则仅本次生成生效，画布上不写入连线
              </div>
            </div>
          </label>
        </DialogMain>

        <DialogActions>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={() => onConfirm(persist)}>继续生成</Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 把 inferred edges 转成有序节点链：
 *   - 找到链头（在 inferred source 列表中出现但不作为 target 的节点）
 *   - 沿 source→target 走完链
 */
function chainPreview(
  inferred: InferredEdge[],
  nodesById: Map<string, FlowNode>,
): FlowNode[] {
  if (inferred.length === 0) return []
  const targets = new Set(inferred.map((e) => e.target))
  const head = inferred.find((e) => !targets.has(e.source))?.source ?? inferred[0].source
  const nextMap = new Map(inferred.map((e) => [e.source, e.target]))
  const chain: FlowNode[] = []
  let cur: string | undefined = head
  const visited = new Set<string>()
  while (cur && !visited.has(cur)) {
    visited.add(cur)
    const node = nodesById.get(cur)
    if (node) chain.push(node)
    cur = nextMap.get(cur)
  }
  return chain
}

function NodePreview({ node }: { node: FlowNode }) {
  const data = (node.data ?? {}) as { title?: string; shotIndex?: number; images?: string[] }
  const title = data.title || '未命名'
  const img = data.images?.[0]
  return (
    <div className="flex w-28 shrink-0 flex-col gap-1">
      <div
        className={cn(
          'relative h-16 w-full overflow-hidden rounded border border-border bg-bg-2',
        )}
      >
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={title} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-text-3">
            <ImageIcon className="size-5" />
          </div>
        )}
        {data.shotIndex !== undefined && (
          <span className="absolute left-1 top-1 rounded bg-black/55 px-1 py-0.5 font-mono text-[9px] text-white">
            #{data.shotIndex}
          </span>
        )}
      </div>
      <p className="truncate text-[10px] text-text-2" title={title}>
        {title}
      </p>
    </div>
  )
}
