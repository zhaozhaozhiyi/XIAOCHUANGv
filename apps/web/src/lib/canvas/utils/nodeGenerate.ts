/**
 * nodeGenerate — 画布节点「随时生成」工具（v2.2 PR-C）
 *
 * 中间素材（角色形象 / 场景图 / 分镜画面）是成片输入，应可在任意时刻单点触发。
 */

import {
  nodeRegistry,
  resolveBusinessActions,
  type ResolvedBusinessAction,
} from '@xiaochuang/canvas-shared'

import type { FlowNode } from '@/lib/canvas/store'

type GenerateContext = 'storyboard' | 'character' | 'scene'

const TYPE_TO_CTX: Record<string, GenerateContext> = {
  storyboard: 'storyboard',
  image: 'storyboard',
  character: 'character',
  scene: 'scene',
}

/** 按节点类型与是否已有图，选择默认生成动作 */
const PREFERRED_ACTIONS: Record<string, { empty: string[]; filled: string[] }> = {
  character: { empty: ['生成形象'], filled: ['生成形象', '换装', '换表情'] },
  scene: { empty: ['生成场景'], filled: ['生成场景', '换时段', '换天气'] },
  storyboard: { empty: ['构想画面'], filled: ['改画面', '构想画面'] },
  image: { empty: ['构想画面'], filled: ['改画面', '构想画面'] },
}

export function isGeneratableNodeType(type?: string): boolean {
  return !!type && type in TYPE_TO_CTX
}

export function nodeHasImage(node: FlowNode): boolean {
  const images = (node.data as { images?: string[] } | undefined)?.images
  return Array.isArray(images) && !!images[0]
}

/** 从节点 data 提取默认 prompt（流水线拆解后的描述可直接用于生成） */
export function defaultPromptForNode(node: FlowNode): string {
  const d = (node.data ?? {}) as Record<string, unknown>
  switch (node.type) {
    case 'storyboard':
      return (
        (d.prompt as string) ||
        (d.shotDescription as string) ||
        (d.title as string) ||
        ''
      )
    case 'character':
      return (d.description as string) || (d.name as string) || (d.label as string) || ''
    case 'scene':
      return (d.description as string) || (d.name as string) || (d.label as string) || ''
    case 'image':
      return (d.prompt as string) || (d.label as string) || ''
    default:
      return ''
  }
}

export function resolveDefaultGenerateAction(node: FlowNode): ResolvedBusinessAction | null {
  const ctx = TYPE_TO_CTX[node.type ?? '']
  if (!ctx) return null

  const actions = resolveBusinessActions(nodeRegistry, ctx)
  if (!actions.length) return null

  const prefs = PREFERRED_ACTIONS[node.type ?? '']
  const labels = nodeHasImage(node) ? prefs?.filled : prefs?.empty
  if (labels) {
    for (const label of labels) {
      const found = actions.find((a) => a.label === label)
      if (found) return found
    }
  }
  return actions[0] ?? null
}

export function getGenerateButtonLabel(node: FlowNode): string {
  return resolveDefaultGenerateAction(node)?.label ?? '生成'
}
