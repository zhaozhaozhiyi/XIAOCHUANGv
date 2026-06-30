/**
 * 节点注册中心 — 前后端共享
 *
 * v0.2.0 含 5 内容节点 + 5 执行节点 = 共 10 个
 * v0.2.1 起补齐到 17 个（详见各节点的 availableInVersions 字段）
 */

import type { CanvasNodeDefinition } from '../schema/node-definition.js'

// 内容节点
import { storyboardNode } from './content/storyboard.js'
import { imageNode } from './content/image.js'
import { characterNode } from './content/character.js'
import { sceneNode } from './content/scene.js'
import { noteNode } from './content/note.js'

// 执行节点（v0.2.0 5 个）
import { textToImageNode } from './execute/text-to-image.js'
import { imageToVideoNode } from './execute/image-to-video.js'
import { textToSpeechNode } from './execute/text-to-speech.js'
import { concatNode } from './execute/concat.js'
import { exportNode } from './execute/export.js'

/**
 * 完整节点注册表
 * key = node definition id（与 canvas_nodes.node_def_id 对应）
 */
export const nodeRegistry: Readonly<Record<string, CanvasNodeDefinition>> = Object.freeze({
  // 内容节点
  storyboard: storyboardNode,
  image: imageNode,
  character: characterNode,
  scene: sceneNode,
  note: noteNode,
  // 执行节点（v0.2.0）
  'text-to-image': textToImageNode,
  'image-to-video': imageToVideoNode,
  'text-to-speech': textToSpeechNode,
  concat: concatNode,
  export: exportNode,
})

/**
 * 按 ID 获取节点定义
 */
export function getNodeDefinition(id: string): CanvasNodeDefinition | undefined {
  return nodeRegistry[id]
}

/**
 * 列出某个版本可用的所有节点
 *
 * 未声明 availableInVersions 的节点默认仅在 v0.2.0 可用（保守默认）。
 */
export function listAvailableNodes(version = 'v0.2.0'): CanvasNodeDefinition[] {
  return Object.values(nodeRegistry).filter(n => {
    const versions = n.availableInVersions ?? ['v0.2.0']
    return versions.includes(version)
  })
}

/**
 * 按 category 分组列出节点
 */
export function listNodesByCategory(
  category: 'content' | 'execute',
  version = 'v0.2.0',
): CanvasNodeDefinition[] {
  return listAvailableNodes(version).filter(n => n.category === category)
}

// 重新 export 单个节点（方便按需 import）
export {
  storyboardNode,
  imageNode,
  characterNode,
  sceneNode,
  noteNode,
  textToImageNode,
  imageToVideoNode,
  textToSpeechNode,
  concatNode,
  exportNode,
}
