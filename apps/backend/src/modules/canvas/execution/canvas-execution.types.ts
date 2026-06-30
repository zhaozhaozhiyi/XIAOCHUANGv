/** 与 @xiaochuang/canvas-shared GenerateContext 对齐（backend 本地副本，避免 ESM 耦合） */
export interface CanvasGenerateContext {
  source: 'canvas' | 'drama' | 'novel' | 'standalone'
  userId: string
  canvasId?: string
  versionId?: string
  nodeId?: string
  dramaId?: string
  episodeId?: string
  storyboardId?: string
}

export interface CanvasTaskOutput {
  type: 'image' | 'video' | 'audio' | 'text'
  url?: string
  assetId?: string
}

export interface CanvasTaskResult {
  outputs: CanvasTaskOutput[]
  url?: string
  assetId?: string
  /** 关联 domain 表 id（image_generations / video_generations 等） */
  domainId?: number
}

export interface ResolvedCanvasInputs {
  imageUrl?: string
  videoUrls: string[]
  audioUrl?: string
  text?: string
  references: string[]
}
