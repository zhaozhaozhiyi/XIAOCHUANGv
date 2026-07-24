import { createHash } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { assets, characters, dramaAssetLinks, episodes, scenes, storyboards, taskLogs, tasks } from '../../db/schema'
import { AssetsService } from '../assets/assets.service'

type BackfillLinkSpec = {
  scope: string
  role: string
  targetType: string | null
  targetId: string | null
  targetField: string | null
}

type CommitPolicy = 'candidate_only' | 'commit_if_empty' | 'replace_confirmed'

type BackfillPlan = BackfillLinkSpec & {
  commitPolicy: CommitPolicy
  replaceExisting: boolean
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseJsonObject(value: string | null | undefined) {
  const parsed = parseJsonValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
}

function optionalString(value: unknown) {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

function optionalPositiveId(value: unknown) {
  const text = optionalString(value)
  if (!text) return null
  const parsed = Number(text)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function isCommitPolicy(value: unknown): value is CommitPolicy {
  return value === 'candidate_only' || value === 'commit_if_empty' || value === 'replace_confirmed'
}

function mediaVersionKey(task: typeof tasks.$inferSelect, asset: typeof assets.$inferSelect) {
  return createHash('sha256')
    .update(JSON.stringify({
      taskId: task.id,
      assetId: asset.id,
      url: asset.url,
      updatedAt: asset.updatedAt?.toISOString?.() ?? null,
    }))
    .digest('hex')
    .slice(0, 32)
}

function normalizeTargetField(targetType: string | null, field: string | null) {
  if (!targetType || !field) return field
  const key = field.trim()
  const normalized = key.replace(/[-\s]/g, '_')

  if (targetType === 'storyboard') {
    const map: Record<string, string> = {
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
    }
    return map[key] ?? map[normalized] ?? key
  }

  if (targetType === 'episode') {
    const map: Record<string, string> = {
      episode_video: 'videoUrl',
      video: 'videoUrl',
      video_url: 'videoUrl',
      videoUrl: 'videoUrl',
      thumbnail: 'thumbnail',
    }
    return map[key] ?? map[normalized] ?? key
  }

  return key
}

@Injectable()
export class DramaProductionBackfillService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AssetsService) private readonly assetsService: AssetsService,
  ) {}

  private now() {
    return new Date()
  }

  private resolveDramaId(task: typeof tasks.$inferSelect, asset: typeof assets.$inferSelect) {
    const value = task.dramaId ?? asset.dramaId ?? null
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null
  }

  private inferLinkSpec(task: typeof tasks.$inferSelect, asset: typeof assets.$inferSelect): BackfillLinkSpec {
    const storyboardId = task.storyboardId ?? asset.storyboardId ?? null
    const episodeId = task.episodeId ?? asset.episodeId ?? null

    if (task.domainTable === 'video_generations') {
      return {
        scope: storyboardId ? 'storyboard' : episodeId ? 'episode' : 'project',
        role: storyboardId ? 'shot_video' : 'composed_video',
        targetType: storyboardId ? 'storyboard' : episodeId ? 'episode' : null,
        targetId: storyboardId ? String(storyboardId) : episodeId ? String(episodeId) : null,
        targetField: storyboardId ? 'videoUrl' : episodeId ? 'videoUrl' : null,
      }
    }

    if (task.domainTable === 'storyboard_tts') {
      return {
        scope: 'storyboard',
        role: 'voiceover',
        targetType: 'storyboard',
        targetId: String(storyboardId ?? task.domainId),
        targetField: 'ttsAudioUrl',
      }
    }

    if (task.domainTable === 'storyboard_compose') {
      return {
        scope: 'storyboard',
        role: 'composed_video',
        targetType: 'storyboard',
        targetId: String(storyboardId ?? task.domainId),
        targetField: 'composedVideoUrl',
      }
    }

    if (task.domainTable === 'video_merges') {
      return {
        scope: episodeId ? 'episode' : 'project',
        role: 'composed_video',
        targetType: episodeId ? 'episode' : null,
        targetId: episodeId ? String(episodeId) : null,
        targetField: episodeId ? 'videoUrl' : null,
      }
    }

    if (task.domainTable === 'image_generations') {
      if (task.sourceType === 'drama_character_image') {
        return { scope: 'project', role: 'character_portrait', targetType: null, targetId: null, targetField: null }
      }
      if (task.sourceType === 'drama_scene_image') {
        return { scope: episodeId ? 'episode' : 'project', role: 'scene_image', targetType: null, targetId: null, targetField: null }
      }
      return {
        scope: storyboardId ? 'storyboard' : episodeId ? 'episode' : 'project',
        role: storyboardId ? 'first_frame' : 'reference',
        targetType: storyboardId ? 'storyboard' : null,
        targetId: storyboardId ? String(storyboardId) : null,
        targetField: storyboardId ? 'firstFrameImage' : null,
      }
    }

    return {
      scope: storyboardId ? 'storyboard' : episodeId ? 'episode' : 'project',
      role: 'reference',
      targetType: storyboardId ? 'storyboard' : episodeId ? 'episode' : null,
      targetId: storyboardId ? String(storyboardId) : episodeId ? String(episodeId) : null,
      targetField: null,
    }
  }

  private buildBackfillPlan(task: typeof tasks.$inferSelect, asset: typeof assets.$inferSelect): BackfillPlan {
    const inferred = this.inferLinkSpec(task, asset)
    const payload = parseJsonObject(task.payloadJson)
    const targetType = optionalString(payload.target_type) ?? inferred.targetType
    const targetId = optionalString(payload.target_id) ?? inferred.targetId
    const targetField = normalizeTargetField(targetType, optionalString(payload.target_field) ?? inferred.targetField)
    const role = optionalString(payload.asset_role) ?? inferred.role
    const commitPolicy = isCommitPolicy(payload.commit_policy)
      ? payload.commit_policy
      : targetType && targetId && targetField
        ? 'commit_if_empty'
        : 'candidate_only'

    return {
      ...inferred,
      role,
      targetType,
      targetId,
      targetField,
      commitPolicy,
      replaceExisting: Boolean(payload.replace_existing),
    }
  }

  private async resolvePreviousAssetId(userId: number | null, dramaId: number, url: string | null) {
    if (!userId || !url) return null
    const [asset] = await this.databaseService.db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.userId, userId), eq(assets.dramaId, dramaId), eq(assets.url, url), isNull(assets.deletedAt)))
    return asset?.id ?? null
  }

  private async resolveCurrentTargetUrl(dramaId: number, userId: number | null, plan: BackfillPlan) {
    const targetId = optionalPositiveId(plan.targetId)
    if (!plan.targetType || !targetId) return null

    if (plan.targetType === 'storyboard') {
      const [storyboard] = await this.databaseService.db
        .select({
          firstFrameImage: storyboards.firstFrameImage,
          lastFrameImage: storyboards.lastFrameImage,
          videoUrl: storyboards.videoUrl,
          ttsAudioUrl: storyboards.ttsAudioUrl,
          composedVideoUrl: storyboards.composedVideoUrl,
        })
        .from(storyboards)
        .innerJoin(episodes, eq(storyboards.episodeId, episodes.id))
        .where(and(
          eq(storyboards.id, targetId),
          eq(episodes.dramaId, dramaId),
          userId ? eq(storyboards.userId, userId) : undefined,
          isNull(storyboards.deletedAt),
          isNull(episodes.deletedAt),
        ))
      if (!storyboard || !plan.targetField) return null
      return storyboard[plan.targetField as keyof typeof storyboard] ?? null
    }

    if (plan.targetType === 'episode') {
      const [episode] = await this.databaseService.db
        .select({ videoUrl: episodes.videoUrl, thumbnail: episodes.thumbnail })
        .from(episodes)
        .where(and(
          eq(episodes.id, targetId),
          eq(episodes.dramaId, dramaId),
          userId ? eq(episodes.userId, userId) : undefined,
          isNull(episodes.deletedAt),
        ))
      if (!episode || !plan.targetField) return null
      return episode[plan.targetField as keyof typeof episode] ?? null
    }

    if (plan.targetType === 'character') {
      const [character] = await this.databaseService.db
        .select({ imageUrl: characters.imageUrl, voiceSampleUrl: characters.voiceSampleUrl })
        .from(characters)
        .where(and(
          eq(characters.id, targetId),
          eq(characters.dramaId, dramaId),
          userId ? eq(characters.userId, userId) : undefined,
          isNull(characters.deletedAt),
        ))
      if (!character) return null
      return plan.targetField === 'voice_sample' ? character.voiceSampleUrl : character.imageUrl
    }

    if (plan.targetType === 'scene') {
      const [scene] = await this.databaseService.db
        .select({ imageUrl: scenes.imageUrl })
        .from(scenes)
        .where(and(
          eq(scenes.id, targetId),
          eq(scenes.dramaId, dramaId),
          userId ? eq(scenes.userId, userId) : undefined,
          isNull(scenes.deletedAt),
        ))
      return scene?.imageUrl ?? null
    }

    return null
  }

  private async applyTarget(tx: typeof this.databaseService.db, plan: BackfillPlan, url: string | null, timestamp: Date) {
    const targetId = optionalPositiveId(plan.targetId)
    if (!url || !plan.targetType || !targetId || !plan.targetField) return false

    if (plan.targetType === 'storyboard') {
      const fieldMap = {
        firstFrameImage: storyboards.firstFrameImage,
        lastFrameImage: storyboards.lastFrameImage,
        videoUrl: storyboards.videoUrl,
        ttsAudioUrl: storyboards.ttsAudioUrl,
        composedVideoUrl: storyboards.composedVideoUrl,
      } as const
      const column = fieldMap[plan.targetField as keyof typeof fieldMap]
      if (!column) return false
      await tx.update(storyboards).set({ [plan.targetField]: url, updatedAt: timestamp }).where(eq(storyboards.id, targetId))
      return true
    }

    if (plan.targetType === 'episode') {
      if (plan.targetField === 'videoUrl') {
        await tx.update(episodes).set({ videoUrl: url, updatedAt: timestamp }).where(eq(episodes.id, targetId))
        return true
      }
      if (plan.targetField === 'thumbnail') {
        await tx.update(episodes).set({ thumbnail: url, updatedAt: timestamp }).where(eq(episodes.id, targetId))
        return true
      }
      return false
    }

    if (plan.targetType === 'character') {
      if (plan.targetField === 'voice_sample') {
        await tx.update(characters).set({ voiceSampleUrl: url, updatedAt: timestamp }).where(eq(characters.id, targetId))
        return true
      }
      if (plan.targetField === 'image') {
        await tx.update(characters).set({ imageUrl: url, updatedAt: timestamp }).where(eq(characters.id, targetId))
        return true
      }
      return false
    }

    if (plan.targetType === 'scene' && plan.targetField === 'image') {
      await tx.update(scenes).set({ imageUrl: url, updatedAt: timestamp }).where(eq(scenes.id, targetId))
      return true
    }

    return false
  }

  private async markBackfillFailed(task: typeof tasks.$inferSelect, assetId: number | null, error: unknown) {
    const timestamp = this.now()
    const message = error instanceof Error ? error.message : String(error)
    await this.databaseService.db
      .update(tasks)
      .set({
        status: 'failed',
        errorKind: 'backfill_failed',
        errorMessage: message.slice(0, 500),
        errorDetailsJson: JSON.stringify({
          error_kind: 'backfill_failed',
          asset_id: assetId,
          raw_error: message,
        }),
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, task.id))
    await this.databaseService.db.insert(taskLogs).values({
      taskId: task.id,
      userId: task.userId ?? null,
      level: 'error',
      message: '短剧项目任务结果回填失败',
      metadataJson: JSON.stringify({ asset_id: assetId, error: message }),
      createdAt: timestamp,
    })
  }

  async backfillTaskResult(taskId: number) {
    const asset = await this.assetsService.ensureAssetFromTask(taskId)
    if (!asset) return { skipped: true as const, reason: 'asset_not_ready' }

    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))

    if (!task || task.status !== 'completed') {
      return { skipped: true as const, reason: 'task_not_completed', asset_id: asset.id }
    }

    const dramaId = this.resolveDramaId(task, asset)
    if (!dramaId) return { skipped: true as const, reason: 'non_drama_task', asset_id: asset.id }

    const plan = this.buildBackfillPlan(task, asset)
    const timestamp = this.now()
    // A completed task creates a reviewable candidate. Only an explicit user
    // confirmation followed by commit may write a media result into a target.
    const status = 'candidate'
    const qualityStatus = asset.url ? 'passed' : 'warning'
    const qualityReasons = asset.url
      ? []
      : [{ code: 'media_url_missing', message: '生成结果没有可用媒体地址。' }]
    const metadata = {
      backfill_version: 1,
      commit_policy: plan.commitPolicy,
      committed: false,
      auto_commit_blocked: true,
      source_type: task.sourceType,
      domain_table: task.domainTable,
      domain_id: task.domainId,
      result_summary: parseJsonValue(task.resultSummaryJson),
    }

    try {
      return await this.databaseService.db.transaction(async (tx) => {
        await tx.update(assets).set({
          dramaId,
          episodeId: task.episodeId ?? asset.episodeId ?? null,
          storyboardId: task.storyboardId ?? asset.storyboardId ?? null,
          updatedAt: timestamp,
        }).where(eq(assets.id, asset.id))

        const [existing] = await tx
          .select()
          .from(dramaAssetLinks)
          .where(and(
            eq(dramaAssetLinks.sourceTaskId, task.id),
            isNull(dramaAssetLinks.deletedAt),
          ))

        const values = {
          userId: task.userId ?? asset.userId ?? existing.userId ?? null,
          dramaId,
          episodeId: task.episodeId ?? asset.episodeId ?? existing.episodeId ?? null,
          storyboardId: task.storyboardId ?? asset.storyboardId ?? existing.storyboardId ?? null,
          assetId: asset.id,
          scope: plan.scope,
          status,
          reviewStatus: 'pending_confirmation',
          qualityStatus,
          qualityReasonsJson: JSON.stringify(qualityReasons),
          reviewedBy: null,
          reviewedAt: null,
          staleAt: null,
          staleReason: null,
          versionKey: mediaVersionKey(task, asset),
          role: plan.role,
          targetType: plan.targetType,
          targetId: plan.targetId,
          targetField: plan.targetField,
          sourceModule: 'task',
          previousAssetId: null,
          metadataJson: JSON.stringify(metadata),
          updatedAt: timestamp,
        }

        if (existing) {
          const [updated] = await tx
            .update(dramaAssetLinks)
            .set(values)
            .where(eq(dramaAssetLinks.id, existing.id))
            .returning()
          return { skipped: false as const, asset_id: asset.id, link_id: updated?.id ?? existing.id, committed: false }
        }

        const [created] = await tx
          .insert(dramaAssetLinks)
          .values({ ...values, sourceTaskId: task.id, createdAt: timestamp })
          .returning()

        return { skipped: false as const, asset_id: asset.id, link_id: created.id, committed: false }
      })
    } catch (error) {
      await this.markBackfillFailed(task, asset.id, error)
      throw error
    }
  }
}
