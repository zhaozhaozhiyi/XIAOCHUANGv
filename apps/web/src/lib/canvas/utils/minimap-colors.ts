import type { Node } from '@xyflow/react'

/** 小地图节点色 — 使用 canvas-theme.css 中的 --canvas-minimap-* */
export function getMinimapNodeColor(n: Node): string {
  const d = (n.data ?? {}) as Record<string, unknown>
  const cat = d.category as string | undefined

  if (n.type === 'storyboard' || cat === 'shot') return 'var(--canvas-minimap-shot)'
  if (n.type === 'video-asset') return 'var(--canvas-port-video)'
  if (n.type === 'audio') return 'var(--canvas-port-audio)'
  if (cat === 'scene') return 'var(--canvas-minimap-scene)'
  if (cat === 'character') return 'var(--canvas-minimap-character)'
  if (cat === 'prop') return 'var(--canvas-minimap-prop)'
  if (n.type === 'note' || cat === 'note') return 'var(--canvas-minimap-note)'
  return 'var(--canvas-minimap-default)'
}
