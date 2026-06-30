import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { canvasEdges, canvasNodes, canvasTasks } from '../../../db/schema'
import type { ResolvedCanvasInputs } from './canvas-execution.types'

const EXECUTE_TYPES = new Set(['text-to-image', 'image-to-video', 'text-to-speech', 'concat', 'export'])

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

function pickImageUrl(data: Record<string, unknown>): string | undefined {
  const images = data.images
  if (Array.isArray(images) && typeof images[0] === 'string' && images[0]) return images[0]
  if (typeof data.image === 'string' && data.image) return data.image
  if (typeof data.url === 'string' && data.url) return data.url
  if (typeof data.avatar === 'string' && data.avatar) return data.avatar
  return undefined
}

function pickVideoUrl(data: Record<string, unknown>): string | undefined {
  if (typeof data.video === 'string' && data.video) return data.video
  if (typeof data.videoUrl === 'string' && data.videoUrl) return data.videoUrl
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
  const keys = ['prompt', 'text', 'userInput', 'shotDescription', 'description']
  for (const key of keys) {
    const v = data[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
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

    const inbound = edges.filter((e) => e.targetNodeId === executeNodeId)
    const sourceNodeIds = inbound.map((e) => e.sourceNodeId)
    if (sourceNodeIds.length === 0) {
      return {
        imageUrl: undefined,
        videoUrls: [],
        audioUrl: undefined,
        text: pickText(params),
        references: Array.isArray(params.references)
          ? params.references.filter((r): r is string => typeof r === 'string')
          : [],
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
    const videoUrls: string[] = []
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
        if ((source.nodeDefId === 'image-to-video' || source.nodeDefId === 'concat') && url) {
          videoUrls.push(url)
        }
        if (source.nodeDefId === 'text-to-speech' && url) audioUrl = url
        continue
      }

      const img = pickImageUrl(data)
      if (img) {
        references.push(img)
        if (!imageUrl && (edge.targetPort?.includes('image') || edge.sourcePort?.includes('image'))) {
          imageUrl = img
        }
      }
      const vid = pickVideoUrl(data)
      if (vid) videoUrls.push(vid)
      const aud = pickAudioUrl(data)
      if (aud) audioUrl = aud
    }

    if (Array.isArray(params.references)) {
      for (const ref of params.references) {
        if (typeof ref === 'string' && ref && !references.includes(ref)) references.push(ref)
      }
    }

    return {
      imageUrl,
      videoUrls,
      audioUrl,
      text: pickText(params),
      references,
    }
  }
}
