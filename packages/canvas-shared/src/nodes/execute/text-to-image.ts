import type { CanvasNodeDefinition } from '../../schema/node-definition.js'

/**
 * 画面构想 — 文生图节点（v0.2.0 P0）
 *
 * 双语原则的典型示例：同一个 text-to-image 节点通过 businessActions
 * 反向声明出现在四个右键菜单里（构想画面/换装/换表情/换时段/换天气）。
 */
export const textToImageNode: CanvasNodeDefinition = {
  id: 'text-to-image',
  category: 'execute',
  businessName: '画面构想',
  technicalName: 'Text to Image',
  icon: '🎨',
  description: '用文字描述一个画面，AI 帮你画出来',
  inputs: [
    { name: 'prompt', label: '描述这个画面', type: 'text', required: true },
    { name: 'references', label: '参考画面', type: 'image', required: false, multiple: true },
  ],
  outputs: [
    { name: 'image', label: '画面', type: 'image' },
  ],
  params: [
    {
      name: 'style',
      label: '风格',
      type: 'select',
      options: [
        { value: 'realistic', label: '写实' },
        { value: 'anime', label: '日漫' },
        { value: 'ghibli', label: '吉卜力' },
        { value: 'cinematic', label: '电影感' },
      ],
    },
    {
      name: 'aspectRatio',
      label: '画幅',
      type: 'select',
      default: '16:9',
      options: [
        { value: '16:9', label: '横屏 16:9' },
        { value: '9:16', label: '竖屏 9:16（短视频）' },
        { value: '1:1', label: '方形 1:1' },
      ],
    },
  ],
  executor: { kind: 'module', module: 'images', method: 'generate' },
  ui: {
    accentColor: '#F59E0B',
    estimatedDuration: 8,
    estimatedCost: 0.05,
  },
  businessActions: [
    // 分镜卡右键 — PRD §17.1 v0.2.0 P0 必做
    {
      label: '构想画面',
      contextMenu: 'storyboard',
      promptTemplate: '{userInput}',
      keepNodeHidden: true,
    },
    {
      label: '改画面',
      contextMenu: 'storyboard',
      promptTemplate: '基于当前画面修改：{userInput}',
      keepNodeHidden: true,
    },
    // 角色卡右键 — 形象操作
    {
      label: '生成形象',
      contextMenu: 'character',
      promptTemplate: '角色立绘，{characterName}，{userInput}',
      keepNodeHidden: true,
    },
    {
      label: '换装',
      contextMenu: 'character',
      promptTemplate: '保持角色形象不变，更换服装为：{userInput}',
      keepNodeHidden: true,
    },
    {
      label: '换表情',
      contextMenu: 'character',
      promptTemplate: '保持角色形象不变，表情变为：{userInput}',
      keepNodeHidden: true,
    },
    // 场景卡右键 — 环境操作
    {
      label: '生成场景',
      contextMenu: 'scene',
      promptTemplate: '场景概念图，{sceneName}，{userInput}',
      keepNodeHidden: true,
    },
    {
      label: '换时段',
      contextMenu: 'scene',
      promptTemplate: '保持场景不变，时间变为：{userInput}',
      keepNodeHidden: true,
    },
    {
      label: '换天气',
      contextMenu: 'scene',
      promptTemplate: '保持场景不变，添加天气：{userInput}',
      keepNodeHidden: true,
    },
  ],
  availableInVersions: ['v0.2.0', 'v0.2.1', 'v0.3'],
}
