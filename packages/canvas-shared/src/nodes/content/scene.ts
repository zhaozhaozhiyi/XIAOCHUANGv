import type { CanvasNodeDefinition } from '../../schema/node-definition.js'

/**
 * 场景卡 — 从素材库引入的场景
 */
export const sceneNode: CanvasNodeDefinition = {
  id: 'scene',
  category: 'content',
  businessName: '场景卡',
  technicalName: 'Scene Card',
  icon: '🏞️',
  description: '从素材库引入的场景（保留 sceneId 引用）',
  inputs: [],
  outputs: [
    { name: 'scene', label: '场景', type: 'scene' },
  ],
  availableInVersions: ['v0.2.0', 'v0.2.1', 'v0.3'],
}
