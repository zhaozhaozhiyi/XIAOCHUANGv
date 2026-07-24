import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { DRAMA_WORKSPACE_CONTRACT_VERSION } from '@xiaochuang/contracts'

import { DatabaseService } from '../../db/database.service'
import {
  dramaReviewCheckpoints,
  dramas,
  episodes,
  storyboardSets,
  storyboards,
  videoMerges,
} from '../../db/schema'

export type ReviewSubjectType = 'episode_script' | 'storyboard_set' | 'episode_final'
type ReviewStatus = 'pending_confirmation' | 'confirmed' | 'rework_required' | 'stale' | 'archived'

type ReviewTarget = {
  subjectType: ReviewSubjectType
  subjectId: string
  episodeId: number
  storyboardSetId: number | null
  episodeNumber: number
  label: string
  href: string
  versionKey: string
}

type ReviewCheckpointSnapshot = {
  subjectType: string
  subjectId: string
  versionKey: string
  reviewStatus: string
  reviewedAt?: Date | null
  reviewNote?: string | null
  updatedAt?: Date | null
}

function hashVersion(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 64)
}

function subjectKey(target: Pick<ReviewTarget, 'subjectType' | 'subjectId'>) {
  return `${target.subjectType}:${target.subjectId}`
}

export function resolveReviewCheckpointForTarget(
  target: Pick<ReviewTarget, 'subjectType' | 'subjectId' | 'versionKey'>,
  checkpoints: ReviewCheckpointSnapshot[],
) {
  const exact = checkpoints.find((checkpoint) =>
    checkpoint.subjectType === target.subjectType
    && checkpoint.subjectId === target.subjectId
    && checkpoint.versionKey === target.versionKey)
  if (exact) {
    return {
      reviewStatus: exact.reviewStatus as ReviewStatus,
      reviewedAt: exact.reviewedAt ?? null,
      reviewNote: exact.reviewNote ?? null,
    }
  }

  const previous = checkpoints
    .filter((checkpoint) =>
      checkpoint.subjectType === target.subjectType
      && checkpoint.subjectId === target.subjectId
      && checkpoint.versionKey !== target.versionKey
      && checkpoint.reviewStatus !== 'archived')
    .sort((left, right) =>
      Number(right.updatedAt ?? right.reviewedAt ?? 0) - Number(left.updatedAt ?? left.reviewedAt ?? 0))[0]

  if (previous) {
    return {
      reviewStatus: 'stale' as const,
      reviewedAt: previous.reviewedAt ?? null,
      reviewNote: '当前版本已更新，请重新确认。',
    }
  }

  return {
    reviewStatus: 'pending_confirmation' as const,
    reviewedAt: null,
    reviewNote: null,
  }
}

@Injectable()
export class DramaReviewService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async getSummary(dramaId: number, userId: number) {
    const targets = await this.currentTargets(dramaId, userId)
    const checkpoints = await this.db.db
      .select()
      .from(dramaReviewCheckpoints)
      .where(eq(dramaReviewCheckpoints.dramaId, dramaId))
    const checkpointBySubject = new Map<string, typeof checkpoints>()
    for (const checkpoint of checkpoints) {
      const key = subjectKey({
        subjectType: checkpoint.subjectType as ReviewSubjectType,
        subjectId: checkpoint.subjectId,
      })
      const bucket = checkpointBySubject.get(key) ?? []
      bucket.push(checkpoint)
      checkpointBySubject.set(key, bucket)
    }
    const items = targets.map((target) => {
      const subjectCheckpoints = checkpointBySubject.get(subjectKey(target)) ?? []
      const resolved = resolveReviewCheckpointForTarget(target, subjectCheckpoints)
      return {
        subject_type: target.subjectType,
        subject_id: target.subjectId,
        episode_id: target.episodeId,
        episode_number: target.episodeNumber,
        label: target.label,
        href: target.href,
        version_key: target.versionKey,
        review_status: resolved.reviewStatus,
        reviewed_at: resolved.reviewedAt?.toISOString() ?? null,
        review_note: resolved.reviewNote,
      }
    })
    const needsAttention = items.filter((item) => item.review_status !== 'confirmed')
    const first = needsAttention[0] ?? null
    const primaryAction = first
      ? {
        kind: first.subject_type === 'episode_script'
          ? 'confirm_script'
          : first.subject_type === 'storyboard_set'
            ? 'confirm_storyboard'
            : 'confirm_final',
        title: first.review_status === 'rework_required' || first.review_status === 'stale'
          ? `处理${first.label}`
          : `确认${first.label}`,
        description: first.review_status === 'rework_required'
          ? '该版本已标记需重做，请处理后再确认。'
          : first.review_status === 'stale'
            ? '内容已更新，请重新检查并确认当前版本。'
            : '请在交付前确认当前版本。',
        href: first.href,
        subject_type: first.subject_type,
        subject_id: first.subject_id,
      }
      : {
        kind: items.length ? 'review_project' : 'create_reviewable_output',
        title: items.length ? '可以交付' : '先完成一个可审核版本',
        description: items.length ? '所有当前版本均已确认。' : '剧本、分镜或成片完成后会出现在这里。',
        href: items[0]?.href ?? `/drama/${dramaId}/episodes`,
        subject_type: null,
        subject_id: null,
      }
    return {
      contract_version: DRAMA_WORKSPACE_CONTRACT_VERSION,
      primary_action: primaryAction,
      review: {
        total: items.length,
        confirmed: items.length - needsAttention.length,
        needs_attention: needsAttention.length,
        deliverable: items.length > 0 && needsAttention.length === 0,
        items: items.slice(0, 20),
      },
    }
  }

  async confirm(
    dramaId: number,
    userId: number,
    subjectType: ReviewSubjectType,
    subjectId: string,
    versionKey: string,
    note?: string,
  ) {
    const target = await this.requireCurrentTarget(dramaId, userId, subjectType, subjectId, versionKey)
    const [existing] = await this.db.db
      .select()
      .from(dramaReviewCheckpoints)
      .where(and(
        eq(dramaReviewCheckpoints.dramaId, dramaId),
        eq(dramaReviewCheckpoints.subjectType, target.subjectType),
        eq(dramaReviewCheckpoints.subjectId, target.subjectId),
        eq(dramaReviewCheckpoints.versionKey, target.versionKey),
      ))
    const timestamp = new Date()
    const values = {
      reviewStatus: 'confirmed',
      reviewNote: note ?? null,
      reviewedBy: userId,
      reviewedAt: timestamp,
      staleAt: null,
      staleReason: null,
      updatedAt: timestamp,
    }
    const [checkpoint] = existing
      ? await this.db.db
        .update(dramaReviewCheckpoints)
        .set(values)
        .where(eq(dramaReviewCheckpoints.id, existing.id))
        .returning()
      : await this.db.db
        .insert(dramaReviewCheckpoints)
        .values({
          dramaId,
          episodeId: target.episodeId,
          storyboardSetId: target.storyboardSetId,
          subjectType: target.subjectType,
          subjectId: target.subjectId,
          versionKey: target.versionKey,
          ...values,
          createdAt: timestamp,
        })
        .returning()
    return this.serializeCheckpoint(target, checkpoint)
  }

  async requireRework(
    dramaId: number,
    userId: number,
    subjectType: ReviewSubjectType,
    subjectId: string,
    reasonCode: string,
    note?: string,
  ) {
    const target = await this.requireCurrentTarget(dramaId, userId, subjectType, subjectId)
    const [existing] = await this.db.db
      .select()
      .from(dramaReviewCheckpoints)
      .where(and(
        eq(dramaReviewCheckpoints.dramaId, dramaId),
        eq(dramaReviewCheckpoints.subjectType, target.subjectType),
        eq(dramaReviewCheckpoints.subjectId, target.subjectId),
        eq(dramaReviewCheckpoints.versionKey, target.versionKey),
      ))
    const timestamp = new Date()
    const values = {
      reviewStatus: 'rework_required',
      reviewNote: note || reasonCode,
      reviewedBy: userId,
      reviewedAt: timestamp,
      updatedAt: timestamp,
    }
    const [checkpoint] = existing
      ? await this.db.db.update(dramaReviewCheckpoints).set(values).where(eq(dramaReviewCheckpoints.id, existing.id)).returning()
      : await this.db.db.insert(dramaReviewCheckpoints).values({
        dramaId,
        episodeId: target.episodeId,
        storyboardSetId: target.storyboardSetId,
        subjectType: target.subjectType,
        subjectId: target.subjectId,
        versionKey: target.versionKey,
        ...values,
        createdAt: timestamp,
      }).returning()
    return this.serializeCheckpoint(target, checkpoint)
  }

  private async requireCurrentTarget(
    dramaId: number,
    userId: number,
    subjectType: ReviewSubjectType,
    subjectId: string,
    versionKey?: string,
  ) {
    const target = (await this.currentTargets(dramaId, userId)).find(
      (item) => item.subjectType === subjectType && item.subjectId === subjectId,
    )
    if (!target) throw new NotFoundException('review_subject_not_found')
    if (versionKey && target.versionKey !== versionKey) throw new ConflictException('review_version_stale')
    return target
  }

  private async currentTargets(dramaId: number, userId: number): Promise<ReviewTarget[]> {
    const [drama, episodeRows, setRows, storyboardRows, mergeRows] = await Promise.all([
      this.requireOwnedDrama(dramaId, userId),
      this.db.db.select().from(episodes).where(and(eq(episodes.dramaId, dramaId), eq(episodes.userId, userId), isNull(episodes.deletedAt))),
      this.db.db.select().from(storyboardSets).where(and(eq(storyboardSets.dramaId, dramaId), eq(storyboardSets.userId, userId))).orderBy(desc(storyboardSets.revision)),
      this.db.db.select().from(storyboards).where(and(eq(storyboards.userId, userId), isNull(storyboards.deletedAt))),
      this.db.db.select().from(videoMerges).where(and(eq(videoMerges.dramaId, dramaId), eq(videoMerges.userId, userId), isNull(videoMerges.deletedAt))).orderBy(desc(videoMerges.createdAt)),
    ])
    void drama
    const episodeById = new Map(episodeRows.map((episode) => [episode.id, episode]))
    const publishedSetByEpisode = new Map<number, typeof setRows[number]>()
    for (const set of setRows) {
      if (set.status === 'published' && !publishedSetByEpisode.has(set.episodeId)) {
        publishedSetByEpisode.set(set.episodeId, set)
      }
    }
    const boardsByEpisode = new Map<number, typeof storyboardRows>()
    for (const board of storyboardRows) {
      if (!episodeById.has(board.episodeId)) continue
      const group = boardsByEpisode.get(board.episodeId) ?? []
      group.push(board)
      boardsByEpisode.set(board.episodeId, group)
    }
    const mergeByEpisode = new Map<number, typeof mergeRows[number]>()
    for (const merge of mergeRows) {
      if (merge.episodeId && merge.mergedUrl && !mergeByEpisode.has(merge.episodeId)) {
        mergeByEpisode.set(merge.episodeId, merge)
      }
    }
    const targets: ReviewTarget[] = []
    for (const episode of episodeRows) {
      const script = String(episode.scriptContent || '').trim()
      if (script) {
        targets.push({
          subjectType: 'episode_script',
          subjectId: String(episode.id),
          episodeId: episode.id,
          storyboardSetId: null,
          episodeNumber: episode.episodeNumber,
          label: `第 ${episode.episodeNumber} 集剧本`,
          href: `/drama/${dramaId}/episodes/${episode.episodeNumber}?stage=script`,
          versionKey: hashVersion({ script, updatedAt: episode.updatedAt }),
        })
      }
      const set = publishedSetByEpisode.get(episode.id)
      const boards = boardsByEpisode.get(episode.id) ?? []
      if (set || boards.length) {
        targets.push({
          subjectType: 'storyboard_set',
          subjectId: set ? String(set.id) : `episode:${episode.id}`,
          episodeId: episode.id,
          storyboardSetId: set?.id ?? null,
          episodeNumber: episode.episodeNumber,
          label: `第 ${episode.episodeNumber} 集分镜`,
          href: `/drama/${dramaId}/episodes/${episode.episodeNumber}?stage=storyboard`,
          versionKey: set?.contentHash ?? hashVersion(boards.map((board) => ({ id: board.id, updatedAt: board.updatedAt }))),
        })
      }
      const merge = mergeByEpisode.get(episode.id)
      const finalUrl = merge?.mergedUrl || episode.videoUrl
      if (finalUrl) {
        targets.push({
          subjectType: 'episode_final',
          subjectId: String(episode.id),
          episodeId: episode.id,
          storyboardSetId: null,
          episodeNumber: episode.episodeNumber,
          label: `第 ${episode.episodeNumber} 集成片`,
          href: `/drama/${dramaId}/episodes/${episode.episodeNumber}?stage=final`,
          versionKey: hashVersion({ finalUrl, mergeId: merge?.id ?? null }),
        })
      }
    }
    return targets
  }

  private async requireOwnedDrama(dramaId: number, userId: number) {
    const [drama] = await this.db.db.select({ id: dramas.id }).from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId), isNull(dramas.deletedAt)))
    if (!drama) throw new NotFoundException('drama_not_found')
    return drama
  }

  private serializeCheckpoint(target: ReviewTarget, checkpoint: typeof dramaReviewCheckpoints.$inferSelect | undefined) {
    return {
      subject_type: target.subjectType,
      subject_id: target.subjectId,
      version_key: target.versionKey,
      review_status: checkpoint?.reviewStatus ?? 'pending_confirmation',
      reviewed_at: checkpoint?.reviewedAt?.toISOString() ?? null,
    }
  }
}
