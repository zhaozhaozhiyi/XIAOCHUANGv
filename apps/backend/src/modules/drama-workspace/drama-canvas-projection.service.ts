import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { DatabaseService } from '../../db/database.service'
import {
  canvasEdges,
  canvasNodes,
  canvases,
  characters,
  dramas,
  episodes,
  scenes,
  storyboardCharacters,
  storyboards,
} from '../../db/schema'
import { CanvasService } from '../canvas/canvas.service'

type CreateDramaCanvasInput = {
  title?: string
  scope?: string
  episodeId?: number
  storyboardId?: number
  mode?: string
}

type ProjectionInclude = 'characters' | 'scenes' | 'storyboards' | 'execution_nodes'
type ProjectionLayout = 'timeline' | 'columns'

type CreateFromEpisodeInput = {
  episodeId: number
  title?: string
  syncMode?: 'append_missing' | 'rebuild_projection'
  include?: ProjectionInclude[]
  layout?: ProjectionLayout
}

type SyncCanvasInput = {
  episodeId?: number
  syncMode: 'append_missing' | 'rebuild_projection'
  preserveUserNodes?: boolean
  include?: ProjectionInclude[]
  layout?: ProjectionLayout
}

function now() {
  return new Date()
}

function uid(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 8)}`
}

function parseNodeData(value: string | null | undefined) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function resolveProjectionIncludes(value: unknown): Set<ProjectionInclude> {
  const defaults: ProjectionInclude[] = ['storyboards', 'characters', 'scenes']
  const allowed = new Set<ProjectionInclude>(['characters', 'scenes', 'storyboards', 'execution_nodes'])
  const raw = Array.isArray(value) ? value : defaults
  const selected = raw.filter((item): item is ProjectionInclude => allowed.has(item as ProjectionInclude))
  return new Set(selected.length ? selected : defaults)
}

function resolveProjectionLayout(value: unknown): ProjectionLayout {
  return value === 'timeline' ? 'timeline' : 'columns'
}

function hasMeaningfulLabel(value: unknown) {
  const text = String(value ?? '').trim()
  return Boolean(text) && !/^未命名/.test(text)
}

function projectionNodeId(canvasId: string, projectionKey: string) {
  return `${canvasId}__${projectionKey}`
}

function edgeId(canvasId: string, source: string, target: string, relation: string) {
  const seed = `${source}_${target}_${relation}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 90)
  return `${canvasId}__edge_${seed}`
}

@Injectable()
export class DramaCanvasProjectionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CanvasService) private readonly canvasService: CanvasService,
  ) {}

  async listCanvases(dramaId: number, userId: number, query: { episodeId?: number; page: number; pageSize: number }) {
    await this.requireOwnedDrama(dramaId, userId)
    let rows = await this.db.db
      .select()
      .from(canvases)
      .where(and(
        eq(canvases.userId, userId),
        eq(canvases.sourceDramaId, String(dramaId)),
        or(eq(canvases.profile, 'drama'), eq(canvases.source, 'from-drama')),
        isNull(canvases.deletedAt),
      ))
      .orderBy(desc(canvases.updatedAt))

    if (query.episodeId) rows = rows.filter((row) => row.sourceEpisodeId === String(query.episodeId))
    const total = rows.length
    const start = (query.page - 1) * query.pageSize
    return {
      items: rows.slice(start, start + query.pageSize).map((row) => this.serializeCanvas(row)),
      total,
      page: query.page,
      page_size: query.pageSize,
    }
  }

  async createCanvas(dramaId: number, userId: number, input: CreateDramaCanvasInput) {
    const drama = await this.requireOwnedDrama(dramaId, userId)
    if (input.episodeId) await this.requireEpisode(dramaId, userId, input.episodeId)
    if (input.storyboardId) await this.requireStoryboard(dramaId, userId, input.storyboardId)

    const summary = await this.canvasService.createCanvas(userId, input.title || `${drama.title} · 项目画布`, {
      source: 'from-drama',
      profile: 'drama',
      sourceDramaId: dramaId,
      sourceEpisodeId: input.episodeId,
      sourceStoryboardId: input.storyboardId,
      sourceDramaTitle: drama.title,
      productionContext: {
        scope: input.scope ?? 'project',
        mode: input.mode ?? 'blank',
      },
    })

    return summary
  }

  async createCanvasFromEpisode(dramaId: number, userId: number, input: CreateFromEpisodeInput) {
    const drama = await this.requireOwnedDrama(dramaId, userId)
    const episode = await this.requireEpisode(dramaId, userId, input.episodeId)
    const summary = await this.canvasService.createCanvas(userId, input.title || `${drama.title} · 第 ${episode.episodeNumber} 集`, {
      source: 'from-drama',
      profile: 'drama',
      sourceDramaId: dramaId,
      sourceEpisodeId: episode.id,
      sourceDramaTitle: drama.title,
      productionContext: {
        source: 'episode_projection',
        episode_id: episode.id,
        sync_mode: input.syncMode ?? 'append_missing',
        include: Array.from(resolveProjectionIncludes(input.include)),
        layout: input.layout ?? 'columns',
      },
    })

    const projection = await this.syncEpisodeToCanvas(dramaId, userId, summary.id, {
      episodeId: episode.id,
      syncMode: input.syncMode ?? 'append_missing',
      preserveUserNodes: true,
      include: input.include,
      layout: input.layout,
    })

    return { canvas: summary, projection }
  }

  async syncEpisodeToCanvas(dramaId: number, userId: number, canvasId: string, input: SyncCanvasInput) {
    await this.requireOwnedDrama(dramaId, userId)
    const canvas = await this.canvasService.requireOwnedCanvas(canvasId, userId)
    if (String(canvas.sourceDramaId || '') !== String(dramaId)) {
      throw new NotFoundException('drama_canvas_not_found')
    }

    const episodeId = input.episodeId ?? Number(canvas.sourceEpisodeId || 0)
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      throw new BadRequestException('episode_id_required')
    }
    const episode = await this.requireEpisode(dramaId, userId, episodeId)
    const productionContext = parseNodeData(canvas.productionContextJson)
    const projection = await this.buildProjection(dramaId, userId, episode.id, canvasId, {
      include: input.include ?? (Array.isArray(productionContext.include) ? productionContext.include as ProjectionInclude[] : undefined),
      layout: input.layout ?? resolveProjectionLayout(productionContext.layout),
    })

    if (input.syncMode === 'rebuild_projection') {
      const existingNodes = await this.db.db
        .select()
        .from(canvasNodes)
        .where(and(eq(canvasNodes.canvasId, canvasId), isNull(canvasNodes.versionId)))
      const projectedNodeIds = existingNodes
        .filter((node) => parseNodeData(node.dataJson).source === 'drama_projection')
        .map((node) => node.id)
      if (projectedNodeIds.length) {
        await this.db.db.delete(canvasEdges).where(and(eq(canvasEdges.canvasId, canvasId), inArray(canvasEdges.sourceNodeId, projectedNodeIds)))
        await this.db.db.delete(canvasEdges).where(and(eq(canvasEdges.canvasId, canvasId), inArray(canvasEdges.targetNodeId, projectedNodeIds)))
        await this.db.db.delete(canvasNodes).where(and(eq(canvasNodes.canvasId, canvasId), inArray(canvasNodes.id, projectedNodeIds)))
      }
    }

    const existingNodes = await this.db.db
      .select()
      .from(canvasNodes)
      .where(eq(canvasNodes.canvasId, canvasId))
    const existingProjectionKeys = new Set(
      existingNodes.map((node) => String(parseNodeData(node.dataJson).projection_key || '')).filter(Boolean),
    )
    const nodesToInsert = projection.nodes.filter((node) => !existingProjectionKeys.has(node.projectionKey))

    if (nodesToInsert.length) {
      await this.db.db.insert(canvasNodes).values(nodesToInsert.map((node) => ({
        id: node.id,
        canvasId,
        nodeDefId: node.nodeDefId,
        label: node.label,
        dataJson: JSON.stringify(node.data),
        positionX: node.x,
        positionY: node.y,
        width: node.width,
        height: node.height,
        parentStoryboardId: node.parentStoryboardId ?? null,
        createdAt: now(),
        updatedAt: now(),
      })))
    }

    const existingEdges = await this.db.db.select().from(canvasEdges).where(eq(canvasEdges.canvasId, canvasId))
    const existingEdgeIds = new Set(existingEdges.map((edge) => edge.id))
    const edgesToInsert = projection.edges.filter((edge) => !existingEdgeIds.has(edge.id))
    if (edgesToInsert.length) {
      await this.db.db.insert(canvasEdges).values(edgesToInsert.map((edge) => ({
        id: edge.id,
        canvasId,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        edgeKind: edge.edgeKind,
        relationType: edge.relationType,
        label: edge.label,
        createdAt: now(),
      })))
    }

    await this.db.db.update(canvases).set({
      profile: 'drama',
      source: 'from-drama',
      sourceEpisodeId: String(episode.id),
      productionContextJson: JSON.stringify({
        source: 'episode_projection',
        episode_id: episode.id,
        last_sync_at: new Date().toISOString(),
        sync_mode: input.syncMode,
        include: Array.from(resolveProjectionIncludes(input.include ?? productionContext.include)),
        layout: input.layout ?? resolveProjectionLayout(productionContext.layout),
      }),
      updatedAt: now(),
    }).where(eq(canvases.id, canvasId))

    return {
      canvas_id: canvasId,
      episode_id: episode.id,
      created_nodes: nodesToInsert.length,
      created_edges: edgesToInsert.length,
      skipped_nodes: projection.nodes.length - nodesToInsert.length,
      skipped_edges: projection.edges.length - edgesToInsert.length,
    }
  }

  private async buildProjection(
    dramaId: number,
    userId: number,
    episodeId: number,
    canvasId: string,
    options: { include?: ProjectionInclude[]; layout?: ProjectionLayout } = {},
  ) {
    const include = resolveProjectionIncludes(options.include)
    const [characterRows, sceneRows, storyboardRows] = await Promise.all([
      this.db.db.select().from(characters).where(and(eq(characters.dramaId, dramaId), eq(characters.userId, userId), isNull(characters.deletedAt))),
      this.db.db.select().from(scenes).where(and(eq(scenes.dramaId, dramaId), eq(scenes.userId, userId), eq(scenes.episodeId, episodeId), isNull(scenes.deletedAt))),
      this.db.db.select().from(storyboards).where(and(eq(storyboards.episodeId, episodeId), eq(storyboards.userId, userId), isNull(storyboards.deletedAt))),
    ])
    const sortedStoryboards = [...storyboardRows].sort((left, right) => left.storyboardNumber - right.storyboardNumber)
    const storyboardIds = sortedStoryboards.map((storyboard) => storyboard.id)
    const storyboardCharacterRows = storyboardIds.length
      ? await this.db.db.select().from(storyboardCharacters).where(inArray(storyboardCharacters.storyboardId, storyboardIds))
      : []
    const referencedCharacterIds = new Set(storyboardCharacterRows.map((row) => row.characterId))
    const projectedCharacters = include.has('characters')
      ? characterRows.filter((character) => (
        hasMeaningfulLabel(character.name)
        && referencedCharacterIds.has(character.id)
      ))
      : []
    const projectedScenes = include.has('scenes')
      ? sceneRows.filter((scene) => hasMeaningfulLabel(scene.location))
      : []
    const includeStoryboards = include.has('storyboards')
    const includeExecutionNodes = includeStoryboards && include.has('execution_nodes')

    const nodeIdByKey = new Map<string, string>()
    const nodes: Array<{
      id: string
      projectionKey: string
      nodeDefId: string
      label: string
      data: Record<string, unknown>
      x: number
      y: number
      width: number
      height: number
      parentStoryboardId?: string
    }> = []

    const addNode = (projectionKey: string, nodeDefId: string, label: string, data: Record<string, unknown>, x: number, y: number, width = 280, height = 200, parentStoryboardId?: string) => {
      const id = projectionNodeId(canvasId, projectionKey)
      nodeIdByKey.set(projectionKey, id)
      nodes.push({
        id,
        projectionKey,
        nodeDefId,
        label,
        data: {
          ...data,
          source: 'drama_projection',
          dramaId,
          episodeId,
          projection_key: projectionKey,
          assetScope: data.assetScope ?? 'storyboard',
        },
        x,
        y,
        width,
        height,
        parentStoryboardId,
      })
    }

    projectedCharacters.forEach((character, index) => {
      addNode(`character_${character.id}`, 'character', character.name, {
        characterId: character.id,
        title: character.name,
        description: character.description ?? character.appearance ?? '',
        imageUrl: character.imageUrl ?? null,
        assetScope: 'project',
      }, 0, index * 230)
    })

    projectedScenes.forEach((scene, index) => {
      addNode(`scene_${scene.id}`, 'scene', scene.location, {
        sceneId: scene.id,
        title: scene.location,
        description: scene.prompt,
        imageUrl: scene.imageUrl ?? null,
        assetScope: 'episode',
      }, 0, projectedCharacters.length * 230 + 80 + index * 230)
    })

    if (includeStoryboards) sortedStoryboards.forEach((storyboard, index) => {
      const y = index * 280
      const parentStoryboardId = String(storyboard.id)
      addNode(`storyboard_${storyboard.id}`, 'storyboard', storyboard.title || `镜头 ${storyboard.storyboardNumber}`, {
        storyboardId: storyboard.id,
        storyboardNumber: storyboard.storyboardNumber,
        title: storyboard.title,
        description: storyboard.description ?? storyboard.action ?? '',
        prompt: storyboard.imagePrompt ?? storyboard.videoPrompt ?? '',
        dialogue: storyboard.dialogue ?? '',
        firstFrameImage: storyboard.firstFrameImage ?? null,
        lastFrameImage: storyboard.lastFrameImage ?? null,
        videoUrl: storyboard.videoUrl ?? null,
      }, 360, y, 300, 220, parentStoryboardId)
      if (includeExecutionNodes) {
        addNode(`exec_t2i_${storyboard.id}`, 'text-to-image', `首帧 · ${storyboard.storyboardNumber}`, {
          storyboardId: storyboard.id,
          prompt: storyboard.imagePrompt ?? storyboard.description ?? '',
          targetField: 'firstFrameImage',
          assetRole: 'first_frame',
        }, 720, y, 280, 190, parentStoryboardId)
        addNode(`exec_tts_${storyboard.id}`, 'text-to-speech', `配音 · ${storyboard.storyboardNumber}`, {
          storyboardId: storyboard.id,
          prompt: storyboard.dialogue ?? '',
          targetField: 'ttsAudioUrl',
          assetRole: 'voiceover',
        }, 720, y + 210, 280, 170, parentStoryboardId)
        addNode(`exec_i2v_${storyboard.id}`, 'image-to-video', `视频 · ${storyboard.storyboardNumber}`, {
          storyboardId: storyboard.id,
          prompt: storyboard.videoPrompt ?? storyboard.description ?? '',
          imageUrl: storyboard.firstFrameImage ?? null,
          targetField: 'videoUrl',
          assetRole: 'shot_video',
        }, 1080, y, 280, 210, parentStoryboardId)
      }
    })

    const edges: Array<{ id: string; source: string; target: string; edgeKind: string; relationType: string; label: string }> = []
    const addEdge = (sourceKey: string, targetKey: string, relationType: string, label: string, edgeKind = 'dataflow') => {
      const source = nodeIdByKey.get(sourceKey)
      const target = nodeIdByKey.get(targetKey)
      if (!source || !target) return
      edges.push({
        id: edgeId(canvasId, source, target, relationType),
        source,
        target,
        edgeKind,
        relationType,
        label,
      })
    }

    for (const storyboard of sortedStoryboards) {
      for (const relation of storyboardCharacterRows.filter((row) => row.storyboardId === storyboard.id)) {
        addEdge(`character_${relation.characterId}`, `storyboard_${storyboard.id}`, 'character_ref', '角色')
      }
      if (storyboard.sceneId) addEdge(`scene_${storyboard.sceneId}`, `storyboard_${storyboard.id}`, 'scene_ref', '场景')
      if (includeExecutionNodes) {
        addEdge(`storyboard_${storyboard.id}`, `exec_t2i_${storyboard.id}`, 'prompt_source', '提示词')
        addEdge(`storyboard_${storyboard.id}`, `exec_tts_${storyboard.id}`, 'dialogue_source', '台词')
        addEdge(`exec_t2i_${storyboard.id}`, `exec_i2v_${storyboard.id}`, 'image_source', '首帧')
      }
    }

    return { nodes, edges }
  }

  private serializeCanvas(row: typeof canvases.$inferSelect) {
    return {
      id: row.id,
      title: row.title,
      source: row.source,
      profile: row.profile,
      thumbnail: row.thumbnail ?? null,
      source_drama_id: row.sourceDramaId ?? null,
      source_episode_id: row.sourceEpisodeId ?? null,
      source_storyboard_id: row.sourceStoryboardId ?? null,
      source_drama_title: row.sourceDramaTitle ?? null,
      updated_at: row.updatedAt?.toISOString() ?? '',
      created_at: row.createdAt?.toISOString() ?? '',
      href: `/drama/${row.sourceDramaId}/canvas/${row.id}`,
    }
  }

  private async requireOwnedDrama(dramaId: number, userId: number) {
    const [drama] = await this.db.db
      .select()
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId), isNull(dramas.deletedAt)))
    if (!drama) throw new NotFoundException('drama_not_found')
    return drama
  }

  private async requireEpisode(dramaId: number, userId: number, episodeId: number) {
    const [episode] = await this.db.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), eq(episodes.dramaId, dramaId), eq(episodes.userId, userId), isNull(episodes.deletedAt)))
    if (!episode) throw new NotFoundException('episode_not_found')
    return episode
  }

  private async requireStoryboard(dramaId: number, userId: number, storyboardId: number) {
    const [storyboard] = await this.db.db
      .select()
      .from(storyboards)
      .where(and(eq(storyboards.id, storyboardId), eq(storyboards.userId, userId), isNull(storyboards.deletedAt)))
    if (!storyboard) throw new NotFoundException('storyboard_not_found')
    await this.requireEpisode(dramaId, userId, storyboard.episodeId)
    return storyboard
  }
}
