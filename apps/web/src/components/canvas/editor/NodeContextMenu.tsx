'use client'

/**
 * NodeContextMenu — 节点右键菜单（v0.2.0 PR3）
 *
 * 通过 useUiStore.nodeContextMenu 控制开关；右键节点时 CanvasEditor 写入坐标。
 * fixed 屏幕坐标定位，不随 zoom 漂移。
 *
 * 菜单内容（按节点 type 分组）：
 *   - 业务动作（resolveBusinessActions(nodeRegistry, ctx) 拿）
 *   - PR3 专属"关联到分镜" / "设为分镜背景"（不属 BusinessAction schema，单独走 enterAssociateMode）
 *   - 通用动作：标记已确认（仅 storyboard）/ 复制 / 删除
 *
 * 点外 / Esc / 选中菜单项后自动关闭。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookmarkCheck,
  Clock,
  Copy,
  FolderHeart,
  History,
  Link2,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'

import { toast } from 'sonner'

import { cn } from '@/lib/cn'
import { canvasApi } from '@/lib/canvas/api/canvas'
import { useBusinessActions } from '@/lib/canvas/hooks/useBusinessActions'
import {
  useCanvasStore,
  useHistoryStore,
  useNodesStore,
  useUiStore,
} from '@/lib/canvas/store'
import type { StoryboardData } from '@/lib/canvas/types'
import { cryptoRandomId } from './_utils'
import { NodeResultHistoryPanel } from './NodeResultHistoryPanel'
import { QuickGenerateDialog } from './QuickGenerateDialog'

export function NodeContextMenu() {
  const pos = useUiStore((s) => s.nodeContextMenu)
  const close = useUiStore((s) => s.closeNodeContextMenu)
  const node = useNodesStore((s) =>
    pos ? s.nodes.find((n) => n.id === pos.nodeId) : undefined,
  )
  const { resolve, trigger, enterAssociateMode } = useBusinessActions()
  const updateNodeData = useNodesStore((s) => s.updateNodeData)
  const addNode = useNodesStore((s) => s.addNode)
  const deleteNode = useNodesStore((s) => s.deleteNode)
  const markEditing = useCanvasStore((s) => s.markEditing)
  const historyPush = useHistoryStore((s) => s.push)
  const historyUndo = useHistoryStore((s) => s.undo)
  const openDurationPopover = useUiStore((s) => s.openDurationPopover)
  const canvasId = useCanvasStore((s) => s.canvasId)
  const [historyNodeId, setHistoryNodeId] = useState<string | null>(null)
  const [quickNodeId, setQuickNodeId] = useState<string | null>(null)

  const menuRef = useRef<HTMLDivElement | null>(null)

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!pos) return
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // 延迟一帧，避免同帧右键事件 trigger 立刻把自己关掉
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onClickOutside)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [pos, close])

  const businessActions = useMemo(() => {
    if (!pos) return []
    return resolve(pos.nodeType)
  }, [pos, resolve])

  // 关联类入口（不属 BusinessAction schema，纯前端交互）
  const associateActions = useMemo(() => {
    if (!pos) return []
    if (pos.nodeType === 'character') {
      return [{ id: 'associate-character', label: '关联到分镜', icon: Link2, mode: 'character' as const }]
    }
    if (pos.nodeType === 'scene') {
      return [{ id: 'associate-scene', label: '设为分镜背景', icon: Link2, mode: 'scene' as const }]
    }
    return []
  }, [pos])

  const handleDuplicate = useCallback(() => {
    if (!node) return
    historyPush()
    const newId = `node_${cryptoRandomId()}`
    addNode({
      ...node,
      id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      selected: false,
      data: JSON.parse(JSON.stringify(node.data ?? {})),
    })
    markEditing()
    close()
  }, [addNode, close, historyPush, markEditing, node])

  const handleDelete = useCallback(() => {
    if (!node) return
    historyPush()
    deleteNode(node.id)
    close()
    toast('已删除 1 个节点', {
      action: { label: '撤销', onClick: () => historyUndo() },
    })
  }, [close, deleteNode, historyPush, historyUndo, node])

  const handleToggleConfirm = useCallback(() => {
    if (!node) return
    const d = (node.data ?? {}) as StoryboardData
    const next = d.markStatus === 'confirmed' ? 'none' : 'confirmed'
    updateNodeData(node.id, { markStatus: next })
    close()
  }, [close, node, updateNodeData])

  const handleOpenDuration = useCallback(() => {
    if (!pos) return
    openDurationPopover({ nodeId: pos.nodeId, x: pos.x, y: pos.y })
  }, [openDurationPopover, pos])

  const handleSaveAsset = useCallback(async () => {
    if (!canvasId || !node) return
    try {
      await canvasApi.saveNodeResultToAsset(canvasId, { node_id: node.id })
      toast.success('已保存到资产库')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存资产失败')
    } finally {
      close()
    }
  }, [canvasId, close, node])

  if (!pos || !node) return renderDialogs(historyNodeId, setHistoryNodeId, quickNodeId, setQuickNodeId)

  const isStoryboard = pos.nodeType === 'storyboard'
  const markStatus = ((node.data ?? {}) as StoryboardData).markStatus

  return (
    <>
      <div
        ref={menuRef}
        role="menu"
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        className="pointer-events-auto fixed z-50 min-w-[200px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-default"
        style={{
          left: Math.min(pos.x, typeof window !== 'undefined' ? window.innerWidth - 220 : pos.x),
          top: Math.min(pos.y, typeof window !== 'undefined' ? window.innerHeight - 320 : pos.y),
        }}
      >
        {/* 业务动作（来自 nodeRegistry.businessActions） */}
        {businessActions.length > 0 && (
          <>
            <SectionLabel>业务动作</SectionLabel>
            {businessActions.map((a) => (
              <MenuItem
                key={`${a.sourceNodeDefId}:${a.label}`}
                icon={Wand2}
                label={a.label}
                onClick={() => trigger(a, pos.nodeId)}
              />
            ))}
          </>
        )}

        {/* 关联类（character/scene） */}
        {associateActions.length > 0 && (
          <>
            {businessActions.length > 0 && <Sep />}
            <SectionLabel>关联</SectionLabel>
            {associateActions.map((a) => (
              <MenuItem
                key={a.id}
                icon={a.icon}
                label={a.label}
                onClick={() => enterAssociateMode(pos.nodeId, a.mode)}
              />
            ))}
          </>
        )}

        {(businessActions.length > 0 || associateActions.length > 0) && <Sep />}

        {/* 通用动作 */}
        {isStoryboard && (
          <>
            <MenuItem icon={Clock} label="设镜头时长" onClick={handleOpenDuration} />
            <MenuItem
              icon={BookmarkCheck}
              label={markStatus === 'confirmed' ? '取消确认' : '标记已确认'}
              onClick={handleToggleConfirm}
            />
          </>
        )}
        <MenuItem icon={History} label="查看生成历史" onClick={() => { setHistoryNodeId(node.id); close() }} />
        <MenuItem icon={FolderHeart} label="保存当前结果到资产" onClick={() => void handleSaveAsset()} />
        <MenuItem icon={Sparkles} label="基于此节点快速生成" onClick={() => { setQuickNodeId(node.id); close() }} />
        <MenuItem icon={Copy} label="复制" shortcut="⌘D" onClick={handleDuplicate} />
        <MenuItem
          icon={Trash2}
          label="删除"
          shortcut="Del"
          variant="destructive"
          onClick={handleDelete}
        />

        <Sep />
        <MenuItem icon={X} label="取消" shortcut="Esc" onClick={close} />
      </div>
      {renderDialogs(historyNodeId, setHistoryNodeId, quickNodeId, setQuickNodeId, pos.nodeType)}
    </>
  )
}

function renderDialogs(
  historyNodeId: string | null,
  setHistoryNodeId: (id: string | null) => void,
  quickNodeId: string | null,
  setQuickNodeId: (id: string | null) => void,
  sourceNodeDefId?: string,
) {
  return (
    <>
      <NodeResultHistoryPanel open={Boolean(historyNodeId)} onOpenChange={(open) => !open && setHistoryNodeId(null)} nodeId={historyNodeId} />
      <QuickGenerateDialog
        open={Boolean(quickNodeId)}
        onOpenChange={(open) => !open && setQuickNodeId(null)}
        sourceNodeId={quickNodeId || undefined}
        sourceNodeDefId={sourceNodeDefId}
      />
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-3">
      {children}
    </div>
  )
}

function Sep() {
  return <div className="my-1 h-px bg-border" />
}

function MenuItem({
  icon: Icon,
  label,
  shortcut,
  variant = 'default',
  onClick,
}: {
  icon: React.ElementType
  label: string
  shortcut?: string
  variant?: 'default' | 'destructive'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        variant === 'destructive'
          ? 'text-error hover:bg-error-bg focus:bg-error-bg'
          : 'text-text-0 hover:bg-bg-hover focus:bg-bg-hover',
        'focus:outline-none',
      )}
    >
      <Icon className={cn('size-4 shrink-0', variant === 'destructive' ? 'text-error' : 'text-text-2')} />
      <span className="flex-1">{label}</span>
      {shortcut && (
        <kbd className="rounded bg-bg-2 px-1 py-0.5 font-mono text-[10px] text-text-3">
          {shortcut}
        </kbd>
      )}
    </button>
  )
}
