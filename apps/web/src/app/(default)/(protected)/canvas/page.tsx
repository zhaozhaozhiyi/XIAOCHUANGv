'use client'

/**
 * /canvas — 画布列表页（v0.2.0 PR1）
 *
 * 实现要点（PRD §6）：
 * - 首次进入自动调 POST /canvases/init 创建全局灵感板（幂等）
 * - 卡片网格：全局灵感板始终置顶
 * - 右上主操作 [+ 新建画布]
 * - 空态：用 EmptyState 组件
 *
 * 暂未实现（PR2~PR4）：
 * - 来源徽章、运行状态徽章（PR4）
 * - 模板下拉 / 缩略图实时生成（PR4）
 * - 标题搜索、置顶其他画布（v0.2.1）
 */

import { startTransition, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LayoutGrid, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { CanvasCard } from '@/components/canvas/list/CanvasCard'
import { canvasApi } from '@/lib/canvas/api/canvas'
import type { CanvasSummary } from '@/lib/canvas/types'

export default function CanvasListPage() {
  const router = useRouter()
  const [canvases, setCanvases] = useState<CanvasSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const loadList = useCallback(async () => {
    const res = await canvasApi.list()
    return Array.isArray(res?.data) ? res.data : []
  }, [])

  // 首次进入先显示列表；全局灵感板初始化是幂等写路径，放后台避免阻塞切页首屏。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const canvases = await loadList()
        if (cancelled) return
        startTransition(() => {
          setCanvases(canvases)
          setLoading(false)
        })
      } catch (err) {
        if (cancelled) return
        toast.error('加载画布列表失败', { description: (err as Error)?.message })
        startTransition(() => setLoading(false))
      }

      try {
        await canvasApi.init()
        if (cancelled) return
        const next = await loadList()
        if (cancelled) return
        startTransition(() => setCanvases(next))
      } catch (err) {
        console.warn('[canvas] init inspiration board failed:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadList])

  const handleCreate = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const fresh = await canvasApi.create({ title: '未命名画布' })
      router.push(`/canvas/${fresh.id}`)
    } catch (err) {
      toast.error('新建画布失败', { description: (err as Error)?.message })
      setCreating(false)
    }
  }, [creating, router])

  const handleDuplicate = useCallback(
    async (id: string) => {
      try {
        const copy = await canvasApi.duplicate(id)
        toast.success(`已复制：${copy.title}`)
        const list = await loadList()
        startTransition(() => setCanvases(list))
      } catch (err) {
        toast.error('复制失败', { description: (err as Error)?.message })
      }
    },
    [loadList],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('删除后将进入回收站。确认删除？')) return
      try {
        await canvasApi.delete(id)
        toast.success('已删除')
        setCanvases((list) => list.filter((c) => c.id !== id))
      } catch (err) {
        toast.error('删除失败', { description: (err as Error)?.message })
      }
    },
    [],
  )

  return (
    <div className="page-shell animate-fade-up">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="page-title">画布</h1>
          <p className="page-subtitle mt-2">
            把灵感、分镜、角色与媒体素材自由拼接，AI 节点按 DAG 顺序为你生成成片。
          </p>
        </div>
        <Button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="shrink-0 gap-1.5 rounded-[var(--radius-md)] px-4"
        >
          <Plus size={16} />
          新建画布
        </Button>
      </header>

      {loading ? (
        <SkeletonGrid />
      ) : canvases.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          description="还没有画布。新建一个空白画布开始你的第一次创作。"
          actionLabel="新建空白画布"
          onAction={handleCreate}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {canvases.map((canvas) => (
            <CanvasCard
              key={canvas.id}
              canvas={canvas}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="aspect-[5/3] animate-pulse rounded-[var(--radius-md)] border border-border bg-bg-2"
        />
      ))}
    </div>
  )
}
