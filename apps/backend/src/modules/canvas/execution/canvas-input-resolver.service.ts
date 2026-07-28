import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { canvasEdges, canvasNodes, canvasTasks } from '../../../db/schema'
import {
  AUDIO_RESULT_NODE_TYPES,
  IMAGE_RESULT_NODE_TYPES,
  VIDEO_RESULT_NODE_TYPES,
} from '../canvas-node-types'
import type { ResolvedCanvasInputs } from './canvas-execution.types'

const EXECUTE_TYPES = new Set(['text-to-image', 'image-to-video', 'text-to-speech', 'concat', 'export'])

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

function pickImageUrl(data: Record<string, unknown>): string | undefined {
  if (typeof data.imageUrl === 'string' && data.imageUrl) return data.imageUrl
  if (typeof data.previewImageUrl === 'string' && data.previewImageUrl) return data.previewImageUrl
  if (typeof data.thumbnailUrl === 'string' && data.thumbnailUrl) return data.thumbnailUrl
  if (typeof data.thumbnail_url === 'string' && data.thumbnail_url) return data.thumbnail_url
  const images = data.images
  if (Array.isArray(images) && typeof images[0] === 'string' && images[0]) return images[0]
  const batch = data.generationBatch
  if (Array.isArray(batch) && typeof batch[0] === 'string' && batch[0]) return batch[0]
  if (typeof data.image === 'string' && data.image) return data.image
  if (typeof data.avatar === 'string' && data.avatar) return data.avatar
  return undefined
}

function pickVideoUrl(data: Record<string, unknown>): string | undefined {
  if (typeof data.video === 'string' && data.video) return data.video
  if (typeof data.videoUrl === 'string' && data.videoUrl) return data.videoUrl
  if (typeof data.resultVideoUrl === 'string' && data.resultVideoUrl) return data.resultVideoUrl
  const videos = data.videos
  if (Array.isArray(videos) && typeof videos[0] === 'string' && videos[0]) return videos[0]
  return undefined
}

function pickAudioUrl(data: Record<string, unknown>): string | undefined {
  if (typeof data.audio === 'string' && data.audio) return data.audio
  if (typeof data.audioUrl === 'string' && data.audioUrl) return data.audioUrl
  return undefined
}

function pickText(data: Record<string, unknown>): string | undefined {
  const keys = ['prompt', 'content', 'text', 'summary', 'userInput', 'shotDescription', 'description', 'title']
  for (const key of keys) {
    const v = data[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function collectStringUrls(value: unknown, keys: string[] = ['url']): string[] {
  if (!Array.isArray(value)) return []
  const urls: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item) {
      urls.push(item)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    for (const key of keys) {
      const url = record[key]
      if (typeof url === 'string' && url) urls.push(url)
    }
  }
  return Array.from(new Set(urls))
}

function collectParamVideoUrls(params: Record<string, unknown>) {
  return [
    ...collectStringUrls(params.videoUrls),
    ...collectStringUrls(params.videos, ['videoUrl', 'resultVideoUrl', 'url']),
    ...collectStringUrls(params.clips, ['videoUrl', 'resultVideoUrl', 'url']),
  ].filter((url, index, array) => array.indexOf(url) === index)
}

function collectParamReferences(params: Record<string, unknown>) {
  return Array.isArray(params.references)
    ? params.references.filter((r): r is string => typeof r === 'string' && Boolean(r))
    : []
}

function resultToUrl(result: Record<string, unknown> | null): string | undefined {
  if (!result) return undefined
  if (typeof result.url === 'string' && result.url) return result.url
  const outputs = result.outputs
  if (Array.isArray(outputs) && outputs[0] && typeof outputs[0] === 'object') {
    const first = outputs[0] as Record<string, unknown>
    if (typeof first.url === 'string' && first.url) return first.url
  }
  return undefined
}

function orderedVideoUrls(
  value: unknown,
  taskByNode: Map<string, typeof canvasTasks.$inferSelect>,
): string[] | null {
  if (!Array.isArray(value)) return null
  const urls: string[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const source = item as Record<string, unknown>
    if (typeof source.url === 'string' && source.url) {
      urls.push(source.url)
      continue
    }
    if (typeof source.nodeId !== 'string') continue
    const task = taskByNode.get(source.nodeId)
    const result = safeJsonParse<Record<string, unknown> | null>(task?.resultJson ?? null, null)
    const url = resultToUrl(result)
    if (url) urls.push(url)
  }
  return urls
}

@Injectable()
export class CanvasInputResolverService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async resolve(
    canvasId: string,
    runId: string,
    executeNodeId: string,
    params: Record<string, unknown>,
  ): Promise<ResolvedCanvasInputs> {
    const edges = await this.db.db
      .select()
      .from(canvasEdges)
      .where(and(eq(canvasEdges.canvasId, canvasId), eq(canvasEdges.edgeKind, 'dataflow')))

    const sourceNodeOrder = Array.isArray(params.sourceNodeOrder)
      ? params.sourceNodeOrder.filter((id): id is string => typeof id === 'string')
      : []
    const sourceOrderIndex = new Map(sourceNodeOrder.map((id, index) => [id, index]))
    const inbound = edges
      .filter((e) => e.targetNodeId === executeNodeId)
      .sort((a, b) => (
        (sourceOrderIndex.get(a.sourceNodeId) ?? Number.MAX_SAFE_INTEGER)
        - (sourceOrderIndex.get(b.sourceNodeId) ?? Number.MAX_SAFE_INTEGER)
      ))
    const sourceNodeIds = inbound.map((e) => e.sourceNodeId)
    if (sourceNodeIds.length === 0) {
      return {
        imageUrl: undefined,
        videoUrls: collectParamVideoUrls(params),
        audioUrl: typeof params.audioUrl === 'string' && params.audioUrl ? params.audioUrl : undefined,
        text: pickText(params),
        references: collectParamReferences(params),
      }
    }

    const nodes = sourceNodeIds.length
      ? await this.db.db
          .select()
          .from(canvasNodes)
          .where(and(eq(canvasNodes.canvasId, canvasId), inArray(canvasNodes.id, sourceNodeIds)))
      : []

    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const executeSources = nodes.filter((n) => EXECUTE_TYPES.has(n.nodeDefId)).map((n) => n.id)
    const completedTasks = executeSources.length
      ? await this.db.db
          .select()
          .from(canvasTasks)
          .where(and(eq(canvasTasks.runId, runId), inArray(canvasTasks.nodeId, executeSources)))
      : []
    const taskByNode = new Map(completedTasks.map((t) => [t.nodeId, t]))

    let imageUrl: string | undefined
    const videoUrls: string[] = collectParamVideoUrls(params)
    let audioUrl: string | undefined
    const references: string[] = []

    for (const edge of inbound) {
      const source = nodeMap.get(edge.sourceNodeId)
      if (!source) continue
      const data = safeJsonParse<Record<string, unknown>>(source.dataJson, {})

      if (EXECUTE_TYPES.has(source.nodeDefId)) {
        const task = taskByNode.get(source.id)
        const result = safeJsonParse<Record<string, unknown> | null>(task?.resultJson ?? null, null)
        const url = resultToUrl(result)
        if (source.nodeDefId === 'text-to-image' && url) imageUrl = imageUrl ?? url
        if ((source.nodeDefId === 'image-to-video' || source.nodeDefId === 'concat' || source.nodeDefId === 'export') && url) {
          videoUrls.push(url)
        }
        if (source.nodeDefId === 'text-to-speech' && url) audioUrl = url
        continue
      }

      const genericUrl = typeof data.url === 'string' && data.url ? data.url : undefined
      const img = pickImageUrl(data) || (IMAGE_RESULT_NODE_TYPES.has(source.nodeDefId) ? genericUrl : undefined)
      if (img) {
        references.push(img)
        if (!imageUrl && (edge.targetPort?.includes('image') || edge.sourcePort?.includes('image'))) {
          imageUrl = img
        }
      }
      const vid = pickVideoUrl(data) || (VIDEO_RESULT_NODE_TYPES.has(source.nodeDefId) ? genericUrl : undefined)
      if (vid) videoUrls.push(vid)
      const aud = pickAudioUrl(data) || (AUDIO_RESULT_NODE_TYPES.has(source.nodeDefId) ? genericUrl : undefined)
      if (aud) audioUrl = aud
    }

    for (const ref of collectParamReferences(params)) {
      if (!references.includes(ref)) references.push(ref)
    }

    const videosInRequestedOrder = orderedVideoUrls(params.videoSources, taskByNode)

    return {
      imageUrl,
      videoUrls: videosInRequestedOrder ?? Array.from(new Set(videoUrls)),
      audioUrl: audioUrl || (typeof params.audioUrl === 'string' && params.audioUrl ? params.audioUrl : undefined),
      text: pickText(params),
      references,
    }
  }
}
