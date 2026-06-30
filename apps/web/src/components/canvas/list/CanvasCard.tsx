'use client'

/**
 * CanvasCard — 列表页画布卡片（v0.2.0 PR1）
 *
 * 元素（按 PRD §6）：
 * - 缩略图（运行中显示进度小标，PR4；无内容显示渐变占位）
 * - 标题（点击进入；hover 显示重命名按钮）
 * - 来源徽章 📺（PR4 实装）
 * - 运行状态徽章 ▶ ✓ ⚠（PR4 实装）
 * - 全局灵感板 🌟 始终置顶（外部已排序）
 * - 右键菜单：复制 / 重命名 / 删除（PR1 实现 复制 + 删除；重命名 PR3）
 */

import Link from 'next/link'
import { Copy, MoreHorizontal, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import type { CanvasSummary } from '@/lib/canvas/types'

import { RunStatusBadge } from './RunStatusBadge'
import { SourceBadge } from './SourceBadge'

interface Props {
  canvas: CanvasSummary
  onDuplicate?: (id: string) => void
  onDelete?: (id: string) => void
}

export function CanvasCard({ canvas, onDuplicate, onDelete }: Props) {
  const isInspiration = canvas.source === 'global-inspiration'
  const updated = formatRelative(canvas.updated_at)

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-0 transition hover:border-accent/40 hover:shadow-shadow-sm',
        isInspiration && 'ring-1 ring-accent/40',
      )}
    >
      <Link href={`/canvas/${canvas.id}`} className="block">
        <div className="relative aspect-[5/3] w-full overflow-hidden bg-gradient-to-br from-accent-bg via-bg-2 to-bg-1">
          {canvas.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={canvas.thumbnail}
              alt={canvas.title}
              className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-2xl text-text-3">
              {isInspiration ? '🌟' : '🎨'}
            </div>
          )}
          {/* PR4：来源徽章（左上） + 运行状态徽章（右上） */}
          <div className="absolute left-2 top-2">
            <SourceBadge summary={canvas} />
          </div>
          <div className="absolute right-2 top-2">
            <RunStatusBadge summary={canvas} />
          </div>
        </div>
      </Link>

      <div className="flex items-start justify-between gap-2 px-4 pb-4 pt-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/canvas/${canvas.id}`}
            className="block truncate text-sm font-medium text-text-0 hover:text-accent"
            title={canvas.title}
          >
            {canvas.title}
          </Link>
          <p className="mt-1 text-xs text-text-3">{updated}</p>
        </div>

        {/* 灵感板不可重命名/删除（仅复制） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-7 shrink-0 rounded-md p-0 text-text-3 opacity-0 transition group-hover:opacity-100 hover:bg-bg-2 hover:text-text-0"
              aria-label="更多操作"
            >
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {onDuplicate && (
              <DropdownMenuItem onSelect={() => onDuplicate(canvas.id)}>
                <Copy size={14} className="mr-2" /> 复制
              </DropdownMenuItem>
            )}
            {!isInspiration && onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => onDelete(canvas.id)}
                  className="text-error focus:text-error"
                >
                  <Trash2 size={14} className="mr-2" /> 删除
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
