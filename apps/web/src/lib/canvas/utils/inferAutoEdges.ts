/**
 * inferAutoEdges — 推断 storyboard 节点自动连线（v0.2.0 PR4，PRD §11.4）
 *
 * 算法（v0.2.0 简化版）：
 *   1. 过滤 storyboard 节点 + 排除已 narrative 连接的对
 *   2. 按 X 升序；同列（|Δx| ≤ TOL）按 Y 升序
 *   3. 顺序连接相邻 pair（solid + thin）
 *
 * 真接入（v0.2.1）：可加入 AI 推断（按描述上下文 / 角色出现等）；当前算法 ≈ Notion 顺序读图。
 */

import type { FlowEdge, FlowNode } from '@/lib/canvas/store'

const X_TOL = 50

export interface InferredEdge {
  source: string
  target: string
  relation_type: 'solid'
  thickness: 'thin'
}

export function inferAutoEdges(
  nodes: FlowNode[],
  existingEdges: FlowEdge[],
): InferredEdge[] {
  const storyboards = nodes.filter(
    (n) => n.type === 'storyboard' && !n.hidden,
  )
  if (storyboards.length < 2) return []

  const sorted = [...storyboards].sort((a, b) => {
    const dx = a.position.x - b.position.x
    if (Math.abs(dx) <= X_TOL) return a.position.y - b.position.y
    return dx
  })

  const existing = new Set(
    existingEdges
      .filter((e) => e.data?.edge_kind === 'narrative')
      .map((e) => `${e.source}->${e.target}`),
  )

  const inferred: InferredEdge[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const src = sorted[i].id
    const tgt = sorted[i + 1].id
    if (existing.has(`${src}->${tgt}`)) continue
    if (existing.has(`${tgt}->${src}`)) continue
    inferred.push({
      source: src,
      target: tgt,
      relation_type: 'solid',
      thickness: 'thin',
    })
  }
  return inferred
}
