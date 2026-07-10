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
import { useRouter } from 'next/navigation'
import { Copy, LayoutGrid, MoreHorizontal, Star, Trash2 } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
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
  const router = useRouter()
  const isInspiration = canvas.source === 'global-inspiration'
  const updated = formatRelative(canvas.updated_at)
  const href = `/canvas/${canvas.id}`
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null)
  const thumbnailSrc = canvas.thumbnail && failedThumbnail !== canvas.thumbnail ? canvas.thumbnail : null

  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('a, button')) return
    router.push(href)
  }

  return (
    <div
      data-testid={`canvas-card-${canvas.id}`}
      onClick={handleCardClick}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden bg-bg-0/80 shadow-[0_1px_0_rgba(15,23,42,0.03)] transition-[background,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-bg-0 hover:shadow-[0_18px_44px_rgba(40,28,18,0.08)]',
      )}
    >
      <Link href={href} className="block" aria-label={`打开画布：${canvas.title}`}>
        <div className="relative aspect-[5/3] w-full overflow-hidden bg-bg-3">
          {thumbnailSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailSrc}
              alt={canvas.title}
              className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
              onError={() => setFailedThumbnail(thumbnailSrc)}
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.62),transparent_46%)] text-text-3/80">
              {isInspiration ? <Star size={30} /> : <LayoutGrid size={30} />}
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
            href={href}
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
              className="size-7 shrink-0 rounded-full bg-bg-2/80 p-0 text-text-3 opacity-0 transition group-hover:opacity-100 hover:bg-bg-hover hover:text-text-0"
              aria-label="更多操作"
              onClick={(event) => event.stopPropagation()}
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
