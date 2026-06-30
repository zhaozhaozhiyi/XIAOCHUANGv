'use client'

/**
 * NarrativeEdge — 叙事边（v0.2.0 PR2，PRD §8.3）
 *
 * 8 种 RelationType 视觉区分：
 *   solid      — 实线（这个接那个）
 *   dashed     — 虚线（关联非顺序）
 *   arrow      — 实线 + 箭头（这个导致那个）
 *   cut        — 实线（合成端：硬切）
 *   dissolve   — 长虚线（合成端：xfade 叠化 0.5s）
 *   wipe       — 中虚线（合成端：xfade 划像）
 *   jump-cut   — 短虚线（合成端：硬切 同机位）
 *   fade       — 间隔虚线（合成端：黑场入/出）
 *
 * thickness（thin/medium/thick）→ 描边宽度；
 * v0.2.0 不强制可见性，PR3 起接 thickness UI 改值。
 */

import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import type { RelationType, Thickness } from '@xiaochuang/canvas-shared'

interface NarrativeEdgeData {
  relation_type?: RelationType
  thickness?: Thickness
  label?: string
}

const DASH_BY_REL: Record<RelationType, string> = {
  solid: '',
  dashed: '6 6',
  arrow: '',
  cut: '',
  dissolve: '12 4',
  wipe: '4 4',
  'jump-cut': '2 4',
  fade: '8 2 2 2',
}

const WIDTH_BY_THICKNESS: Record<Thickness, number> = {
  thin: 1.5,
  medium: 2,
  thick: 3,
}

function NarrativeEdgeComponent(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    markerEnd,
    selected,
  } = props
  const d = (data ?? {}) as NarrativeEdgeData
  const rel: RelationType = d.relation_type ?? 'solid'
  const thickness: Thickness = d.thickness ?? 'medium'

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={rel === 'arrow' ? markerEnd : undefined}
        style={{
          stroke: selected ? 'var(--canvas-edge)' : 'var(--canvas-edge-muted)',
          strokeWidth: WIDTH_BY_THICKNESS[thickness],
          strokeDasharray: DASH_BY_REL[rel],
          opacity: selected ? 1 : 0.85,
        }}
      />
      {d.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="pointer-events-auto absolute rounded border border-border bg-canvas-surface px-1.5 py-0.5 text-[10px] text-text-2"
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const NarrativeEdge = memo(NarrativeEdgeComponent)
