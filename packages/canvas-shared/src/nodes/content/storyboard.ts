import type { CanvasNodeDefinition } from '../../schema/node-definition.js'

/**
 * 分镜卡 — 画布的核心内容节点
 *
 * 一个分镜卡 = 一个镜头：
 *  - 文字描述（shotDescription）
 *  - 画面（images[] — 来自 text-to-image 节点的输出或人工上传）
 *  - 配音（audio — 来自 text-to-speech）
 *  - 镜头视频（video — 来自 image-to-video）
 *  - 元数据（duration / shotType / cameraMove / 折角 / 附签 / 关联角色）
 *
 * v0.2.0 作为原子节点；v0.2.1 升级为智能容器双层模型（isFromTemplate 标志位）
 */
export const storyboardNode: CanvasNodeDefinition = {
  id: 'storyboard',
  category: 'content',
  businessName: '分镜卡',
  technicalName: 'Storyboard Card',
  icon: '🎬',
  description: '一个镜头的描述、画面、元数据',
  inputs: [
    { name: 'image', label: '画面', type: 'image', required: false, multiple: true },
    { name: 'audio', label: '配音', type: 'audio', required: false },
    { name: 'video', label: '镜头视频', type: 'video', required: false },
  ],
  outputs: [
    // 拼接节点的输入：一个分镜卡 = 一个镜头视频
    { name: 'video', label: '镜头', type: 'video' },
  ],
  params: [
    { name: 'duration', label: '时长（秒）', type: 'number', default: 5 },
    {
      name: 'shotType',
      label: '景别',
      type: 'select',
      options: [
        { value: 'long', label: '远景' },
        { value: 'full', label: '全景' },
        { value: 'medium', label: '中景' },
        { value: 'close', label: '近景' },
        { value: 'extreme-close', label: '特写' },
        { value: 'over-shoulder', label: '过肩' },
      ],
    },
    {
      name: 'cameraMove',
      label: '运镜',
      type: 'select',
      options: [
        { value: 'static', label: '固定' },
        { value: 'push', label: '推' },
        { value: 'pull', label: '拉' },
        { value: 'pan', label: '摇' },
        { value: 'dolly', label: '移' },
        { value: 'follow', label: '跟' },
      ],
    },
  ],
  ui: {
    accentColor: '#C8673D', // 陶土橙（PRD §10.2 选中色）
  },
  availableInVersions: ['v0.2.0', 'v0.2.1', 'v0.3'],
}
