'use client'

import {
  AudioLines,
  Boxes,
  Camera,
  Clapperboard,
  FileText,
  Film,
  ImageIcon,
  Layers3,
  LayoutGrid,
  Orbit,
  Paintbrush,
  Sparkles,
  Type,
  UploadCloud,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const DRAMACLAW_NODE_TYPES = {
  upload: 'uploadNode',
  imageEdit: 'imageNode',
  imageGen: 'imageGenNode',
  exportImage: 'exportImageNode',
  beatContext: 'beatContextNode',
  textAnnotation: 'textAnnotationNode',
  group: 'groupNode',
  storyboardSplit: 'storyboardNode',
  storyboardGen: 'storyboardGenNode',
  video: 'videoNode',
  audio: 'audioNode',
  videoStory: 'videoStoryNode',
  videoCompose: 'videoComposeNode',
  script: 'scriptNode',
  pano360Viewer: 'pano360ViewerNode',
  threeDWorld: 'threeDWorldNode',
  skill: 'skillNode',
} as const

export type DramaClawNodeType = (typeof DRAMACLAW_NODE_TYPES)[keyof typeof DRAMACLAW_NODE_TYPES]

export type DramaClawNodeFamily = 'media' | 'generate' | 'story' | 'compose' | 'advanced'

export interface DramaClawNodeDefinition {
  type: DramaClawNodeType
  label: string
  description: string
  family: DramaClawNodeFamily
  icon: LucideIcon
  accent: string
  defaultSize: { width: number; height: number }
  createDefaultData: () => Record<string, unknown>
}

export const DRAMACLAW_NODE_DEFINITIONS: DramaClawNodeDefinition[] = [
  {
    type: DRAMACLAW_NODE_TYPES.upload,
    label: '上传',
    description: '上传图片、视频或音频作为画布素材',
    family: 'media',
    icon: UploadCloud,
    accent: '#7dd3fc',
    defaultSize: { width: 320, height: 260 },
    createDefaultData: () => ({ displayName: '上传', imageUrl: null, videoUrl: null, audioUrl: null, aspectRatio: '1:1' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.imageEdit,
    label: '图片编辑',
    description: '基于图片和参考素材进行局部修改、重绘、扩图',
    family: 'media',
    icon: Paintbrush,
    accent: '#93c5fd',
    defaultSize: { width: 340, height: 360 },
    createDefaultData: () => ({ displayName: '图片编辑', imageUrl: null, prompt: '', model: 'default', aspectRatio: '1:1' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.imageGen,
    label: '图片生成',
    description: '文字或参考图生成图片',
    family: 'generate',
    icon: Sparkles,
    accent: '#60a5fa',
    defaultSize: { width: 360, height: 420 },
    createDefaultData: () => ({ displayName: '图片生成', imageUrl: null, prompt: '', model: 'default', count: 1, aspectRatio: '16:9' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.exportImage,
    label: '导出图',
    description: '生成、拆分或工具处理后的图片结果',
    family: 'media',
    icon: ImageIcon,
    accent: '#bfdbfe',
    defaultSize: { width: 360, height: 320 },
    createDefaultData: () => ({ displayName: '导出图', imageUrl: null, aspectRatio: '1:1', resultKind: 'generic' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.beatContext,
    label: '镜头上下文',
    description: '承载当前 beat 的角色、场景、台词和视觉约束',
    family: 'story',
    icon: Clapperboard,
    accent: '#a7f3d0',
    defaultSize: { width: 360, height: 300 },
    createDefaultData: () => ({ displayName: '镜头上下文', content: '', snapshot: {}, syncStatus: 'fresh' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.textAnnotation,
    label: '文本',
    description: '文本记录、反推提示词、文生视频/音乐',
    family: 'story',
    icon: Type,
    accent: '#fef08a',
    defaultSize: { width: 300, height: 220 },
    createDefaultData: () => ({ displayName: '文本', content: '', mode: 'writing', model: 'default' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.group,
    label: '分组',
    description: '把节点组织成镜头组或视觉组',
    family: 'story',
    icon: Boxes,
    accent: '#d8b4fe',
    defaultSize: { width: 420, height: 280 },
    createDefaultData: () => ({ displayName: '分组', label: '组', backgroundColor: '#111827' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.storyboardSplit,
    label: '分镜拆分',
    description: '把大图拆分成多格分镜并导出',
    family: 'story',
    icon: LayoutGrid,
    accent: '#f9a8d4',
    defaultSize: { width: 420, height: 360 },
    createDefaultData: () => ({ displayName: '分镜拆分', gridRows: 2, gridCols: 2, frames: [], aspectRatio: '1:1' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.storyboardGen,
    label: '分镜生成',
    description: '按提示词批量生成分镜格',
    family: 'generate',
    icon: LayoutGrid,
    accent: '#fb7185',
    defaultSize: { width: 420, height: 420 },
    createDefaultData: () => ({ displayName: '分镜生成', prompt: '', gridRows: 2, gridCols: 2, frames: [], model: 'default' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.video,
    label: '视频',
    description: '文生视频、图生视频、首尾帧视频',
    family: 'generate',
    icon: Video,
    accent: '#c084fc',
    defaultSize: { width: 380, height: 420 },
    createDefaultData: () => ({ displayName: '视频', videoUrl: null, prompt: '', genMode: 'textToVideo', durationSec: 5, quality: '720P' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.audio,
    label: '音频',
    description: '配音、音乐、音频参考',
    family: 'generate',
    icon: AudioLines,
    accent: '#22d3ee',
    defaultSize: { width: 340, height: 260 },
    createDefaultData: () => ({ displayName: '音频', audioUrl: null, text: '', audioKind: 'voice' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.videoStory,
    label: '视频故事',
    description: '把脚本、分镜和视频片段整理成故事序列',
    family: 'compose',
    icon: Film,
    accent: '#fbbf24',
    defaultSize: { width: 420, height: 330 },
    createDefaultData: () => ({ displayName: '视频故事', clips: [], summary: '' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.videoCompose,
    label: '视频合成',
    description: '多视频、多音频时间线合成',
    family: 'compose',
    icon: Layers3,
    accent: '#fb923c',
    defaultSize: { width: 420, height: 300 },
    createDefaultData: () => ({ displayName: '视频合成', resultVideoUrl: null, resolution: '1080p', draftTimeline: null }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.script,
    label: '脚本',
    description: '脚本、镜头表和台词结构',
    family: 'story',
    icon: FileText,
    accent: '#fde68a',
    defaultSize: { width: 380, height: 340 },
    createDefaultData: () => ({ displayName: '脚本', title: '未命名脚本', rows: [], content: '' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.pano360Viewer,
    label: '360 全景',
    description: '全景图查看与标注',
    family: 'advanced',
    icon: Camera,
    accent: '#67e8f9',
    defaultSize: { width: 380, height: 340 },
    createDefaultData: () => ({ displayName: '360 全景', imageUrl: null, aspectRatio: '2:1' }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.threeDWorld,
    label: '3D 世界',
    description: '三维场景、模型和导演世界状态',
    family: 'advanced',
    icon: Orbit,
    accent: '#86efac',
    defaultSize: { width: 400, height: 340 },
    createDefaultData: () => ({ displayName: '3D 世界', worldState: null, sourceUrl: null }),
  },
  {
    type: DRAMACLAW_NODE_TYPES.skill,
    label: '技能',
    description: '工具、工作流、主线能力节点',
    family: 'advanced',
    icon: Boxes,
    accent: '#c4b5fd',
    defaultSize: { width: 360, height: 300 },
    createDefaultData: () => ({ displayName: '技能', skillId: '', inputs: {}, outputs: {}, status: 'idle' }),
  },
]

export const DRAMACLAW_NODE_DEFINITION_MAP = Object.fromEntries(
  DRAMACLAW_NODE_DEFINITIONS.map((definition) => [definition.type, definition]),
) as Record<DramaClawNodeType, DramaClawNodeDefinition>

export function isDramaClawNodeType(type: string | null | undefined): type is DramaClawNodeType {
  return Boolean(type && type in DRAMACLAW_NODE_DEFINITION_MAP)
}

export function dramaClawDefaultData(type: DramaClawNodeType): Record<string, unknown> {
  return DRAMACLAW_NODE_DEFINITION_MAP[type].createDefaultData()
}
