/**
 * 通用 GenerateContext —— modules/* 入参重构后的统一上下文对象
 *
 * 旧签名（业务模块直接接 dramaId/episodeId 等）：
 *   imagesService.generate({ dramaId, episodeId, storyboardId, prompt, ... })
 *
 * 新签名（v0.2.0 入参重构后）：
 *   imagesService.generate({ prompt, ..., context: GenerateContext, idempotencyKey })
 *
 * 短剧调用保持兼容：dramaId 通过 context.dramaId 传入即可。
 *
 * 详见 TRD §4.3 入参重构清单 + 研发任务表 T-030/T-031/T-032/T-033/T-034。
 */
export interface GenerateContext {
  /** 调用来源域 */
  source: 'canvas' | 'drama' | 'novel' | 'standalone'

  /** 当前用户（必填）*/
  userId: string

  // ─── canvas 来源 ───
  canvasId?: string
  versionId?: string
  nodeId?: string

  // ─── drama 来源（向后兼容）───
  dramaId?: string
  episodeId?: string
  storyboardId?: string

  // ─── novel 来源 ───
  novelId?: string
  chapterId?: string
}
