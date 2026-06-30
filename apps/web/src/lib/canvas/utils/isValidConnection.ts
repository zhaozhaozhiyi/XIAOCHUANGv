/**
 * isValidConnection — React Flow 连线校验适配器（v0.2.0 PR1）
 *
 * v0.2.0 D1 决策（TRD §4.2.2）：
 * - 前端 isValidConnection + 后端 buildExecutionPlan 共用同一 isCompatible
 * - 端口类型从 source/target handle 的 id 后缀读出（约定 "<role>:<portType>"）
 * - PR1 阶段无端口（节点全是简单 narrative 边），返回 true 即可
 * - PR2 节点带上端口后，按命名约定解析 PortType 校验
 */

import { isCompatible, type PortType } from '@xiaochuang/canvas-shared'
import type { Connection, Edge } from '@xyflow/react'

const PORT_TYPES: PortType[] = [
  'text',
  'image',
  'video',
  'audio',
  'character',
  'scene',
  'storyboard',
]

function parsePortType(handleId: string | null | undefined): PortType | null {
  if (!handleId) return null
  // 约定 handleId 形如 "in:image" / "out:video"
  const parts = handleId.split(':')
  if (parts.length < 2) return null
  const last = parts[parts.length - 1]
  return PORT_TYPES.includes(last as PortType) ? (last as PortType) : null
}

/**
 * React Flow `isValidConnection` 函数
 * - 同节点禁止连接
 * - 两端都带 PortType（dataflow 边）时按 isCompatible 严格校验
 * - 两端都不带 PortType（narrative 边）放行
 * - 一端有一端没有视为非法（避免误拖 dataflow handle 接到 narrative）
 */
export function isValidConnection(connection: Connection | Edge): boolean {
  if (!connection.source || !connection.target) return false
  if (connection.source === connection.target) return false

  const sPort = parsePortType(connection.sourceHandle)
  const tPort = parsePortType(connection.targetHandle)

  if (sPort && tPort) return isCompatible(sPort, tPort)
  if (!sPort && !tPort) return true
  // 一端有类型一端无类型 → 拒绝
  return false
}
