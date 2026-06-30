'use client'

/**
 * PortHandle — 节点端口（v0.2.0 PR2）
 *
 * 关键约束（对齐 canvas-shared/schema + apps/web/src/lib/canvas/utils/isValidConnection.ts）：
 *   handle id 编码为 "<role>:<portType>"，例如 "in:image" / "out:video"
 *   isValidConnection 通过解析后缀做 PortType 严格校验
 *
 * 视觉：
 *   - 端口按 PortType 上色（7 种）
 *   - 边框用节点 accentColor
 *   - 多端口时通过 style.top 在 NodeBase 里集中排版（PortHandle 本身只管渲染）
 */

import { Handle, Position } from '@xyflow/react'
import type { PortType } from '@xiaochuang/canvas-shared'
import { cn } from '@/lib/cn'
import { getPortColor } from '@/lib/canvas/utils/port-colors'

interface PortHandleProps {
  role: 'in' | 'out'
  port: {
    name: string
    label: string
    type: PortType
    multiple?: boolean
  }
  accent?: string
  /** 端口在节点内的垂直偏移（top: calc(50% + offset px)） */
  offsetPx?: number
}

/** 7 种 PortType → 主题色（见 globals.css --color-port-*） */

export function PortHandle({ role, port, accent, offsetPx = 0 }: PortHandleProps) {
  const isInput = role === 'in'
  const bg = getPortColor(port.type)
  const borderColor = accent || bg

  return (
    <Handle
      type={isInput ? 'target' : 'source'}
      position={isInput ? Position.Left : Position.Right}
      id={`${role}:${port.type}`}
      isConnectableStart={!isInput}
      isConnectableEnd={isInput}
      // PR2 阶段不限制 multiple；PR3 加 connectionRadius / canConnect 时再限
      className={cn(
        '!size-3 !border-2 transition-all',
        // 让 handle 中心对到节点边线（默认 react-flow 是边线居中）
        isInput ? '!-left-1.5' : '!-right-1.5',
      )}
      style={{
        background: bg,
        borderColor,
        top: `calc(50% + ${offsetPx}px)`,
      }}
      title={`${port.label} · ${port.type}${port.multiple ? ' [可多连]' : ''}`}
    />
  )
}
