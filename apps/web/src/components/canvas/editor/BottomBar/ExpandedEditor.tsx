'use client'

/**
 * ExpandedEditor — 底栏第二段：完整编辑器（v0.2.0 PR1.6 → PR3）
 *
 * 两种模式（由 useUiStore.pendingAction 切换）：
 *
 *   1) 常规编辑模式（无 pendingAction）：
 *      - 节点的标签 / 类别 / prompt / 引用 / 上传图
 *      - "完成"按钮 = 收起底栏
 *
 *   2) 业务动作模式（有 pendingAction，从节点右键菜单 trigger）：
 *      - 标题改为 "构想画面 - 镜 3 · 开篇晨景"
 *      - prompt 输入框 placeholder 提示
 *      - 风格 select 接 nodeDef.params['style'].options
 *      - "生成"按钮 → canvasApi.triggerBusinessAction → useRunPolling 监听完成
 *
 * 视觉沿用 PR1.6 token；移除参考项目品牌字样。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Image as ImageIcon,
  Layers,
  MapPin,
  Sparkles,
  Target,
  Upload,
  Wand2,
} from 'lucide-react'
import { nodeRegistry, type CanvasNodeDefinition } from '@xiaochuang/canvas-shared'
import { toast } from 'sonner'

import { cn } from '@/lib/cn'
import { useNodesStore, useUiStore } from '@/lib/canvas/store'
import type { FlowNode } from '@/lib/canvas/store'
import { useRunPolling } from '@/lib/canvas/hooks/useRunPolling'
import { useNodeGenerate } from '@/lib/canvas/hooks/useNodeGenerate'
import {
  defaultPromptForNode,
  getGenerateButtonLabel,
  isGeneratableNodeType,
} from '@/lib/canvas/utils/nodeGenerate'

import { HistoryStrip } from './HistoryStrip'

type CategoryId = 'scene' | 'character' | 'prop'

interface NormalizedFields {
  label: string
  prompt: string
  category: CategoryId | null
  images: string[]
}

function readFields(node: FlowNode | undefined): NormalizedFields | null {
  if (!node) return null
  const d = (node.data ?? {}) as Record<string, unknown>
  const label = (d.label as string) || (d.title as string) || (d.name as string) || ''
  let prompt = ''
  if (node.type === 'storyboard') {
    prompt = (d.prompt as string) || (d.shotDescription as string) || ''
  } else if (node.type === 'character' || node.type === 'scene') {
    prompt = (d.description as string) || (d.prompt as string) || ''
  } else {
    prompt = (d.prompt as string) || ''
  }
  return {
    label,
    prompt,
    category: ((d.category as CategoryId | undefined) ?? null) as CategoryId | null,
    images: Array.isArray(d.images) ? (d.images as string[]) : [],
  }
}

function getStyleOptions(defId?: string): Array<{ value: string; label: string }> {
  if (!defId) return []
  const def: CanvasNodeDefinition | undefined = nodeRegistry[defId]
  const styleParam = def?.params?.find((p) => p.name === 'style')
  return styleParam?.options ?? []
}

export function ExpandedEditor() {
  const selectedNodeId = useUiStore((s) => s.selectedNodeId)
  const collapse = useUiStore((s) => s.collapseToNarrow)
  const setSelectedNodeId = useUiStore((s) => s.setSelectedNodeId)
  const pendingAction = useUiStore((s) => s.pendingAction)
  const clearPendingAction = useUiStore((s) => s.clearPendingAction)
  const nodes = useNodesStore((s) => s.nodes)
  const updateNodeData = useNodesStore((s) => s.updateNodeData)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  // 业务动作模式专属 state（本地受控；不进 nodesStore，避免脏 source 节点 data）
  const [actionInput, setActionInput] = useState('')
  const [actionStyle, setActionStyle] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  const runPolling = useRunPolling()
  const { executeGenerate, generateFromNode } = useNodeGenerate()

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  )
  const fields = useMemo(() => readFields(selectedNode), [selectedNode])

  // pendingAction 切换时由父组件（BottomBar）用 key 重建本组件，
  // 自动让本地 state 回到初始值；这里无需手动 reset。

  const updateField = useCallback(
    <K extends keyof NormalizedFields>(field: K, value: NormalizedFields[K]) => {
      if (!selectedNodeId) return
      const nodeType = selectedNode?.type
      if (field === 'label' && nodeType === 'storyboard') {
        updateNodeData(selectedNodeId, { title: value as string })
      } else if (field === 'prompt') {
        if (nodeType === 'storyboard') {
          updateNodeData(selectedNodeId, {
            shotDescription: value as string,
            prompt: value as string,
          })
        } else if (nodeType === 'character' || nodeType === 'scene') {
          updateNodeData(selectedNodeId, { description: value as string })
        } else {
          updateNodeData(selectedNodeId, { prompt: value as string })
        }
      } else {
        updateNodeData(selectedNodeId, { [field]: value } as Record<string, unknown>)
      }
    },
    [selectedNodeId, selectedNode?.type, updateNodeData],
  )

  // 从右键 / 节点 CTA 进入业务动作模式时，用节点已有描述预填 prompt
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!pendingAction || !selectedNode) return
    setActionInput(defaultPromptForNode(selectedNode))
  }, [pendingAction, selectedNode])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return
      setIsUploading(true)
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        updateField('images', result ? [result] : [])
        setIsUploading(false)
      }
      reader.readAsDataURL(file)
    },
    [updateField],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDraggingOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const insertMention = useCallback(
    (targetId: string) => {
      if (!fields) return
      const mention = `@${targetId}`
      const next = fields.prompt.includes(mention)
        ? fields.prompt.replace(mention, '').trim()
        : `${fields.prompt} ${mention}`.trim()
      updateField('prompt', next)
    },
    [fields, updateField],
  )

  const availableMentions = useMemo(
    () => nodes.filter((n) => n.id !== selectedNodeId && !n.hidden).slice(0, 8),
    [nodes, selectedNodeId],
  )

  // ─── 业务动作触发 ──────────────────────────────────────────────────────
  const handleTriggerAction = useCallback(async () => {
    if (!pendingAction || !selectedNodeId || submitting) return
    setSubmitting(true)
    try {
      const ok = await executeGenerate({
        nodeId: pendingAction.sourceNodeId,
        action: pendingAction.action,
        userInput: actionInput,
        style: actionStyle || undefined,
      })
      if (ok) collapse()
    } finally {
      setSubmitting(false)
    }
  }, [actionInput, actionStyle, collapse, executeGenerate, pendingAction, selectedNodeId, submitting])

  const handleNormalGenerate = useCallback(async () => {
    if (!selectedNodeId || submitting) return
    setSubmitting(true)
    try {
      await generateFromNode(selectedNodeId, fields?.prompt)
    } finally {
      setSubmitting(false)
    }
  }, [fields?.prompt, generateFromNode, selectedNodeId, submitting])

  const handleCancelAction = useCallback(() => {
    clearPendingAction()
    runPolling.stop()
    collapse()
  }, [clearPendingAction, collapse, runPolling])

  if (!selectedNodeId || !fields) return null

  // ─── 模式判定 ────────────────────────────────────────────────────────
  const isActionMode = !!pendingAction
  const styleOptions = isActionMode ? getStyleOptions(pendingAction.action.sourceNodeDefId) : []
  const canGenerate = !!selectedNode && isGeneratableNodeType(selectedNode.type)
  const generateLabel = selectedNode ? getGenerateButtonLabel(selectedNode) : '生成'

  // ─── 顶部 Header ─────────────────────────────────────────────────────
  const headerTitle = isActionMode ? pendingAction.action.label : '编辑节点'
  const subtitle = isActionMode
    ? `${fields.label || '未命名资产'}${
        (selectedNode?.data as { shotIndex?: number })?.shotIndex
          ? ` · 镜 ${(selectedNode?.data as { shotIndex?: number }).shotIndex}`
          : ''
      }`
    : fields.label || '未命名资产'

  return (
    <div className="flex flex-col">
      {/* 常规模式：节点名已在检视面板 Tab 上显示，这里不再重复标题；
          业务动作模式：仍需展示动作名 + 目标节点上下文 */}
      {isActionMode && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Wand2 className="size-4 shrink-0 text-accent" />
          <span className="shrink-0 text-sm font-semibold text-text-0">{headerTitle}</span>
          <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-bg-2 px-2 py-0.5">
            <span className="truncate text-xs text-text-2">{subtitle}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 p-3">
        {/* 图片预览（业务动作模式仅只读预览） */}
        <div
          className={cn(
            'relative cursor-pointer overflow-hidden rounded-lg border-2 border-dashed transition-all',
            isDraggingOver ? 'border-accent bg-accent-bg' : 'border-border hover:border-border-strong',
            isUploading && 'opacity-50',
            isActionMode && 'cursor-default',
          )}
          onClick={() => !isActionMode && fileInputRef.current?.click()}
          onDrop={isActionMode ? undefined : handleDrop}
          onDragOver={
            isActionMode
              ? undefined
              : (e) => {
                  e.preventDefault()
                  setIsDraggingOver(true)
                }
          }
          onDragLeave={isActionMode ? undefined : () => setIsDraggingOver(false)}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInput}
          />
          {fields.images.length > 0 ? (
            <div className="group relative h-40">
              <img
                src={fields.images[0]}
                alt="预览"
                className="size-full object-cover"
              />
              {!isActionMode && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                  <Upload className="size-5 text-white" />
                  <span className="text-xs text-white">点击或拖拽更换</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-2">
              {isUploading ? (
                <>
                  <div className="size-7 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  <span className="text-xs text-text-2">上传中…</span>
                </>
              ) : (
                <>
                  {isActionMode ? (
                    <ImageIcon className="size-7 text-text-3" />
                  ) : (
                    <Upload className="size-7 text-text-3" />
                  )}
                  <span className="text-xs text-text-3">
                    {isActionMode ? '生成结果将出现在此' : '点击 / 拖拽图片'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* 右：常规模式 = label/category/prompt；业务动作模式 = userInput/style */}
        <div className="flex flex-col gap-2.5">
          {isActionMode ? (
            <>
              <textarea
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                placeholder={`描述你想要的画面内容...（动作模板：${pendingAction!.action.promptTemplate}）`}
                className="h-20 w-full resize-none rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-0 placeholder-text-3 transition-colors focus:border-border-focus focus:outline-none"
                autoFocus
              />
              {styleOptions.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] text-text-3">风格</div>
                  <div className="flex flex-wrap gap-1.5">
                    {styleOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setActionStyle((cur) => (cur === opt.value ? '' : opt.value))
                        }
                        className={cn(
                          'rounded-md px-2.5 py-1 text-xs transition-colors',
                          actionStyle === opt.value
                            ? 'bg-accent text-on-accent'
                            : 'border border-border bg-bg-2 text-text-2 hover:bg-bg-hover hover:text-text-0',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
                <button
                  type="button"
                  onClick={handleCancelAction}
                  className="text-xs text-text-3 hover:text-text-1"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleTriggerAction}
                  disabled={submitting || !actionInput.trim()}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-medium transition-colors',
                    'bg-accent text-on-accent shadow-primary-glow hover:bg-accent-dark',
                    (submitting || !actionInput.trim()) && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Sparkles className="size-3.5" />
                  <span>{submitting ? '触发中…' : '生成'}</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <input
                type="text"
                value={fields.label}
                onChange={(e) => updateField('label', e.target.value)}
                placeholder="资产名称"
                className="w-full rounded-md border border-border bg-bg-input px-3 py-1.5 text-sm text-text-0 placeholder-text-3 transition-colors focus:border-border-focus focus:outline-none"
              />

              <div className="flex gap-1.5">
                {[
                  { id: 'scene' as CategoryId, icon: Layers, label: '场景' },
                  { id: 'character' as CategoryId, icon: Target, label: '角色' },
                  { id: 'prop' as CategoryId, icon: MapPin, label: '道具' },
                ].map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      updateField('category', fields.category === id ? null : id)
                    }
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium transition-colors',
                      fields.category === id
                        ? 'bg-accent text-on-accent'
                        : 'border border-border bg-bg-2 text-text-2 hover:bg-bg-hover hover:text-text-0',
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <textarea
                value={fields.prompt}
                onChange={(e) => updateField('prompt', e.target.value)}
                placeholder="描述你想要生成的画面内容；@ 引用其他资产"
                className="h-20 w-full resize-none rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-0 placeholder-text-3 transition-colors focus:border-border-focus focus:outline-none"
              />

              {availableMentions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-text-3">引用：</span>
                  {availableMentions.map((node) => {
                    const data = (node.data ?? {}) as Record<string, unknown>
                    const display =
                      (data.label as string) ||
                      (data.title as string) ||
                      node.id.slice(0, 8)
                    const isMentioned = fields.prompt.includes(`@${node.id}`)
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => insertMention(node.id)}
                        className={cn(
                          'flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors',
                          isMentioned
                            ? 'bg-accent text-on-accent'
                            : 'border border-border bg-bg-2 text-text-2 hover:bg-bg-hover hover:text-text-0',
                        )}
                      >
                        <ImageIcon className="size-3" />
                        <span className="max-w-[80px] truncate">{display}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* 常规模式：随时生成中间素材（成片输入） */}
              <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="text-xs text-text-3 hover:text-text-1"
                >
                  完成
                </button>
                {canGenerate && (
                  <button
                    type="button"
                    onClick={handleNormalGenerate}
                    disabled={submitting}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-medium transition-colors',
                      'bg-accent text-on-accent shadow-primary-glow hover:bg-accent-dark',
                      submitting && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Sparkles className="size-3.5" />
                    <span>{submitting ? '触发中…' : generateLabel}</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 生成历史（仅常规模式 + 当前节点有 historyImages） */}
      {!isActionMode && selectedNodeId && <HistoryStrip nodeId={selectedNodeId} />}
    </div>
  )
}
