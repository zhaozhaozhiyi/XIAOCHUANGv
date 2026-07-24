export const CONTENT_NODE_TYPES = [
  'storyboard',
  'image',
  'character',
  'scene',
  'note',
  'audio',
  'video-asset',
] as const

export const EXECUTE_NODE_TYPES = [
  'text-to-image',
  'image-to-video',
  'text-to-speech',
  'concat',
  'export',
] as const

export const DRAMACLAW_NODE_TYPES = [
  'uploadNode',
  'imageNode',
  'imageGenNode',
  'exportImageNode',
  'beatContextNode',
  'textAnnotationNode',
  'groupNode',
  'storyboardNode',
  'storyboardGenNode',
  'videoNode',
  'audioNode',
  'videoStoryNode',
  'videoComposeNode',
  'scriptNode',
  'pano360ViewerNode',
  'threeDWorldNode',
  'skillNode',
] as const

export const VALID_CANVAS_NODE_TYPES = [
  ...CONTENT_NODE_TYPES,
  ...EXECUTE_NODE_TYPES,
  ...DRAMACLAW_NODE_TYPES,
] as const

export const VALID_CANVAS_NODE_TYPE_SET = new Set<string>(VALID_CANVAS_NODE_TYPES)

export const IMAGE_RESULT_NODE_TYPES = new Set<string>([
  'image',
  'character',
  'scene',
  'storyboard',
  'uploadNode',
  'imageNode',
  'imageGenNode',
  'exportImageNode',
  'storyboardNode',
  'storyboardGenNode',
  'pano360ViewerNode',
  'threeDWorldNode',
])

export const VIDEO_RESULT_NODE_TYPES = new Set<string>([
  'video-asset',
  'videoNode',
  'videoStoryNode',
  'videoComposeNode',
])

export const AUDIO_RESULT_NODE_TYPES = new Set<string>([
  'audio',
  'audioNode',
])

export const TEXT_RESULT_NODE_TYPES = new Set<string>([
  'note',
  'beatContextNode',
  'textAnnotationNode',
  'scriptNode',
  'skillNode',
])

export function isValidCanvasNodeType(type: string | null | undefined): type is string {
  return Boolean(type && VALID_CANVAS_NODE_TYPE_SET.has(type))
}
