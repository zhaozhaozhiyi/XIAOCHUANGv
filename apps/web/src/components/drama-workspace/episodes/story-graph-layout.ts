import type { StoryGraphEntity, StoryGraphRelation } from '@/lib/api'

export type StoryGraphLayoutNode = {
  id: string
  x: number
  y: number
}

const REPULSION = 4200
const ATTRACTION = 0.045
const DAMPING = 0.86

export function layoutStoryGraphNodes(
  entities: StoryGraphEntity[],
  relations: StoryGraphRelation[],
  width: number,
  height: number,
): StoryGraphLayoutNode[] {
  if (!entities.length) return []

  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.min(width, height) * 0.32
  const nodes = entities.map((entity, index) => {
    const angle = (index / entities.length) * Math.PI * 2
    const importanceBoost = (entity.importance || 0.5) * 24
    return {
      id: String(entity.id),
      x: centerX + Math.cos(angle) * (radius + importanceBoost),
      y: centerY + Math.sin(angle) * (radius + importanceBoost),
      vx: 0,
      vy: 0,
    }
  })

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges = relations
    .map((relation) => ({
      source: String(relation.subject_entity_id),
      target: String(relation.object_entity_id),
    }))
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))

  const iterations = Math.min(120, 40 + entities.length)
  for (let step = 0; step < iterations; step += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]
        const b = nodes[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distance = Math.max(24, Math.hypot(dx, dy))
        const force = REPULSION / (distance * distance)
        const fx = (dx / distance) * force
        const fy = (dy / distance) * force
        a.vx -= fx
        a.vy -= fy
        b.vx += fx
        b.vy += fy
      }
    }

    for (const edge of edges) {
      const source = nodeById.get(edge.source)
      const target = nodeById.get(edge.target)
      if (!source || !target) continue
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.max(24, Math.hypot(dx, dy))
      const force = distance * ATTRACTION
      const fx = (dx / distance) * force
      const fy = (dy / distance) * force
      source.vx += fx
      source.vy += fy
      target.vx -= fx
      target.vy -= fy
    }

    for (const node of nodes) {
      node.vx += (centerX - node.x) * 0.002
      node.vy += (centerY - node.y) * 0.002
      node.vx *= DAMPING
      node.vy *= DAMPING
      node.x += node.vx
      node.y += node.vy
      node.x = Math.max(48, Math.min(width - 48, node.x))
      node.y = Math.max(48, Math.min(height - 48, node.y))
    }
  }

  return nodes.map(({ id, x, y }) => ({ id, x, y }))
}
