import { z } from 'zod'

/**
 * 节点端口类型
 *
 * 用于 React Flow handle 类型校验（前端 isValidConnection）+ 后端 buildExecutionPlan 类型检查（v0.2.1 启用）
 */
export const PortTypeSchema = z.enum([
  'text',
  'image',
  'video',
  'audio',
  'character',
  'scene',
  'storyboard',
])

export type PortType = z.infer<typeof PortTypeSchema>

/**
 * 端口类型兼容矩阵
 *
 * source 类型 → 可接入的 target 类型列表
 * v0.2.0 严格同类型匹配；v0.3 可加入自动转换（如 video → image 取首帧）
 */
export const PORT_COMPATIBILITY: Record<PortType, PortType[]> = {
  text: ['text'],
  image: ['image'],
  video: ['video'],
  audio: ['audio'],
  character: ['character'],
  scene: ['scene'],
  storyboard: ['storyboard'],
}

/**
 * 判断两个端口类型是否可连接
 */
export function isCompatible(source: PortType, target: PortType): boolean {
  return PORT_COMPATIBILITY[source]?.includes(target) ?? false
}
