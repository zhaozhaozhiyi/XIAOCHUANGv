'use client'

/**
 * LeftToolbar — 左浮垂直工具栏（v0.2.0 PR1.6 token / PR3 加节点 palette）
 *
 * 7 个图标：添加 / 自动布局 / 图层 / 撤销 / 重做 / 帮助 / 更多
 * - 添加节点：popover 展开 AddNodeSubmenu（10 节点 palette）
 * - 撤销/重做：真接 handler
 * - 其他：PR3 / PR4 接入，先 toast 占位
 */

import { useState } from 'react'
import { BookOpenText, LayoutGrid, Plus, Redo2, Undo2 } from 'lucide-react'

import { cn } from '@/lib/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { AddNodeSubmenu } from './AddNodeSubmenu'
import { AssetLibraryPopover } from './AssetLibraryPopover'

interface Props {
  onUndo: () => void
  onRedo: () => void
  onAutoLayout: () => void
  canUndo: boolean
  canRedo: boolean
  canAutoLayout: boolean
}

export function LeftToolbar({
  onUndo,
  onRedo,
  onAutoLayout,
  canUndo,
  canRedo,
  canAutoLayout,
}: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [assetOpen, setAssetOpen] = useState(false)

  return (
    <TooltipProvider delayDuration={0}>
      <div className="pointer-events-none absolute left-3 top-1/2 z-30 -translate-y-1/2">
        <div className="pointer-events-auto flex flex-col gap-1.5 rounded-2xl border border-border bg-bg-surface p-2 shadow-default backdrop-blur-md">
          {/* 添加节点 — popover */}
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="group flex size-10 items-center justify-center rounded-lg transition-all duration-150 hover:bg-bg-hover"
                  >
                    <Plus className="size-5 text-text-1 transition-colors group-hover:text-accent" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="border-border bg-popover text-xs text-popover-foreground"
              >
                添加节点
              </TooltipContent>
            </Tooltip>
            <PopoverContent side="right" align="start" className="w-56 p-1">
              <AddNodeSubmenu
                position="screen-center"
                onCreated={() => setAddOpen(false)}
              />
            </PopoverContent>
          </Popover>

          <Popover open={assetOpen} onOpenChange={setAssetOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="group flex size-10 items-center justify-center rounded-lg transition-all duration-150 hover:bg-bg-hover"
                  >
                    <BookOpenText className="size-5 text-text-1 transition-colors group-hover:text-accent" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="border-border bg-popover text-xs text-popover-foreground"
              >
                引用资产
              </TooltipContent>
            </Tooltip>
            <PopoverContent side="right" align="start" className="w-[380px] p-3">
              <AssetLibraryPopover onInserted={() => setAssetOpen(false)} />
            </PopoverContent>
          </Popover>

          <ToolButton
            icon={LayoutGrid}
            label="自动布局"
            onClick={onAutoLayout}
            disabled={!canAutoLayout}
          />

          <ToolButton
            icon={Undo2}
            label="撤销 ⌘Z"
            onClick={onUndo}
            disabled={!canUndo}
          />
          <ToolButton
            icon={Redo2}
            label="重做 ⇧⌘Z"
            onClick={onRedo}
            disabled={!canRedo}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ElementType
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            'group flex size-10 items-center justify-center rounded-lg transition-all duration-150',
            disabled ? 'cursor-not-allowed opacity-30' : 'hover:bg-bg-hover',
          )}
        >
          <Icon
            className={cn(
              'size-5 text-text-1 transition-colors',
              !disabled && 'group-hover:text-accent',
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        className="border-border bg-popover text-xs text-popover-foreground"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
