import type { CanvasNodeDefinition } from '../../schema/node-definition.js'

/**
 * 成片输出 — 导出 MP4 节点（v0.2.0 P0）
 *
 * 终点节点，把视频导出为 MP4 文件落入资产库。
 */
export const exportNode: CanvasNodeDefinition = {
  id: 'export',
  category: 'execute',
  businessName: '成片输出',
  technicalName: 'Export MP4',
  icon: '📦',
  description: '把最终结果导出为 MP4 文件',
  inputs: [
    { name: 'video', label: '视频', type: 'video', required: true },
  ],
  outputs: [], // 终点节点
  params: [
    {
      name: 'resolution',
      label: '分辨率',
      type: 'select',
      default: '1080p',
      options: [
        { value: '1080p', label: '1080p (1920×1080)' },
        { value: '720p', label: '720p (1280×720)' },
      ],
    },
    {
      name: 'codec',
      label: '编码',
      type: 'select',
      default: 'h264',
      options: [
        { value: 'h264', label: 'H.264（兼容性最好）' },
        { value: 'h265', label: 'H.265（体积更小）' },
      ],
    },
  ],
  executor: { kind: 'module', module: 'assets', method: 'exportVideo' },
  ui: {
    accentColor: '#EF4444',
    estimatedDuration: 15,
    estimatedCost: 0,
  },
  availableInVersions: ['v0.2.0', 'v0.2.1', 'v0.3'],
}
