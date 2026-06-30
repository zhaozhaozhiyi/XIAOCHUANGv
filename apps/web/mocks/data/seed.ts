/**
 * MSW mock 种子数据（v0.2.0 PR1）
 *
 * 首次启动或 localStorage 为空时注入：
 * - 1 个全局灵感板（🌟，始终置顶）
 * - 1 个演示画布（展示典型场景：3 分镜 + 文字便签）
 *
 * 不依赖真实图片/视频/音频资产，缩略图用 picsum.photos 占位。
 */

import type {
  CanvasDetail,
  CanvasEdge,
  CanvasNode,
  CanvasSummary,
} from '@/lib/canvas/types'

const ISO_NOW = '2026-06-12T10:00:00.000Z'

const inspirationBoard: CanvasDetail = {
  id: 'cnv_inspiration',
  title: '🌟 全局灵感板',
  thumbnail: null,
  source: 'global-inspiration',
  is_pinned: true,
  created_at: ISO_NOW,
  updated_at: ISO_NOW,
  current_version_id: 'ver_inspiration_1',
  nodes: [
    {
      id: 'node_welcome',
      type: 'note',
      position: { x: 200, y: 160 },
      width: 320,
      data: {
        text: '欢迎来到画布！\n\n这里是你的灵感聚合地：\n• 拖拽分镜卡到画面中央\n• 双击空白处快速创建\n• 选中节点后按 E 打开编辑器',
        color: '#FEF3C7',
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

const demoCanvas: CanvasDetail = {
  id: 'cnv_demo_drama',
  title: '演示画布 · 短剧《晨光初见》',
  thumbnail: 'https://picsum.photos/seed/demo-drama/400/240',
  source: 'blank',
  is_pinned: false,
  created_at: ISO_NOW,
  updated_at: ISO_NOW,
  current_version_id: 'ver_demo_1',
  nodes: [
    {
      id: 'node_shot_1',
      type: 'storyboard',
      position: { x: 100, y: 100 },
      width: 240,
      data: {
        shotIndex: 1,
        title: '开篇晨景',
        shotDescription: '城市天际线，晨光透过云层，鸽群飞过',
        shotType: '远景',
        cameraMove: '推',
        duration: 5,
        images: ['https://picsum.photos/seed/shot1/512/288'],
        markStatus: 'confirmed',
        // 冷蓝 — 开场情绪
        moodColor: 'rgba(90, 122, 138, 0.85)',
        // 演示 🔊 音频标记
        audioUrl: 'https://example.local/mock-audio/shot1.mp3',
      },
    },
    {
      id: 'node_shot_2',
      type: 'storyboard',
      position: { x: 420, y: 100 },
      width: 240,
      data: {
        shotIndex: 2,
        title: '主角登场',
        shotDescription: '年轻女孩推开木质阳台门，眯眼看向远方',
        shotType: '中景',
        cameraMove: '固定',
        duration: 3,
        images: ['https://picsum.photos/seed/shot2/512/288'],
        markStatus: 'confirmed',
        // 暖橙 — 高潮情绪
        moodColor: 'rgba(176, 91, 67, 0.85)',
      },
    },
    {
      id: 'node_shot_3',
      type: 'storyboard',
      position: { x: 740, y: 100 },
      width: 240,
      data: {
        shotIndex: 3,
        title: '对话场景',
        shotDescription: '咖啡馆角落，两人相对而坐，余光交错',
        shotType: '近景',
        cameraMove: '摇',
        duration: 8,
        images: [],
        markStatus: 'none',
        // 中性暖灰
        moodColor: 'rgba(147, 107, 45, 0.65)',
        // 演示附签
        attachments: [
          { text: '缺图', color: 'rgba(178, 59, 59, 0.85)' },
          { text: '档期', color: 'rgba(147, 107, 45, 0.85)' },
        ],
      },
    },
    {
      id: 'node_note_1',
      type: 'note',
      position: { x: 100, y: 360 },
      width: 280,
      data: {
        text: '⚠ 第 3 镜还没生成画面，可右键 → 构想画面',
        color: '#FEE2E2',
      },
    },
  ],
  edges: [
    {
      id: 'edge_1_2',
      source: 'node_shot_1',
      target: 'node_shot_2',
      edge_kind: 'narrative',
      relation_type: 'solid',
    },
    {
      id: 'edge_2_3',
      source: 'node_shot_2',
      target: 'node_shot_3',
      edge_kind: 'narrative',
      relation_type: 'solid',
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
}

export const SEED_CANVASES: CanvasDetail[] = [
  inspirationBoard,
  demoCanvas,
]

/**
 * 列表页摘要（不带 nodes / edges）
 *
 * run_status 不在这里注入（避免 seed → runController 的循环依赖）；
 * 由 handlers/canvas.ts 的 list handler 在返回前 merge 进来。
 */
export function toSummary(canvas: CanvasDetail): CanvasSummary {
  const { nodes: _n, edges: _e, viewport: _v, current_version_id: _c, ...rest } = canvas
  return rest
}

export function cloneNode(node: CanvasNode): CanvasNode {
  return JSON.parse(JSON.stringify(node)) as CanvasNode
}

export function cloneEdge(edge: CanvasEdge): CanvasEdge {
  return { ...edge }
}
