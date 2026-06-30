'use client'

/**
 * CanvasContextMenu — 画布空白处右键菜单（v0.2.0 PR1.6 token 化）
 *
 * 6 项：上传 / 保存到我的资产 / 添加节点 / 撤销 / 重做 / 粘贴
 * PR1.5/PR1.6 阶段：上传 + 保存到资产 仅 toast 占位（PR4 接 MinIO 真链路）；
 * 其余 4 项已接 historyStore + 真实写入。
 *
 * 仅响应"空白处右键"——节点上的右键由 ReactFlow 默认菜单或 PR3 的节点菜单接管。
 * 视觉：不再覆盖 zinc，让 context-menu primitive 用项目默认 popover token。
 */

import { useState } from 'react'
import {
  ClipboardPaste,
  FolderHeart,
  Plus,
  Redo2,
  Undo2,
  Upload,
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { AddNodeSubmenu } from './AddNodeSubmenu'
import { CanvasUploadDialog } from './CanvasUploadDialog'
import { QuickGenerateDialog } from './QuickGenerateDialog'

interface Props {
  children: React.ReactNode
  /** v0.2.0 PR3 起 onAddNode 改由 AddNodeSubmenu 接管；保留 prop 以备兜底 */
  onAddNode?: () => void
  onUndo: () => void
  onRedo: () => void
  onPaste: () => void
  canUndo: boolean
  canRedo: boolean
  canPaste: boolean
}

export function CanvasContextMenu({
  children,
  onUndo,
  onRedo,
  onPaste,
  canUndo,
  canRedo,
  canPaste,
}: Props) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="size-full">{children}</div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[180px]">
          <ContextMenuItem onClick={() => setUploadOpen(true)}>
            <Upload className="mr-2 size-4" />
            上传
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setQuickOpen(true)}>
            <FolderHeart className="mr-2 size-4" />
            快速生成
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Plus className="mr-2 size-4" />
              添加节点
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-[220px]">
              <AddNodeSubmenu position="screen-center" />
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onUndo} disabled={!canUndo}>
            <Undo2 className="mr-2 size-4" />
            撤销
            <ContextMenuShortcut>⌘Z</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={onRedo} disabled={!canRedo}>
            <Redo2 className="mr-2 size-4" />
            重做
            <ContextMenuShortcut>⇧⌘Z</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={onPaste} disabled={!canPaste}>
            <ClipboardPaste className="mr-2 size-4" />
            粘贴
            <ContextMenuShortcut>⌘V</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CanvasUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <QuickGenerateDialog open={quickOpen} onOpenChange={setQuickOpen} />
    </>
  )
}
