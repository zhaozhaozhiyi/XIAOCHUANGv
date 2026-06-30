import type { CanvasNodeDefinition } from '../../schema/node-definition.js'

/**
 * 图片节点 — 参考图、素材图、生图历史中的某张
 *
 * 可来源：
 *  - 用户从桌面拖入
 *  - 从素材库拖入（assetId 引用）
 *  - text-to-image / image-to-image 节点的输出
 */
export const imageNode: CanvasNodeDefinition = {
  id: 'image',
  category: 'content',
  businessName: '图片',
  technicalName: 'Image Node',
  icon: '🖼️',
  description: '参考图、素材图、生成的图片',
  inputs: [
    // 允许其他执行节点的图片输出连入（替换当前图）
    { name: 'image', label: '图片', type: 'image', required: false },
  ],
  outputs: [
    { name: 'image', label: '图片', type: 'image' },
  ],
  availableInVersions: ['v0.2.0', 'v0.2.1', 'v0.3'],
}
