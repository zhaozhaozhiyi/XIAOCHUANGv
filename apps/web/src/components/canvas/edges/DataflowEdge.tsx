'use client'

/**
 * DataflowEdge — 数据流边（v0.2.0 PR2，TRD §3.4.3）
 *
 * 执行节点之间，运行中加 `xc-edge-flowing` class → CSS keyframes 光点流动。
 * 描边色按 source 端口类型上色（与 PortHandle 同步）。
 *
 * 性能：source 节点 status 变化时只该 edge re-render（不是全图）—— useNodeState 保证。
 */

import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import type { PortType } from '@xiaochuang/canvas-shared'

import { useNodeState } from '@/lib/canvas/hooks/useNodeState'
import { getPortColor } from '@/lib/canvas/utils/port-colors'

interface DataflowEdgeData {
  source_port?: string
  target_port?: string
  label?: string
}

/** 与 PortHandle 同步，使用 globals.css --color-port-* */

function parsePortType(handleId: string | undefined | null): PortType | null {
  if (!handleId) return null
  const parts = handleId.split(':')
  const last = parts[parts.length - 1]
  const known: PortType[] = ['text', 'image', 'video', 'audio', 'character', 'scene', 'storyboard']
  return known.includes(last as PortType) ? (last as PortType) : null
}

function DataflowEdgeComponent(props: EdgeProps) {
  const {
    id,
    source,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  } = props
  const d = (data ?? {}) as DataflowEdgeData

  const sourceState = useNodeState(source)
  const isFlowing = sourceState.status === 'running'

  const portType = parsePortType(d.source_port) ?? 'image'
  const color = getPortColor(portType)

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
        className={isFlowing ? 'xc-edge-flowing' : ''}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 2,
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

export const DataflowEdge = memo(DataflowEdgeComponent)
