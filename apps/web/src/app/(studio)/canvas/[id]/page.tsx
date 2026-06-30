'use client'

/**
 * /canvas/[id] — 画布编辑器（v0.2.0 PR1 骨架）
 *
 * PR1 实装：加载画布详情 → 三 store 就位 → ReactFlow 可拖节点 + 连线 + 自动保存。
 * PR2~PR4：节点系统 / 业务动作 / 生成成片 / 短剧通路在此页面外的子组件展开。
 */

import { use } from 'react'
import { Loader2 } from 'lucide-react'
import { useCanvas } from '@/lib/canvas/hooks/useCanvas'
import { CanvasEditor } from '@/components/canvas/editor/CanvasEditor'

export default function CanvasEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { loading, error, canvas } = useCanvas(id)

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-3">
        <Loader2 size={28} className="animate-spin" />
      </div>
    )
  }

  if (error || !canvas) {
    throw error ?? new Error('画布不存在')
  }

  return (
    <main className="relative min-h-0 flex-1">
      <CanvasEditor />
    </main>
  )
}
