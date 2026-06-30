import type { CanvasNodeDefinition } from '../../schema/node-definition.js'

/**
 * 便签 — 自由文字备注
 *
 * 可拖拽到其他节点上方建立关联（PRD §10.2 便签关联）。
 * 不参与执行流（无 input/output 端口）。
 */
export const noteNode: CanvasNodeDefinition = {
  id: 'note',
  category: 'content',
  businessName: '便签',
  technicalName: 'Note',
  icon: '📝',
  description: '自由文字备注，4 色可选',
  inputs: [],
  outputs: [],
  params: [
    {
      name: 'color',
      label: '颜色',
      type: 'select',
      default: 'yellow',
      options: [
        { value: 'yellow', label: '黄' },
        { value: 'blue', label: '蓝' },
        { value: 'pink', label: '粉' },
        { value: 'green', label: '绿' },
      ],
    },
  ],
  availableInVersions: ['v0.2.0', 'v0.2.1', 'v0.3'],
}
