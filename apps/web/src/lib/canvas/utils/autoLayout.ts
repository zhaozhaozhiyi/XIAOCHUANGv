/**
 * autoLayout — 画布节点自动布局（v2.2 PR-A / PR-C）
 *
 * 按创作层级分列：剧本 → 角色 → 场景 → 分镜 → 执行 → 合成，
 * 同列纵向展开，避免对话生成或手动添加时的叠罗汉。
 */

import type { XYPosition } from '@xyflow/react'

export interface LayeredLayoutOptions {
  originX?: number
  originY?: number
  columnGap?: number
  rowGap?: number
}

export interface LayoutNodeInput {
  id: string
  type?: string
  data?: Record<string, unknown>
  position: XYPosition
}

export interface LayoutEdgeInput {
  source: string
  target: string
}

export interface CanvasLayoutOptions extends LayeredLayoutOptions {
  /** 列内节点是否围绕 originY 垂直居中 */
  centerColumns?: boolean
}

export interface CanvasFitPaddingOptions {
  chatOpen?: boolean
  railOpen?: boolean
}

interface NodeLayoutMeta {
  column: number
  width: number
  height: number
}

/** 节点类型 → 布局元数据（宽高估算，含附签/把手留白） */
const NODE_LAYOUT: Record<string, NodeLayoutMeta> = {
  note: { column: 0, width: 260, height: 160 },
  character: { column: 1, width: 248, height: 220 },
  scene: { column: 2, width: 248, height: 220 },
  storyboard: { column: 3, width: 280, height: 340 },
  image: { column: 3, width: 280, height: 300 },
  'text-to-image': { column: 4, width: 248, height: 200 },
  'image-to-video': { column: 4, width: 248, height: 200 },
  'text-to-speech': { column: 4, width: 248, height: 180 },
  concat: { column: 5, width: 220, height: 140 },
  export: { column: 5, width: 220, height: 140 },
}

const FALLBACK_META: NodeLayoutMeta = { column: 4, width: 248, height: 200 }

const LAYOUT_DEFAULTS: Required<LayeredLayoutOptions> & { centerColumns: boolean } = {
  originX: 80,
  originY: 80,
  columnGap: 72,
  rowGap: 56,
  centerColumns: true,
}

function metaFor(type?: string): NodeLayoutMeta {
  return NODE_LAYOUT[type ?? ''] ?? FALLBACK_META
}

function sortWithinColumn(a: LayoutNodeInput, b: LayoutNodeInput): number {
  if (a.type === 'storyboard' && b.type === 'storyboard') {
    const ai = Number((a.data as { shotIndex?: number })?.shotIndex ?? 0)
    const bi = Number((b.data as { shotIndex?: number })?.shotIndex ?? 0)
    if (ai !== bi) return ai - bi
  }
  return a.id.localeCompare(b.id)
}

/**
 * 对画布上全部节点计算新落点（按列展开，同列不重叠）。
 */
export function layoutCanvasNodes(
  nodes: LayoutNodeInput[],
  _edges?: LayoutEdgeInput[],
  options?: CanvasLayoutOptions,
): Map<string, XYPosition> {
  const o = { ...LAYOUT_DEFAULTS, ...options }
  const positions = new Map<string, XYPosition>()
  if (!nodes.length) return positions

  const buckets = new Map<number, LayoutNodeInput[]>()
  for (const node of nodes) {
    const col = metaFor(node.type).column
    const list = buckets.get(col) ?? []
    list.push(node)
    buckets.set(col, list)
  }

  const columns = [...buckets.keys()].sort((a, b) => a - b)
  let cursorX = o.originX

  for (const col of columns) {
    const colNodes = [...(buckets.get(col) ?? [])].sort(sortWithinColumn)
    const colWidth = Math.max(...colNodes.map((n) => metaFor(n.type).width))
    const totalHeight = colNodes.reduce((sum, n, i) => {
      const h = metaFor(n.type).height
      return sum + h + (i < colNodes.length - 1 ? o.rowGap : 0)
    }, 0)
    let cursorY = o.centerColumns ? o.originY - totalHeight / 2 : o.originY

    for (const node of colNodes) {
      const { height } = metaFor(node.type)
      positions.set(node.id, { x: cursorX, y: cursorY })
      cursorY += height + o.rowGap
    }

    cursorX += colWidth + o.columnGap
  }

  return positions
}

/**
 * fitView 动态留白：侧栏展开时把节点收进可见区域，减少被面板遮挡。
 */
export function getCanvasFitPadding(options?: CanvasFitPaddingOptions): {
  top: number
  right: number
  bottom: number
  left: number
} {
  const chatOpen = options?.chatOpen ?? false
  const railOpen = options?.railOpen ?? false
  return {
    top: 72,
    bottom: 48,
    left: chatOpen ? 400 : 72,
    right: railOpen ? 380 : 72,
  }
}

const DEFAULTS: Required<LayeredLayoutOptions> = {
  originX: 0,
  originY: 0,
  columnGap: 340,
  rowGap: 240,
}

/** 单个节点落点：layer 决定列（x），index 决定行（y）。 */
export function layeredPosition(
  layer: number,
  index: number,
  options?: LayeredLayoutOptions,
): XYPosition {
  const o = { ...DEFAULTS, ...options }
  return {
    x: o.originX + layer * o.columnGap,
    y: o.originY + index * o.rowGap,
  }
}

/** 把一组节点在某一列内纵向居中排布。 */
export function columnPositions(
  layer: number,
  count: number,
  options?: LayeredLayoutOptions,
): XYPosition[] {
  const o = { ...DEFAULTS, ...options }
  const totalHeight = (count - 1) * o.rowGap
  const startY = o.originY - totalHeight / 2
  return Array.from({ length: count }, (_, i) => ({
    x: o.originX + layer * o.columnGap,
    y: startY + i * o.rowGap,
  }))
}
