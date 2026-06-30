import type { CanvasNodeDefinition } from '../../schema/node-definition.js'

/**
 * 角色卡 — 从素材库引入的角色
 *
 * 角色卡本身不产出，但通过 businessActions 暴露：
 *  - 换装（image-to-image + 服装 prompt）
 *  - 换表情（image-to-image + 表情 prompt）
 *  - 置入场景（image-to-image + 双参考图）
 */
export const characterNode: CanvasNodeDefinition = {
  id: 'character',
  category: 'content',
  businessName: '角色卡',
  technicalName: 'Character Card',
  icon: '🎭',
  description: '从素材库引入的角色（保留 characterId 引用）',
  inputs: [],
  outputs: [
    // 角色卡可作为 character 类型连入 text-to-speech 等节点（标识"用哪个角色配音"）
    { name: 'character', label: '角色', type: 'character' },
  ],
  availableInVersions: ['v0.2.0', 'v0.2.1', 'v0.3'],
}
