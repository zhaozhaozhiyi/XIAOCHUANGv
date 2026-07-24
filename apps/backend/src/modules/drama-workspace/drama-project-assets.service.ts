import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'

import { and, desc, eq, inArray, isNull } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../common/media-url'
import { DatabaseService } from '../../db/database.service'
import {
  assets,
  canvases,
  characters,
  dramaAssetLinks,
  dramas,
  episodes,
  scenes,
  storyboards,
} from '../../db/schema'
import { CanvasAssetService } from '../canvas/canvas-asset.service'

export const DRAMA_ASSET_STATUSES = {
  CANDIDATE: 'candidate',
  MAINLINE: 'mainline',
  SHOT_PRIVATE: 'shot_private',
  LEGACY_MAINLINE: 'legacy_mainline',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
} as const

export const DRAMA_REVIEW_STATUSES = {
  PENDING_CONFIRMATION: 'pending_confirmation',
  CONFIRMED: 'confirmed',
  REWORK_REQUIRED: 'rework_required',
  STALE: 'stale',
  ARCHIVED: 'archived',
} as const

export const PROJECT_MEDIA_KINDS = ['image', 'video', 'audio'] as const
export type ProjectMediaKind = (typeof PROJECT_MEDIA_KINDS)[number]

type ProjectAssetQuery = {
  kind?: string
  scope?: string
  status?: string
  reviewStatus?: string
  qualityStatus?: string
  needsAttention?: boolean
  role?: string
  episodeId?: number
  storyboardId?: number
  q?: string
  page: number
  pageSize: number
}

type CreateFromCanvasResultInput = {
  canvasId: string
  nodeId: string
  resultId?: string
  assetScope: string
  assetRole: string
  episodeId?: number
  storyboardId?: number
  targetType?: string
  targetId?: string
  targetField?: string
  title?: string
}

type CommitProjectAssetInput = {
  targetType: string
  targetId: string
  targetField: string
  commitScope: string
  replaceExisting?: boolean
}

type SerializedProjectAsset = ReturnType<typeof serializeProjectAsset>

function now() {
  return new Date()
}

function mediaVersionKey(asset: typeof assets.$inferSelect) {
  return createHash('sha256')
    .update(JSON.stringify({
      assetId: asset.id,
      url: asset.url,
      updatedAt: asset.updatedAt?.toISOString?.() ?? null,
    }))
    .digest('hex')
    .slice(0, 32)
}

export function isProjectMediaKind(value: unknown): value is ProjectMediaKind {
  return typeof value === 'string' && (PROJECT_MEDIA_KINDS as readonly string[]).includes(value)
}

function parseMetadata(value: string | null | undefined) {
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

function parseJsonArray(value: string | null | undefined) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function toOptionalInt(value: unknown) {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeStoryboardTargetField(value: string) {
  const key = value.trim()
  const normalized = key.replace(/[-\s]/g, '_')
  const fieldMap = {
    first_frame: 'firstFrameImage',
    first_frame_image: 'firstFrameImage',
    firstFrameImage: 'firstFrameImage',
    last_frame: 'lastFrameImage',
    last_frame_image: 'lastFrameImage',
    lastFrameImage: 'lastFrameImage',
    shot_video: 'videoUrl',
    video: 'videoUrl',
    video_url: 'videoUrl',
    videoUrl: 'videoUrl',
    voiceover: 'ttsAudioUrl',
    tts_audio: 'ttsAudioUrl',
    tts_audio_url: 'ttsAudioUrl',
    ttsAudioUrl: 'ttsAudioUrl',
    composed_video: 'composedVideoUrl',
    composed_video_url: 'composedVideoUrl',
    composedVideoUrl: 'composedVideoUrl',
  } as const
  return fieldMap[key as keyof typeof fieldMap] ?? fieldMap[normalized as keyof typeof fieldMap] ?? null
}

function inferRole(asset: typeof assets.$inferSelect) {
  const metadata = parseMetadata(asset.metadataJson)
  const nodeDefId = String(metadata.node_def_id || '')
  if (asset.kind === 'audio') return 'voiceover'
  if (asset.kind === 'video') return 'shot_video'
  if (nodeDefId === 'character') return 'character_portrait'
  if (nodeDefId === 'scene') return 'scene_image'
  return 'reference'
}

function serializeProjectAsset(args: {
  asset: typeof assets.$inferSelect
  link?: typeof dramaAssetLinks.$inferSelect | null
}) {
  const { asset, link } = args
  const metadata = parseMetadata(asset.metadataJson)
  return {
    id: link?.id ?? `asset_${asset.id}`,
    asset_id: asset.id,
    kind: asset.kind,
    title: asset.title,
    url: toPublicMediaUrl(asset.url),
    thumbnail_url: toPublicMediaUrl(asset.thumbnailUrl || asset.url),
    scope: link?.scope ?? (asset.storyboardId ? 'storyboard' : asset.episodeId ? 'episode' : 'project'),
    status: link?.status ?? DRAMA_ASSET_STATUSES.LEGACY_MAINLINE,
    review_status: link?.reviewStatus ?? DRAMA_REVIEW_STATUSES.CONFIRMED,
    quality_status: link?.qualityStatus ?? 'not_evaluated',
    quality_reasons: parseJsonArray(link?.qualityReasonsJson),
    version_key: link?.versionKey ?? mediaVersionKey(asset),
    review: {
      reviewed_by: link?.reviewedBy ?? null,
      reviewed_at: link?.reviewedAt?.toISOString() ?? null,
    },
    role: link?.role ?? inferRole(asset),
    target_type: link?.targetType ?? null,
    target_id: link?.targetId ?? null,
    target_field: link?.targetField ?? null,
    source_module: link?.sourceModule ?? asset.sourceType,
    source_canvas_id: link?.sourceCanvasId ?? (typeof metadata.canvas_id === 'string' ? metadata.canvas_id : null),
    source_node_id: link?.sourceNodeId ?? (typeof metadata.node_id === 'string' ? metadata.node_id : null),
    source_result_id: link?.sourceResultId ?? (typeof metadata.result_id === 'string' ? metadata.result_id : null),
    source_task_id: link?.sourceTaskId ?? asset.taskId ?? null,
    source_path: asset.sourcePath ?? null,
    episode_id: link?.episodeId ?? asset.episodeId ?? null,
    storyboard_id: link?.storyboardId ?? asset.storyboardId ?? null,
    previous_asset_id: link?.previousAssetId ?? null,
    created_at: (link?.createdAt ?? asset.createdAt)?.toISOString() ?? '',
    updated_at: (link?.updatedAt ?? asset.updatedAt)?.toISOString() ?? '',
  }
}

@Injectable()
export class DramaProjectAssetsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CanvasAssetService) private readonly canvasAssetService: CanvasAssetService,
  ) {}

  async requireOwnedDrama(dramaId: number, userId: number) {
    const [drama] = await this.db.db
      .select()
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId), isNull(dramas.deletedAt)))

    if (!drama) throw new NotFoundException('drama_not_found')
    return drama
  }

  async listProjectAssets(dramaId: number, userId: number, query: ProjectAssetQuery) {
    await this.requireOwnedDrama(dramaId, userId)

    let links = await this.db.db
      .select()
      .from(dramaAssetLinks)
      .where(and(eq(dramaAssetLinks.dramaId, dramaId), eq(dramaAssetLinks.userId, userId), isNull(dramaAssetLinks.deletedAt)))
      .orderBy(desc(dramaAssetLinks.updatedAt))

    if (query.status) links = links.filter((link) => link.status === query.status)
    if (query.reviewStatus) links = links.filter((link) => link.reviewStatus === query.reviewStatus)
    if (query.qualityStatus) links = links.filter((link) => link.qualityStatus === query.qualityStatus)
    if (query.needsAttention) {
      links = links.filter((link) => ([
        DRAMA_REVIEW_STATUSES.PENDING_CONFIRMATION,
        DRAMA_REVIEW_STATUSES.REWORK_REQUIRED,
        DRAMA_REVIEW_STATUSES.STALE,
      ] as string[]).includes(link.reviewStatus))
    }
    if (query.scope) links = links.filter((link) => link.scope === query.scope)
    if (query.role) links = links.filter((link) => link.role === query.role)
    if (query.episodeId) links = links.filter((link) => link.episodeId === query.episodeId)
    if (query.storyboardId) links = links.filter((link) => link.storyboardId === query.storyboardId)

    const linkedAssetIds = Array.from(new Set(links.map((link) => link.assetId)))
    const linkedAssets = linkedAssetIds.length
      ? await this.db.db
        .select()
        .from(assets)
        .where(and(inArray(assets.id, linkedAssetIds), eq(assets.userId, userId), isNull(assets.deletedAt)))
      : []
    const assetById = new Map(linkedAssets.map((asset) => [asset.id, asset]))
    const linkedRows = links
      .map((link) => {
        const asset = assetById.get(link.assetId)
        return asset && isProjectMediaKind(asset.kind) ? serializeProjectAsset({ asset, link }) : null
      })
      .filter((row): row is SerializedProjectAsset => row != null)

    const legacyAssets = query.status && query.status !== DRAMA_ASSET_STATUSES.LEGACY_MAINLINE
      ? []
      : await this.db.db
        .select()
        .from(assets)
        .where(and(eq(assets.dramaId, dramaId), eq(assets.userId, userId), isNull(assets.deletedAt)))
        .orderBy(desc(assets.updatedAt))

    const linkedSet = new Set(linkedAssetIds)
    const legacyRows = legacyAssets
      .filter((asset) => isProjectMediaKind(asset.kind) && !linkedSet.has(asset.id))
      .map((asset) => serializeProjectAsset({ asset }))

    let rows = [...linkedRows, ...legacyRows]
    if (query.kind) rows = rows.filter((row) => row.kind === query.kind)
    if (query.q) {
      const keyword = query.q.toLowerCase()
      rows = rows.filter((row) => [row.title, row.role, row.status, row.source_module]
        .some((value) => String(value || '').toLowerCase().includes(keyword)))
    }

    rows.sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
    const total = rows.length
    const start = (query.page - 1) * query.pageSize

    return {
      items: rows.slice(start, start + query.pageSize),
      total,
      page: query.page,
      page_size: query.pageSize,
    }
  }

  async createCandidateFromCanvasResult(dramaId: number, userId: number, input: CreateFromCanvasResultInput) {
    await this.requireOwnedDrama(dramaId, userId)
    const [canvas] = await this.db.db
      .select()
      .from(canvases)
      .where(and(eq(canvases.id, input.canvasId), eq(canvases.userId, userId), isNull(canvases.deletedAt)))

    if (!canvas || String(canvas.sourceDramaId || '') !== String(dramaId)) {
      throw new NotFoundException('drama_canvas_not_found')
    }

    const episodeId = input.episodeId ?? toOptionalInt(canvas.sourceEpisodeId)
    const storyboardId = input.storyboardId ?? toOptionalInt(canvas.sourceStoryboardId)
    if (episodeId) await this.requireEpisode(dramaId, userId, episodeId)
    if (storyboardId) await this.requireStoryboard(dramaId, userId, storyboardId)

    const result = await this.canvasAssetService.createAssetFromNodeResult(input.canvasId, userId, {
      node_id: input.nodeId,
      result_id: input.resultId,
      title: input.title,
    })

    const asset = result.asset
    if (!isProjectMediaKind(asset.kind)) {
      throw new BadRequestException('project_media_asset_required')
    }
    await this.db.db
      .update(assets)
      .set({
        dramaId,
        episodeId: episodeId ?? asset.episodeId ?? null,
        storyboardId: storyboardId ?? asset.storyboardId ?? null,
        updatedAt: now(),
      })
      .where(eq(assets.id, asset.id))

    const [existingLink] = await this.db.db
      .select()
      .from(dramaAssetLinks)
      .where(and(eq(dramaAssetLinks.assetId, asset.id), eq(dramaAssetLinks.dramaId, dramaId), isNull(dramaAssetLinks.deletedAt)))

    const linkValues = {
      userId,
      dramaId,
      episodeId: episodeId ?? null,
      storyboardId: storyboardId ?? null,
      assetId: asset.id,
      scope: input.assetScope || 'project',
      status: DRAMA_ASSET_STATUSES.CANDIDATE,
      reviewStatus: DRAMA_REVIEW_STATUSES.PENDING_CONFIRMATION,
      qualityStatus: 'not_evaluated',
      qualityReasonsJson: '[]',
      reviewedBy: null,
      reviewedAt: null,
      staleAt: null,
      staleReason: null,
      versionKey: mediaVersionKey(asset),
      role: input.assetRole || 'reference',
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetField: input.targetField ?? null,
      sourceModule: 'drama_canvas',
      sourceCanvasId: input.canvasId,
      sourceNodeId: input.nodeId,
      sourceResultId: input.resultId ?? null,
      metadataJson: JSON.stringify({
        canvas_id: input.canvasId,
        node_id: input.nodeId,
        result_id: input.resultId ?? null,
      }),
      updatedAt: now(),
    }

    const [link] = existingLink
      ? await this.db.db
        .update(dramaAssetLinks)
        .set(linkValues)
        .where(eq(dramaAssetLinks.id, existingLink.id))
        .returning()
      : await this.db.db
        .insert(dramaAssetLinks)
        .values({ ...linkValues, createdAt: now() })
        .returning()

    const [updatedAsset] = await this.db.db.select().from(assets).where(eq(assets.id, asset.id))
    return serializeProjectAsset({ asset: updatedAsset ?? asset, link })
  }

  async commitProjectAsset(dramaId: number, userId: number, assetId: number, input: CommitProjectAssetInput) {
    await this.requireOwnedDrama(dramaId, userId)
    const [asset] = await this.db.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.userId, userId), isNull(assets.deletedAt)))

    if (!asset || asset.dramaId !== dramaId) throw new NotFoundException('project_asset_not_found')
    if (!isProjectMediaKind(asset.kind)) throw new BadRequestException('project_media_asset_required')
    if (!asset.url) throw new ConflictException('asset_has_no_url')

    const [assetLink] = await this.db.db
      .select()
      .from(dramaAssetLinks)
      .where(and(
        eq(dramaAssetLinks.assetId, asset.id),
        eq(dramaAssetLinks.dramaId, dramaId),
        eq(dramaAssetLinks.userId, userId),
        isNull(dramaAssetLinks.deletedAt),
      ))
    if (assetLink && assetLink.reviewStatus !== DRAMA_REVIEW_STATUSES.CONFIRMED) {
      throw new ConflictException('asset_confirmation_required')
    }

    const target = await this.resolveCommitTarget(dramaId, userId, input.targetType, input.targetId, input.targetField)
    if (target.previousUrl && !input.replaceExisting) {
      throw new ConflictException('target_has_existing_asset')
    }

    const previousAssetId = target.previousUrl
      ? await this.findAssetIdByUrl(userId, dramaId, target.previousUrl)
      : null
    const committedStatus = input.commitScope === 'storyboard'
      ? DRAMA_ASSET_STATUSES.SHOT_PRIVATE
      : DRAMA_ASSET_STATUSES.MAINLINE

    return this.db.db.transaction(async (tx) => {
      await target.apply(tx, asset.url!)

      await tx.update(assets).set({
        dramaId,
        episodeId: target.episodeId ?? asset.episodeId ?? null,
        storyboardId: target.storyboardId ?? asset.storyboardId ?? null,
        updatedAt: now(),
      }).where(eq(assets.id, asset.id))

      const [existingLink] = await tx
        .select()
        .from(dramaAssetLinks)
        .where(and(eq(dramaAssetLinks.assetId, asset.id), eq(dramaAssetLinks.dramaId, dramaId), isNull(dramaAssetLinks.deletedAt)))

      const linkValues = {
        userId,
        dramaId,
        episodeId: target.episodeId ?? asset.episodeId ?? null,
        storyboardId: target.storyboardId ?? asset.storyboardId ?? null,
        assetId: asset.id,
        scope: input.commitScope || 'project',
        status: committedStatus,
        reviewStatus: DRAMA_REVIEW_STATUSES.CONFIRMED,
        role: this.roleFromTarget(input.targetType, input.targetField, asset),
        targetType: input.targetType,
        targetId: input.targetId,
        targetField: input.targetField,
        previousAssetId,
        updatedAt: now(),
      }

      const [link] = existingLink
        ? await tx.update(dramaAssetLinks).set(linkValues).where(eq(dramaAssetLinks.id, existingLink.id)).returning()
        : await tx.insert(dramaAssetLinks).values({ ...linkValues, sourceModule: asset.sourceType, createdAt: now() }).returning()

      const [updatedAsset] = await tx.select().from(assets).where(eq(assets.id, asset.id))
      return {
        success: true,
        previous_asset_id: previousAssetId,
        item: serializeProjectAsset({ asset: updatedAsset ?? asset, link }),
      }
    })
  }

  async rejectProjectAsset(dramaId: number, userId: number, assetId: number) {
    await this.updateProjectAssetStatus(dramaId, userId, assetId, DRAMA_ASSET_STATUSES.REJECTED, DRAMA_REVIEW_STATUSES.ARCHIVED)
    return { success: true }
  }

  async archiveProjectAsset(dramaId: number, userId: number, assetId: number) {
    await this.updateProjectAssetStatus(dramaId, userId, assetId, DRAMA_ASSET_STATUSES.ARCHIVED, DRAMA_REVIEW_STATUSES.ARCHIVED)
    return { success: true }
  }

  async confirmProjectAssetLink(dramaId: number, userId: number, linkId: number, versionKey: string, note?: string) {
    await this.requireOwnedDrama(dramaId, userId)
    const [link] = await this.db.db
      .select()
      .from(dramaAssetLinks)
      .where(and(
        eq(dramaAssetLinks.id, linkId),
        eq(dramaAssetLinks.dramaId, dramaId),
        eq(dramaAssetLinks.userId, userId),
        isNull(dramaAssetLinks.deletedAt),
      ))
    if (!link) throw new NotFoundException('project_asset_link_not_found')
    if (link.versionKey !== versionKey) throw new ConflictException('review_version_stale')
    if (link.reviewStatus !== DRAMA_REVIEW_STATUSES.PENDING_CONFIRMATION) {
      throw new ConflictException('asset_review_not_confirmable')
    }

    const [updated] = await this.db.db
      .update(dramaAssetLinks)
      .set({
        reviewStatus: DRAMA_REVIEW_STATUSES.CONFIRMED,
        reviewedBy: userId,
        reviewedAt: now(),
        updatedAt: now(),
      })
      .where(eq(dramaAssetLinks.id, link.id))
      .returning()
    const [asset] = await this.db.db.select().from(assets).where(eq(assets.id, link.assetId))
    if (!asset) throw new NotFoundException('project_asset_not_found')
    return serializeProjectAsset({ asset, link: updated ?? link })
  }

  async batchConfirmProjectAssetLinks(
    dramaId: number,
    userId: number,
    input: { linkIds: number[]; versionKeys: Record<string, string> },
  ) {
    await this.requireOwnedDrama(dramaId, userId)
    if (!input.linkIds.length) throw new BadRequestException('asset_links_required')
    const links = await this.db.db
      .select()
      .from(dramaAssetLinks)
      .where(and(
        inArray(dramaAssetLinks.id, input.linkIds),
        eq(dramaAssetLinks.dramaId, dramaId),
        eq(dramaAssetLinks.userId, userId),
        isNull(dramaAssetLinks.deletedAt),
      ))
    const sameEpisode = new Set(links.map((link) => link.episodeId)).size === 1
    const sameRole = new Set(links.map((link) => link.role)).size === 1
    const foundIds = new Set(links.map((link) => link.id))
    const missing = input.linkIds
      .filter((id) => !foundIds.has(id))
      .map((id) => ({ id, reason: 'asset_link_not_found' }))
    const blocked = missing.length || !sameEpisode || !sameRole
      ? [
        ...missing,
        ...links.map((link) => ({ id: link.id, reason: 'scope_mismatch' })),
      ]
      : links.filter((link) =>
        link.reviewStatus !== DRAMA_REVIEW_STATUSES.PENDING_CONFIRMATION
        || link.qualityStatus !== 'passed'
        || link.versionKey !== input.versionKeys[String(link.id)],
      ).map((link) => ({ id: link.id, reason: 'review_not_ready' }))
    if (blocked.length) throw new ConflictException({ code: 'batch_confirmation_blocked', blocked_items: blocked })

    const timestamp = now()
    await this.db.db
      .update(dramaAssetLinks)
      .set({
        reviewStatus: DRAMA_REVIEW_STATUSES.CONFIRMED,
        reviewedBy: userId,
        reviewedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(inArray(dramaAssetLinks.id, input.linkIds))
    return { confirmed_link_ids: input.linkIds }
  }

  async requireProjectAssetRework(dramaId: number, userId: number, linkId: number, reasonCode: string, note?: string) {
    await this.requireOwnedDrama(dramaId, userId)
    const [link] = await this.db.db
      .select()
      .from(dramaAssetLinks)
      .where(and(eq(dramaAssetLinks.id, linkId), eq(dramaAssetLinks.dramaId, dramaId), eq(dramaAssetLinks.userId, userId), isNull(dramaAssetLinks.deletedAt)))
    if (!link) throw new NotFoundException('project_asset_link_not_found')
    await this.db.db
      .update(dramaAssetLinks)
      .set({
        reviewStatus: DRAMA_REVIEW_STATUSES.REWORK_REQUIRED,
        qualityStatus: 'warning',
        qualityReasonsJson: JSON.stringify([{ code: reasonCode, message: note || '需要重新生成。', source: 'user_marked' }]),
        updatedAt: now(),
      })
      .where(eq(dramaAssetLinks.id, link.id))
    return { success: true }
  }

  private async updateProjectAssetStatus(
    dramaId: number,
    userId: number,
    assetId: number,
    status: string,
    reviewStatus: string,
  ) {
    await this.requireOwnedDrama(dramaId, userId)
    const [link] = await this.db.db
      .select()
      .from(dramaAssetLinks)
      .where(and(eq(dramaAssetLinks.assetId, assetId), eq(dramaAssetLinks.dramaId, dramaId), eq(dramaAssetLinks.userId, userId), isNull(dramaAssetLinks.deletedAt)))
    if (!link) throw new NotFoundException('project_asset_link_not_found')
    await this.db.db.update(dramaAssetLinks).set({ status, reviewStatus, updatedAt: now() }).where(eq(dramaAssetLinks.id, link.id))
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
    const episode = await this.requireEpisode(dramaId, userId, storyboard.episodeId)
    return { storyboard, episode }
  }

  private async resolveCommitTarget(
    dramaId: number,
    userId: number,
    targetType: string,
    targetId: string,
    targetField: string,
  ) {
    const id = toOptionalInt(targetId)
    if (!id) throw new BadRequestException('invalid_target_id')

    if (targetType === 'character') {
      const [character] = await this.db.db
        .select()
        .from(characters)
        .where(and(eq(characters.id, id), eq(characters.dramaId, dramaId), eq(characters.userId, userId), isNull(characters.deletedAt)))
      if (!character) throw new NotFoundException('target_not_found')
      if (!['image', 'voice_sample'].includes(targetField)) throw new BadRequestException('unsupported_target_field')
      return {
        episodeId: null as number | null,
        storyboardId: null as number | null,
        previousUrl: targetField === 'voice_sample' ? character.voiceSampleUrl : character.imageUrl,
        apply: async (tx: typeof this.db.db, url: string) => {
          await tx.update(characters).set({
            ...(targetField === 'voice_sample' ? { voiceSampleUrl: url } : { imageUrl: url }),
            updatedAt: now(),
          }).where(eq(characters.id, character.id))
        },
      }
    }

    if (targetType === 'scene') {
      const [scene] = await this.db.db
        .select()
        .from(scenes)
        .where(and(eq(scenes.id, id), eq(scenes.dramaId, dramaId), eq(scenes.userId, userId), isNull(scenes.deletedAt)))
      if (!scene) throw new NotFoundException('target_not_found')
      if (targetField !== 'image') throw new BadRequestException('unsupported_target_field')
      return {
        episodeId: scene.episodeId,
        storyboardId: null as number | null,
        previousUrl: scene.imageUrl,
        apply: async (tx: typeof this.db.db, url: string) => {
          await tx.update(scenes).set({ imageUrl: url, updatedAt: now() }).where(eq(scenes.id, scene.id))
        },
      }
    }

    if (targetType === 'storyboard') {
      const { storyboard, episode } = await this.requireStoryboard(dramaId, userId, id)
      const columnKey = normalizeStoryboardTargetField(targetField)
      if (!columnKey) throw new BadRequestException('unsupported_target_field')
      return {
        episodeId: episode.id,
        storyboardId: storyboard.id,
        previousUrl: storyboard[columnKey],
        apply: async (tx: typeof this.db.db, url: string) => {
          await tx.update(storyboards).set({ [columnKey]: url, updatedAt: now() }).where(eq(storyboards.id, storyboard.id))
        },
      }
    }

    throw new BadRequestException('unsupported_target_type')
  }

  private roleFromTarget(targetType: string, targetField: string, asset: typeof assets.$inferSelect) {
    if (targetType === 'character' && targetField === 'image') return 'character_portrait'
    if (targetType === 'character' && targetField === 'voice_sample') return 'voiceover'
    if (targetType === 'scene' && targetField === 'image') return 'scene_image'
    if (targetType === 'storyboard') return normalizeStoryboardTargetField(targetField) ?? targetField
    return inferRole(asset)
  }

  private async findAssetIdByUrl(userId: number, dramaId: number, url: string) {
    const [asset] = await this.db.db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.userId, userId), eq(assets.dramaId, dramaId), eq(assets.url, url), isNull(assets.deletedAt)))
    return asset?.id ?? null
  }
}
