'use client'

/**
 * CanvasEditor — React Flow 主容器（v0.2.0 PR1.5）
 *
 * PR1.5 在 PR1 骨架上叠加（移植参考项目【画布】的交互）：
 * - 自定义 ImageNode（三态 single/multi/empty/note）+ 全 nodeType alias
 * - 右键菜单：上传 / 保存到素材 / 添加节点 / 撤销 / 重做 / 粘贴
 * - 左浮工具栏（添加 / 自动布局 / 图层 / 撤销 / 重做 / 帮助 / 更多）
 * - 底部状态栏（用户/消息槽位 + 缩放 -/+/百分比）
 * - 选中节点 → 底部 BottomPromptComposer 浮窗编辑
 * - 撤销/重做栈（节点拖结束 / 连线增删 / 节点增删 时 push）
 * - 全局快捷键：⌘Z / ⇧⌘Z / ⌘V / Esc / Del / Backspace
 * - snap to grid 16×16 + 初始 fitView + minimap 按 category 上色
 *
 * 保留 PR1 行为：debounced save、viewport 同步、isValidConnection。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowProps,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toast } from 'sonner'

import { cn } from '@/lib/cn'
import { canvasApi } from '@/lib/canvas/api/canvas'
import {
  useCanvasStore,
  useEdgesStore,
  useHistoryStore,
  useNodesStore,
  usePipelineStore,
  useUiStore,
  type FlowNode,
} from '@/lib/canvas/store'
import { useDebouncedSave } from '@/lib/canvas/hooks/useDebouncedSave'
import { useAutoLayout } from '@/lib/canvas/hooks/useAutoLayout'
import { useRunStatus } from '@/lib/canvas/hooks/useRunStatus'
import { isValidConnection } from '@/lib/canvas/utils/isValidConnection'
import { getMinimapNodeColor } from '@/lib/canvas/utils/minimap-colors'

// PR2：10 节点 + 2 边类型组件
import * as canvasNodes from '@/components/canvas/nodes'
import * as canvasEdges from '@/components/canvas/edges'

import { cryptoRandomId, findFreePosition } from './_utils'
import { CanvasContextMenu } from './CanvasContextMenu'
import { CanvasEmptyState } from './CanvasEmptyState'
import { ChatDock } from './ChatDock'
import { InspectorPanel } from './InspectorPanel'
import { LeftToolbar } from './LeftToolbar'
import { NodeContextMenu } from './NodeContextMenu'
import { DurationPopover } from './DurationPopover'
import { TopBarSkeleton } from './TopBarSkeleton'
import { GenerateMovieDialog } from '../modals/GenerateMovieDialog'

/**
 * PR2：10 个独立节点组件（5 内容 + 5 执行），按 nodeRegistry.id 注册。
 * imageNode / default 兜底走 ImageNode（旧 PR1 数据 + 新建空节点）。
 */
const NODE_TYPES: NodeTypes = {
  // 5 内容
  storyboard: canvasNodes.StoryboardNode,
  image: canvasNodes.ImageNode,
  'video-asset': canvasNodes.VideoAssetNode,
  character: canvasNodes.CharacterNode,
  scene: canvasNodes.SceneNode,
  audio: canvasNodes.AudioNode,
  note: canvasNodes.NoteNode,
  // 5 执行
  'text-to-image': canvasNodes.TextToImageNode,
  'image-to-video': canvasNodes.ImageToVideoNode,
  'text-to-speech': canvasNodes.TextToSpeechNode,
  concat: canvasNodes.ConcatNode,
  export: canvasNodes.ExportNode,
  // 兜底
  imageNode: canvasNodes.ImageNode,
  default: canvasNodes.ImageNode,
}

/**
 * PR2：2 种 edge 类型 — narrative（叙事 8 种 RelationType）/ dataflow（数据流光点）
 * 根据 edge_kind 选组件；新连线在 edgesStore.addConnection 里按 portType 自动设 type
 */
const EDGE_TYPES: EdgeTypes = {
  narrative: canvasEdges.NarrativeEdge,
  dataflow: canvasEdges.DataflowEdge,
  default: canvasEdges.NarrativeEdge,
}

function InnerEditor() {
  const canvasId = useCanvasStore((s) => s.canvasId)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const markEditing = useCanvasStore((s) => s.markEditing)

  const nodes = useNodesStore((s) => s.nodes)
  const applyNodeChanges = useNodesStore((s) => s.applyChanges)
  const addNode = useNodesStore((s) => s.addNode)

  const edges = useEdgesStore((s) => s.edges)
  const applyEdgeChanges = useEdgesStore((s) => s.applyChanges)
  const addConnection = useEdgesStore((s) => s.addConnection)

  const setSelectedNodeId = useUiStore((s) => s.setSelectedNodeId)
  const expandBottomBar = useUiStore((s) => s.expandBottomBar)
  const bottomBarMode = useUiStore((s) => s.bottomBarMode)
  const toggleExpanded = useUiStore((s) => s.toggleExpanded)
  const collapseToNarrow = useUiStore((s) => s.collapseToNarrow)
  const clipboardImage = useUiStore((s) => s.clipboardImage)
  const setClipboardImage = useUiStore((s) => s.setClipboardImage)
  // PR3：节点右键 + 业务动作 + 关联模式
  const openNodeContextMenu = useUiStore((s) => s.openNodeContextMenu)
  const closeNodeContextMenu = useUiStore((s) => s.closeNodeContextMenu)
  const associateMode = useUiStore((s) => s.associateMode)
  const clearAssociateMode = useUiStore((s) => s.clearAssociateMode)
  const updateNodeData = useNodesStore((s) => s.updateNodeData)

  const historyPush = useHistoryStore((s) => s.push)
  const historyUndo = useHistoryStore((s) => s.undo)
  const historyRedo = useHistoryStore((s) => s.redo)
  const past = useHistoryStore((s) => s.past)
  const future = useHistoryStore((s) => s.future)
  const canUndo = past.length > 0
  const canRedo = future.length > 0

  // 右侧检视面板展开时让出小地图（避免覆盖），收起时恢复
  const inspectorOpen = usePipelineStore((s) => s.railOpen)
  const chatOpen = usePipelineStore((s) => s.chatOpen)

  const reactFlow = useReactFlow()
  const { applyAutoLayout, fitWithPanels } = useAutoLayout()

  const nodeTypes = useMemo(() => NODE_TYPES, [])
  const edgeTypes = useMemo(() => EDGE_TYPES, [])

  // ─── 保存链路（保留 PR1） ──────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!canvasId) return
    const { nodes: latestNodes } = useNodesStore.getState()
    const { edges: latestEdges } = useEdgesStore.getState()
    const { viewport } = useCanvasStore.getState()
    await canvasApi.save(canvasId, {
      nodes: latestNodes.map((n) => ({
        id: n.id,
        type: (n.type ?? 'note') as FlowNode['type'] & string,
        position: n.position,
        width: typeof n.width === 'number' ? n.width : undefined,
        data: n.data ?? {},
        hidden: n.hidden,
      })) as never,
      edges: latestEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        edge_kind: e.data?.edge_kind ?? 'narrative',
        relation_type: e.data?.relation_type,
        source_port: e.data?.source_port,
        target_port: e.data?.target_port,
      })) as never,
      viewport,
    })
  }, [canvasId])

  useDebouncedSave({ delay: 3000, enabled: !!canvasId, onSave: handleSave })

  // ─── React Flow 事件 ──────────────────────────────────────────────────────
  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      // 拖动结束（dragging:false）+ remove 时 push 历史栈
      const shouldSnap = changes.some(
        (c) =>
          (c.type === 'position' && 'dragging' in c && c.dragging === false) ||
          c.type === 'remove',
      )
      if (shouldSnap) historyPush()
      applyNodeChanges(changes)

      // 删除给可撤销提示（Del/Backspace 易误删，尤其 Backspace）
      const removeCount = changes.filter((c) => c.type === 'remove').length
      if (removeCount > 0) {
        toast(`已删除 ${removeCount} 个节点`, {
          action: { label: '撤销', onClick: () => historyUndo() },
        })
      }
    },
    [applyNodeChanges, historyPush, historyUndo],
  )

  const handleEdgesChange = useCallback<NonNullable<ReactFlowProps['onEdgesChange']>>(
    (changes) => {
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) {
        historyPush()
      }
      applyEdgeChanges(changes as never)
    },
    [applyEdgeChanges, historyPush],
  )

  const handleConnect = useCallback<NonNullable<ReactFlowProps['onConnect']>>(
    (connection) => {
      historyPush()
      addConnection(connection)
    },
    [addConnection, historyPush],
  )

  const handleMoveEnd = useCallback<NonNullable<ReactFlowProps['onMoveEnd']>>(
    (_e, viewport) => {
      setViewport(viewport)
      // viewport 变化不算"待保存"——pan/zoom 不污染保存语义
    },
    [setViewport],
  )

  const handlePaneClick = useCallback(() => {
    // 关联模式下点空白不清选中，让用户能继续找目标分镜
    if (associateMode) return
    setSelectedNodeId(null)
    closeNodeContextMenu()
  }, [associateMode, closeNodeContextMenu, setSelectedNodeId])

  // PR3：节点单击处理
  // - 普通：toggleSelect 已在 NodeBase 内部接管（点节点 → uiStore.toggleSelectedNodeId）
  // - 关联模式：单击 storyboard 节点 → 写入 mainCharacterRef / sceneBackgroundRef → 退出模式
  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (!associateMode) return
      if (node.type !== 'storyboard') {
        toast.info('请选择一个分镜节点')
        return
      }
      const field = associateMode.mode === 'character' ? 'mainCharacterRef' : 'sceneBackgroundRef'
      updateNodeData(node.id, { [field]: associateMode.sourceNodeId })
      toast.success(associateMode.mode === 'character' ? '已关联到分镜' : '已设为分镜背景')
      clearAssociateMode()
    },
    [associateMode, clearAssociateMode, updateNodeData],
  )

  // 双击节点 = 选中 + 直接展开编辑器（对齐"双击对象=编辑"直觉）
  // 关联模式下不接管，交给单击逻辑找目标分镜
  const handleNodeDoubleClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (associateMode) return
      setSelectedNodeId(node.id)
      expandBottomBar()
    },
    [associateMode, expandBottomBar, setSelectedNodeId],
  )

  // PR3：节点右键打开 NodeContextMenu
  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault()
      openNodeContextMenu({
        nodeId: node.id,
        nodeType: node.type || 'default',
        x: e.clientX,
        y: e.clientY,
      })
    },
    [openNodeContextMenu],
  )

  // ─── 添加节点 / 粘贴 ──────────────────────────────────────────────────────
  const addEmptyAt = useCallback(
    (pos: XYPosition) => {
      historyPush()
      const id = `node_${cryptoRandomId()}`
      const newNode: FlowNode = {
        id,
        // PR2：用 nodeRegistry['image'] 真正的 ImageNode 渲染（替代 PR1.x 兜底）
        type: 'image',
        position: findFreePosition(pos, useNodesStore.getState().nodes),
        data: { label: '', images: [] },
      }
      addNode(newNode)
      markEditing()
      setSelectedNodeId(id)
    },
    [addNode, historyPush, markEditing, setSelectedNodeId],
  )

  // PR3 起"添加节点"由 AddNodeSubmenu（左工具栏 popover / 右键子菜单）接管，
  // handleAddNode 旧入口已下线；addEmptyAt 仍保留给双击空白处使用。

  const handlePaneDblClick = useCallback(
    (event: React.MouseEvent) => {
      // 仅响应画布点阵区域双击——节点交给 onNodeDoubleClick；浮层（ChatDock 等）
      // 与 Controls/MiniMap 上的双击会冒泡到本层，必须排除
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-node-id]')) return
      if (!target?.closest('.react-flow__pane')) return
      const pos = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      addEmptyAt({ x: pos.x - 96, y: pos.y - 96 })
    },
    [addEmptyAt, reactFlow],
  )

  const handlePaste = useCallback(async () => {
    let img = clipboardImage
    // 优先尝试系统剪贴板（如果还没缓存的话）
    if (!img && typeof navigator !== 'undefined' && navigator.clipboard?.read) {
      try {
        const items = await navigator.clipboard.read()
        for (const it of items) {
          const type = it.types.find((t) => t.startsWith('image/'))
          if (type) {
            const blob = await it.getType(type)
            img = await new Promise<string>((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(r.result as string)
              r.onerror = () => reject(r.error)
              r.readAsDataURL(blob)
            })
            setClipboardImage(img)
            break
          }
        }
      } catch {
        // 用户未授权或浏览器不支持 — 静默
      }
    }
    if (!img) {
      toast.info('剪贴板没有图片', { description: 'Ctrl+V 粘贴前先复制一张图' })
      return
    }
    historyPush()
    const id = `node_${cryptoRandomId()}`
    const pos = reactFlow.screenToFlowPosition({
      x: typeof window !== 'undefined' ? window.innerWidth / 2 : 600,
      y: typeof window !== 'undefined' ? window.innerHeight / 2 : 400,
    })
    addNode({
      id,
      type: 'image',
      position: findFreePosition(
        { x: pos.x - 128, y: pos.y - 80 },
        useNodesStore.getState().nodes,
      ),
      data: { label: '粘贴图片', images: [img] },
    })
    markEditing()
    setSelectedNodeId(id)
  }, [
    addNode,
    clipboardImage,
    historyPush,
    markEditing,
    reactFlow,
    setClipboardImage,
    setSelectedNodeId,
  ])

  // ─── 全局快捷键 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 输入框 / textarea 内不拦截
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        // 仅 Esc 在输入框内也响应
        if (e.key === 'Escape') {
          ;(target as HTMLElement).blur()
        }
        return
      }

      const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
      const mod = isMac ? e.metaKey : e.ctrlKey

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        historyUndo()
      } else if (mod && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault()
        historyRedo()
      } else if (mod && e.key === 'v') {
        // 不 preventDefault，让 textarea/input 仍能正常粘贴文本
        void handlePaste()
      } else if (mod && (e.key === 'd' || e.key === 'D')) {
        // PRD §9.4 Ctrl+D 复制选中节点
        e.preventDefault()
        const sel = useUiStore.getState().selectedNodeId
        if (!sel) return
        const src = useNodesStore.getState().nodes.find((n) => n.id === sel)
        if (!src) return
        historyPush()
        const newId = `node_${cryptoRandomId()}`
        useNodesStore.getState().addNode({
          ...src,
          id: newId,
          position: { x: src.position.x + 40, y: src.position.y + 40 },
          selected: false,
          data: JSON.parse(JSON.stringify(src.data ?? {})),
        })
        markEditing()
        setSelectedNodeId(newId)
      } else if (mod && (e.key === 'a' || e.key === 'A')) {
        // 全选（框选/多选）尚未实装：仅拦截浏览器原生"选中页面文本"，不弹占位提示
        e.preventDefault()
      } else if (mod && (e.key === 'g' || e.key === 'G')) {
        // 打组尚未实装：拦截浏览器默认行为，不弹占位提示
        e.preventDefault()
      } else if (mod && (e.key === 's' || e.key === 'S')) {
        // PRD §9.4 Ctrl+S 手动保存（绕过 3s 防抖）
        e.preventDefault()
        if (!canvasId) return
        const c = useCanvasStore.getState()
        c.setSaveStatus('saving')
        void handleSave()
          .then(() => c.setSaveStatus('saved', new Date().toISOString()))
          .catch((err) => {
            c.setSaveStatus('error')
            toast.error('手动保存失败', { description: (err as Error)?.message })
          })
      } else if (e.key === 'e' || e.key === 'E') {
        // PRD §7.5：E 切换底栏窄条 ↔ 展开（需先有选中节点）
        if (useUiStore.getState().selectedNodeId) {
          e.preventDefault()
          toggleExpanded()
        }
      } else if (e.key === 'Escape') {
        // Esc 优先级：关联模式 → 展开底栏 → 选中态
        const u = useUiStore.getState()
        if (u.associateMode) {
          u.clearAssociateMode()
          return
        }
        if (u.bottomBarMode === 'expanded') {
          collapseToNarrow()
        } else {
          setSelectedNodeId(null)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    historyRedo,
    historyUndo,
    handlePaste,
    setSelectedNodeId,
    toggleExpanded,
    collapseToNarrow,
    historyPush,
    markEditing,
    canvasId,
    handleSave,
  ])

  // ─── 初始 fitView（一次性） ──────────────────────────────────────────────
  useEffect(() => {
    if (nodes.length > 0) {
      fitWithPanels()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId])

  // 侧栏展开/收起时重新 fitView，避免节点被对话栏或检视面板遮挡
  useEffect(() => {
    if (nodes.length === 0) return
    fitWithPanels()
  }, [chatOpen, inspectorOpen, nodes.length, fitWithPanels])

  // PR3：关联模式时 cursor 变十字
  const cursorClass = associateMode ? 'cursor-crosshair' : ''

  // PR4：useRunStatus + GenerateMovieDialog 开关
  const runStatus = useRunStatus(canvasId)
  const [generateOpen, setGenerateOpen] = useState(false)
  const handleGenerateStart = useCallback(
    (runId: string) => {
      runStatus.start(runId, {
        onComplete: () => {
          toast.success('成片生成完成', { description: '已落资产库' })
        },
        onFailed: () => {
          toast.error('生成失败', { description: '请查看节点状态详情' })
        },
      })
    },
    [runStatus],
  )

  return (
    <CanvasContextMenu
      onUndo={historyUndo}
      onRedo={historyRedo}
      onPaste={handlePaste}
      canUndo={canUndo}
      canRedo={canRedo}
      canPaste={!!clipboardImage}
    >
      <div className="flex h-full flex-col">
        <TopBarSkeleton
          onOpenGenerate={() => setGenerateOpen(true)}
          onCancelRun={runStatus.stop}
        />
        <div
          className={cn('relative min-h-0 flex-1 bg-canvas-bg', cursorClass)}
          onDoubleClick={handlePaneDblClick}
        >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onMoveEnd={handleMoveEnd}
          onPaneClick={handlePaneClick}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeContextMenu={handleNodeContextMenu}
          isValidConnection={isValidConnection}
          minZoom={0.25}
          maxZoom={4}
          snapToGrid
          snapGrid={[16, 16]}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={['Delete', 'Backspace']}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          defaultEdgeOptions={{
            type: 'default',
            // 用项目 accent（陶土橙）作为连线色，与品牌一致
            style: { stroke: 'var(--canvas-edge)', strokeWidth: 2 },
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--canvas-grid-dot)"
          />
          <Controls
            position="bottom-left"
            showInteractive={false}
            className="!bottom-3 !left-3 !rounded-lg !border !border-border !bg-canvas-surface !shadow-default [&_button]:!border-border [&_button]:!bg-bg-1 [&_button:hover]:!bg-bg-hover [&_svg]:!fill-canvas-text"
          />
          {!inspectorOpen && (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeStrokeWidth={2}
            maskColor="var(--canvas-minimap-mask)"
            className="!bottom-3 !right-3 !rounded-lg !border !border-border !bg-canvas-surface"
            nodeColor={getMinimapNodeColor}
          />
          )}
        </ReactFlow>

        <CanvasEmptyState />
        <LeftToolbar
          onUndo={historyUndo}
          onRedo={historyRedo}
          onAutoLayout={() => applyAutoLayout()}
          canUndo={canUndo}
          canRedo={canRedo}
          canAutoLayout={nodes.length > 0}
        />
        {/* v2.2 PR-A：左=对话编排；右=统一检视面板（流程/属性 Tab），
            与 LeftToolbar 同为 overlay，共用同一 React Flow 画布 */}
        <ChatDock />
        <InspectorPanel />
        <NodeContextMenu />
        <DurationPopover />
        </div>
        <GenerateMovieDialog
          open={generateOpen}
          onOpenChange={setGenerateOpen}
          onStart={handleGenerateStart}
        />
      </div>
    </CanvasContextMenu>
  )
}

export function CanvasEditor() {
  return (
    <ReactFlowProvider>
      <InnerEditor />
    </ReactFlowProvider>
  )
}
