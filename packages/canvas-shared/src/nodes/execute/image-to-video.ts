import type { CanvasNodeDefinition } from '../../schema/node-definition.js'

/**
 * 镜头拍摄 — 图生视频节点（v0.2.0 P0）
 *
 * 把静态画面动起来，成为一段镜头。
 */
export const imageToVideoNode: CanvasNodeDefinition = {
  id: 'image-to-video',
  category: 'execute',
  businessName: '镜头拍摄',
  technicalName: 'Image to Video',
  icon: '🎬',
  description: '让静态画面动起来，成为一段镜头',
  inputs: [
    { name: 'image', label: '画面', type: 'image', required: true },
    { name: 'motion', label: '动态描述', type: 'text', required: false },
  ],
  outputs: [
    { name: 'video', label: '镜头视频', type: 'video' },
  ],
  params: [
    {
      name: 'duration',
      label: '时长',
      type: 'select',
      default: '5',
      options: [
        { value: '3', label: '3 秒' },
        { value: '5', label: '5 秒' },
        { value: '8', label: '8 秒' },
      ],
    },
  ],
  executor: { kind: 'module', module: 'videos', method: 'generate' },
  ui: {
    accentColor: '#3B82F6',
    estimatedDuration: 60,
    estimatedCost: 0.3,
  },
  businessActions: [
    {
      label: '生成镜头视频',
      contextMenu: 'storyboard',
      promptTemplate: '{userInput}', // 用户可选填动态描述
      keepNodeHidden: true,
    },
  ],
  availableInVersions: ['v0.2.0', 'v0.2.1', 'v0.3'],
}
