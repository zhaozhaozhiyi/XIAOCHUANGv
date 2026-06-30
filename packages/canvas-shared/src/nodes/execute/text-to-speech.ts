import type { CanvasNodeDefinition } from '../../schema/node-definition.js'

/**
 * 角色配音 — TTS 节点（v0.2.0 P0）
 *
 * 用某个角色的声音念出台词。
 * 智能默认：如果分镜关联了角色卡且该角色有 voiceId，自动选择对应声源。
 */
export const textToSpeechNode: CanvasNodeDefinition = {
  id: 'text-to-speech',
  category: 'execute',
  businessName: '角色配音',
  technicalName: 'Text to Speech',
  icon: '🎤',
  description: '让 AI 用某个角色的声音念这段台词',
  inputs: [
    { name: 'text', label: '台词', type: 'text', required: true },
    { name: 'character', label: '角色', type: 'character', required: true },
  ],
  outputs: [
    { name: 'audio', label: '配音', type: 'audio' },
  ],
  params: [
    {
      name: 'speed',
      label: '语速',
      type: 'slider',
      default: 1.0,
    },
    {
      name: 'pitch',
      label: '音调',
      type: 'slider',
      default: 0,
    },
  ],
  executor: { kind: 'module', module: 'audio', method: 'synthesize' },
  ui: {
    accentColor: '#8B5CF6',
    estimatedDuration: 5,
    estimatedCost: 0.02,
  },
  businessActions: [
    {
      label: '配音',
      contextMenu: 'storyboard',
      promptTemplate: '{userInput}', // 用户可改默认 shotDescription
      keepNodeHidden: true,
    },
  ],
  availableInVersions: ['v0.2.0', 'v0.2.1', 'v0.3'],
}
