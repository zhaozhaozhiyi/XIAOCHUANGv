import type { CanvasNodeDefinition } from '../../schema/node-definition.js'

/**
 * 剪辑台 — 视频拼接节点（v0.2.0 P0）
 *
 * 把多个分镜按顺序剪成一段成片。
 * v0.2.0 仅做基础拼接；v0.2.1 起支持 narrative 连线的转场意图（叠化/划/跳切/淡入淡出）
 */
export const concatNode: CanvasNodeDefinition = {
  id: 'concat',
  category: 'execute',
  businessName: '剪辑台',
  technicalName: 'Video Concat',
  icon: '🎞️',
  description: '把多个分镜按顺序剪成一段戏',
  inputs: [
    { name: 'storyboards', label: '分镜序列', type: 'storyboard', required: true, multiple: true },
  ],
  outputs: [
    { name: 'video', label: '成片', type: 'video' },
  ],
  executor: { kind: 'module', module: 'compose', method: 'concat' },
  ui: {
    accentColor: '#10B981',
    estimatedDuration: 10,
    estimatedCost: 0.01,
  },
  availableInVersions: ['v0.2.0', 'v0.2.1', 'v0.3'],
}
