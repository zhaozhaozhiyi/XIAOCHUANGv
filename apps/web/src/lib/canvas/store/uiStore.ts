/**
 * uiStore — 画布 UI 临时状态（v0.2.0 PR1 → PR3）
 *
 * 这些状态不进数据库 / 不影响保存语义：
 * - 底栏两段式展开（PR1.6 接入）
 * - 极简模式（v0.2.0 不做，先占位）
 * - 信息层（v0.2.0 不做，先占位）
 * - MiniMap 折叠
 * - 节点面板可见性
 * - PR3：节点右键菜单 / 业务动作待触发 / 关联模式
 */

import { create } from 'zustand'
import type { ResolvedBusinessAction } from '@xiaochuang/canvas-shared'

/**
 * 底栏三态（v0.2.0 PR1.6，对齐 PRD §7.5 两段式）：
 *   hidden   — 未选中节点
 *   narrow   — 选中节点，48px 窄条（标题 + 景别 + 运镜 + 情绪点 + [E 编辑]）
 *   expanded — 按 E 或点编辑，320px 完整编辑器（图 + 标签 + 类别 + prompt + 引用）
 */
export type BottomBarMode = 'hidden' | 'narrow' | 'expanded'

/**
 * 业务动作待触发槽（PR3）
 *
 * 节点右键菜单点"构想画面"等动作时写入；
 * ExpandedEditor 检测到 pendingAction 时切换为"业务动作模式"：
 *   - 标题变更（"构想画面 - 镜 3"）
 *   - "完成"按钮变 "生成" → 调 canvasApi.triggerBusinessAction
 *   - 生成成功 / 用户关闭后 clear
 */
export interface PendingAction {
  action: ResolvedBusinessAction
  sourceNodeId: string
}

/**
 * 关联模式（PR3，业务动作 6/7：关联到分镜 / 设为分镜背景）
 *
 * 进入后画布光标变十字，用户单击 storyboard 节点时把 sourceNodeId 写入：
 *   - mode === 'character' → storyboard.data.mainCharacterRef = sourceNodeId
 *   - mode === 'scene'     → storyboard.data.sceneBackgroundRef = sourceNodeId
 * Esc / 单击空白 退出关联模式。
 */
export interface AssociateMode {
  sourceNodeId: string
  mode: 'character' | 'scene'
}

/**
 * 节点右键菜单位置（PR3）
 *
 * 屏幕坐标（不是 flow 坐标），用 fixed 定位让 popover 不随 zoom 漂移。
 */
export interface NodeContextMenuPos {
  nodeId: string
  nodeType: string
  x: number
  y: number
}

interface UiState {
  bottomBarMode: BottomBarMode
  miniMapCollapsed: boolean
  isMinimal: boolean
  nodePanelVisible: boolean
  contextMenu: { x: number; y: number; targetType: string; targetId?: string } | null
  selectedNodeId: string | null
  clipboardImage: string | null

  // ─── PR3 新增 ───
  pendingAction: PendingAction | null
  associateMode: AssociateMode | null
  nodeContextMenu: NodeContextMenuPos | null
  /** 设镜头时长 popover（PR3 业务动作 5） */
  durationPopover: { nodeId: string; x: number; y: number } | null

  setBottomBarMode: (mode: BottomBarMode) => void
  expandBottomBar: () => void
  collapseToNarrow: () => void
  toggleExpanded: () => void
  setMiniMapCollapsed: (v: boolean) => void
  setMinimal: (v: boolean) => void
  setNodePanelVisible: (v: boolean) => void
  openContextMenu: (menu: NonNullable<UiState['contextMenu']>) => void
  closeContextMenu: () => void

  setSelectedNodeId: (id: string | null) => void
  toggleSelectedNodeId: (id: string) => void
  setClipboardImage: (img: string | null) => void

  // ─── PR3 ───
  setPendingAction: (p: PendingAction | null) => void
  clearPendingAction: () => void
  setAssociateMode: (m: AssociateMode | null) => void
  clearAssociateMode: () => void
  openNodeContextMenu: (m: NodeContextMenuPos) => void
  closeNodeContextMenu: () => void
  openDurationPopover: (p: { nodeId: string; x: number; y: number }) => void
  closeDurationPopover: () => void
}

export const useUiStore = create<UiState>((set) => ({
  bottomBarMode: 'hidden',
  miniMapCollapsed: false,
  isMinimal: false,
  nodePanelVisible: false,
  contextMenu: null,
  selectedNodeId: null,
  clipboardImage: null,
  pendingAction: null,
  associateMode: null,
  nodeContextMenu: null,
  durationPopover: null,

  setBottomBarMode: (mode) => set({ bottomBarMode: mode }),
  expandBottomBar: () => set({ bottomBarMode: 'expanded' }),
  collapseToNarrow: () =>
    set((s) => ({ bottomBarMode: s.selectedNodeId ? 'narrow' : 'hidden' })),
  toggleExpanded: () =>
    set((s) => {
      if (!s.selectedNodeId) return { bottomBarMode: 'hidden' }
      return { bottomBarMode: s.bottomBarMode === 'expanded' ? 'narrow' : 'expanded' }
    }),
  setMiniMapCollapsed: (v) => set({ miniMapCollapsed: v }),
  setMinimal: (v) => set({ isMinimal: v }),
  setNodePanelVisible: (v) => set({ nodePanelVisible: v }),
  openContextMenu: (menu) => set({ contextMenu: menu }),
  closeContextMenu: () => set({ contextMenu: null }),

  setSelectedNodeId: (id) =>
    set(() => ({
      selectedNodeId: id,
      bottomBarMode: id ? 'narrow' : 'hidden',
    })),
  toggleSelectedNodeId: (id) =>
    set((s) => {
      const nextId = s.selectedNodeId === id ? null : id
      return {
        selectedNodeId: nextId,
        bottomBarMode: nextId ? 'narrow' : 'hidden',
      }
    }),
  setClipboardImage: (img) => set({ clipboardImage: img }),

  // ─── PR3 ───
  setPendingAction: (p) =>
    set(() => ({
      pendingAction: p,
      // 业务动作触发时强制底栏展开，让用户能填 userInput
      ...(p
        ? { selectedNodeId: p.sourceNodeId, bottomBarMode: 'expanded' as const }
        : {}),
    })),
  clearPendingAction: () => set({ pendingAction: null }),
  setAssociateMode: (m) => set({ associateMode: m }),
  clearAssociateMode: () => set({ associateMode: null }),
  openNodeContextMenu: (m) => set({ nodeContextMenu: m }),
  closeNodeContextMenu: () => set({ nodeContextMenu: null }),
  openDurationPopover: (p) => set({ durationPopover: p, nodeContextMenu: null }),
  closeDurationPopover: () => set({ durationPopover: null }),
}))
