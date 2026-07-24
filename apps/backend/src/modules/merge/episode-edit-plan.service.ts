import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../common/media-url'
import { DatabaseService } from '../../db/database.service'
import {
  dramas,
  episodeDialogueCues,
  episodeDialogueTakeAttempts,
  episodeDialogueTakes,
  episodeEditRevisions,
  episodeMediaProductionRuns,
  episodeMediaRunItems,
  episodes,
  storyboardBoundaries,
  storyboards,
  videoGenerations,
} from '../../db/schema'

type JsonObject = Record<string, unknown>
type AudioPolicy =
  | 'mute'
  | 'verified_ambience'
  | 'sfx_only'
  | 'music_only'
  | 'unknown'
  | 'contains_dialogue'

const AUDIO_POLICIES = new Set<AudioPolicy>([
  'mute',
  'verified_ambience',
  'sfx_only',
  'music_only',
  'unknown',
  'contains_dialogue',
])

const TIMELINE_RENDERABLE_TRANSITIONS = new Set([
  'hard_cut',
  'match_cut',
])

function parseJsonObject(value: string | null | undefined): JsonObject {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonObject
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizeAudioPolicy(value: unknown): AudioPolicy {
  return AUDIO_POLICIES.has(value as AudioPolicy)
    ? value as AudioPolicy
    : 'mute'
}

function hasDialogue(storyboard: typeof storyboards.$inferSelect) {
  return Boolean(String(storyboard.dialogue || '').trim())
}

function audioPoliciesFromTimeline(timeline: JsonObject) {
  const clips = Array.isArray(timeline.clips) ? timeline.clips : []
  return clips.reduce<Record<string, unknown>>((result, clip) => {
    if (!clip || typeof clip !== 'object' || Array.isArray(clip)) return result
    const value = clip as Record<string, unknown>
    const storyboardId = Number(value.storyboard_id)
    const audioPolicy = String(value.audio_policy || '').trim()
    if (Number.isInteger(storyboardId) && audioPolicy) {
      result[String(storyboardId)] = audioPolicy
    }
    return result
  }, {})
}

@Injectable()
export class EpisodeEditPlanService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  private now() {
    return new Date()
  }

  private async requireOwnedEpisode(episodeId: number, userId: number) {
    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.id, episodeId),
          eq(episodes.userId, userId),
          isNull(episodes.deletedAt),
        ),
      )
    if (!episode) throw new NotFoundException('episode_not_found')
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, episode.dramaId),
          eq(dramas.userId, userId),
          isNull(dramas.deletedAt),
        ),
      )
    if (!drama) throw new NotFoundException('drama_not_found')
    return { episode, drama }
  }

  private async buildPreview(
    episodeId: number,
    userId: number,
    options: { audioPolicies?: Record<string, unknown> } = {},
  ) {
    const { episode, drama } = await this.requireOwnedEpisode(episodeId, userId)
    const blocks: Array<{ code: string; message: string; boundary_id?: number; take_id?: number }> = []
    const storyboardRows = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(
        and(
          eq(storyboards.episodeId, episodeId),
          eq(storyboards.userId, userId),
          isNull(storyboards.deletedAt),
        ),
      )
      .orderBy(asc(storyboards.storyboardNumber))
    if (!storyboardRows.length) {
      blocks.push({ code: 'storyboards_missing', message: '请先生成并确认本集分镜。' })
    }

    const boundaryRows = storyboardRows.length
      ? await this.databaseService.db
        .select()
        .from(storyboardBoundaries)
        .where(
          and(
            eq(storyboardBoundaries.episodeId, episodeId),
            eq(storyboardBoundaries.userId, userId),
            isNull(storyboardBoundaries.deletedAt),
          ),
        )
      : []
    const boundaryByPair = new Map(
      boundaryRows.map((boundary) => [
        `${boundary.fromStoryboardId}:${boundary.toStoryboardId}`,
        boundary,
      ]),
    )
    const [run] = await this.databaseService.db
      .select()
      .from(episodeMediaProductionRuns)
      .where(
        and(
          eq(episodeMediaProductionRuns.episodeId, episodeId),
          eq(episodeMediaProductionRuns.userId, userId),
          eq(episodeMediaProductionRuns.status, 'completed'),
        ),
      )
      .orderBy(desc(episodeMediaProductionRuns.id))
      .limit(1)
    if (!run) {
      blocks.push({
        code: 'continuity_production_run_missing',
        message: '请先完成本集连续视频生成，再创建剪辑方案。',
      })
    }

    for (let index = 0; index < storyboardRows.length - 1; index += 1) {
      const from = storyboardRows[index]
      const to = storyboardRows[index + 1]
      const boundary = boundaryByPair.get(`${from.id}:${to.id}`)
      const review = parseJsonObject(boundary?.reviewJson)
      if (
        !boundary ||
        boundary.status !== 'approved' ||
        review.reviewed_production_run_id !== run?.id
      ) {
        blocks.push({
          code: 'continuity_boundary_review_required',
          message: `镜头 ${from.storyboardNumber} 到镜头 ${to.storyboardNumber} 尚未针对当前视频版本通过交接审核。`,
          boundary_id: boundary?.id,
        })
      }
    }

    const runItems = run
      ? await this.databaseService.db
        .select()
        .from(episodeMediaRunItems)
        .where(eq(episodeMediaRunItems.productionRunId, run.id))
        .orderBy(asc(episodeMediaRunItems.sequenceIndex))
      : []
    const generationIds = runItems
      .map((item) => item.videoGenerationId)
      .filter((value): value is number => value != null)
    const generationRows = generationIds.length
      ? await this.databaseService.db
        .select()
        .from(videoGenerations)
        .where(inArray(videoGenerations.id, generationIds))
      : []
    const generationById = new Map(
      generationRows.map((generation) => [generation.id, generation]),
    )
    const itemByStoryboardId = new Map(
      runItems.map((item) => [item.storyboardId, item]),
    )
    const audioPolicies = options.audioPolicies ?? {}
    const clips: Array<JsonObject> = []
    for (const [index, storyboard] of storyboardRows.entries()) {
      const item = itemByStoryboardId.get(storyboard.id)
      const generation = item?.videoGenerationId
        ? generationById.get(item.videoGenerationId)
        : null
      if (!item || item.status !== 'completed' || !generation?.videoUrl) {
        blocks.push({
          code: 'continuity_video_missing',
          message: `镜头 ${storyboard.storyboardNumber} 缺少本次连续生产的视频结果。`,
        })
        continue
      }
      const videoUrl = generation.videoUrl
      const videoGenerationId = generation.id
      const incomingBoundary =
        index === 0
          ? null
          : boundaryByPair.get(`${storyboardRows[index - 1].id}:${storyboard.id}`) ?? null
      const transitionType = incomingBoundary?.transitionType || 'hard_cut'
      if (
        index > 0 &&
        !TIMELINE_RENDERABLE_TRANSITIONS.has(transitionType)
      ) {
        blocks.push({
          code: 'timeline_transition_not_renderable',
          message: `镜头 ${storyboardRows[index - 1].storyboardNumber} 到镜头 ${storyboard.storyboardNumber} 选择的“${transitionType}”转场尚不能忠实渲染，请改为硬切/匹配剪辑或等待该转场能力上线。`,
          boundary_id: incomingBoundary?.id,
        })
      }
      const requestedPolicy = audioPolicies[String(storyboard.id)]
      const audioPolicy = normalizeAudioPolicy(requestedPolicy)
      clips.push({
        storyboard_id: storyboard.id,
        storyboard_number: storyboard.storyboardNumber,
        video_generation_id: videoGenerationId,
        video_url: toPublicMediaUrl(videoUrl),
        transition: index === 0
          ? null
          : {
            type: transitionType,
            boundary_id: incomingBoundary?.id ?? null,
          },
        audio_policy: audioPolicy,
      })
    }

    const takeRows = await this.databaseService.db
      .select()
      .from(episodeDialogueTakes)
      .where(
        and(
          eq(episodeDialogueTakes.episodeId, episodeId),
          eq(episodeDialogueTakes.userId, userId),
          isNull(episodeDialogueTakes.deletedAt),
        ),
      )
      .orderBy(asc(episodeDialogueTakes.id))
    const liveTakes = takeRows.filter((take) => !['stale', 'canceled', 'failed'].includes(take.status))
    if (storyboardRows.some(hasDialogue) && !liveTakes.length) {
      blocks.push({
        code: 'dialogue_takes_missing',
        message: '本集存在对白，请先生成并确认连续对白表演。',
      })
    }
    const approvedAttemptIds = liveTakes
      .map((take) => take.approvedAttemptId)
      .filter((value): value is number => value != null)
    const attemptRows = approvedAttemptIds.length
      ? await this.databaseService.db
        .select()
        .from(episodeDialogueTakeAttempts)
        .where(
          and(
            inArray(episodeDialogueTakeAttempts.id, approvedAttemptIds),
            isNull(episodeDialogueTakeAttempts.deletedAt),
          ),
        )
      : []
    const attemptById = new Map(
      attemptRows.map((attempt) => [attempt.id, attempt]),
    )
    for (const take of liveTakes) {
      const approvedAttempt =
        take.approvedAttemptId == null
          ? null
          : attemptById.get(take.approvedAttemptId) ?? null
      if (
        take.status !== 'approved_for_mix' ||
        !take.audioUrl ||
        !take.durationMs ||
        !approvedAttempt ||
        approvedAttempt.status !== 'succeeded' ||
        approvedAttempt.audioUrl !== take.audioUrl ||
        !approvedAttempt.audioSha256
      ) {
        blocks.push({
          code: 'dialogue_take_review_required',
          message: `“${take.speakerName}”的对白表演尚未完成时间校准与确认。`,
          take_id: take.id,
        })
      }
    }
    const takeIds = liveTakes.map((take) => take.id)
    const cueRows = takeIds.length
      ? await this.databaseService.db
        .select()
        .from(episodeDialogueCues)
        .where(
          and(
            inArray(episodeDialogueCues.dialogueTakeId, takeIds),
            isNull(episodeDialogueCues.deletedAt),
          ),
        )
        .orderBy(asc(episodeDialogueCues.id))
      : []
    const takeById = new Map(liveTakes.map((take) => [take.id, take]))
    const dialogueCues: Array<JsonObject> = []
    for (const cue of cueRows) {
      const take = takeById.get(cue.dialogueTakeId)
      if (!take) continue
      if (
        cue.status !== 'approved' ||
        cue.takeInMs == null ||
        cue.takeOutMs == null ||
        cue.timelineInMs == null ||
        cue.takeSampleIn == null ||
        cue.takeSampleOut == null
      ) {
        blocks.push({
          code: 'dialogue_cue_timing_required',
          message: `“${take.speakerName}”的一处对白进入点尚未确认。`,
          take_id: take.id,
        })
        continue
      }
      const approvedAttempt =
        take.approvedAttemptId == null
          ? null
          : attemptById.get(take.approvedAttemptId) ?? null
      if (!approvedAttempt || approvedAttempt.status !== 'succeeded') continue
      dialogueCues.push({
        cue_id: cue.id,
        dialogue_take_id: take.id,
        dialogue_attempt_id: approvedAttempt.id,
        audio_url: toPublicMediaUrl(take.audioUrl),
        speaker_name: take.speakerName,
        take_in_ms: cue.takeInMs,
        take_out_ms: cue.takeOutMs,
        timeline_in_ms: cue.timelineInMs,
        take_sample_in: cue.takeSampleIn,
        take_sample_out: cue.takeSampleOut,
        cue_mode: cue.cueMode,
        sync_policy: cue.syncPolicy,
        subtitle_segments: parseJsonArray(cue.subtitleSegmentsJson),
      })
    }

    const timeline = {
      version: 1,
      clips,
      dialogue_cues: dialogueCues,
      audio_tracks: {
        dialogue_source: 'episode_dialogue_takes',
        original_video_audio_default: 'mute',
      },
    }
    const sourceSnapshot = {
      production_run_id: run?.id ?? null,
      storyboard_ids: storyboardRows.map((storyboard) => storyboard.id),
      video_generation_ids: clips.map((clip) => clip.video_generation_id),
      dialogue_take_ids: liveTakes.map((take) => take.id),
      dialogue_attempt_ids: approvedAttemptIds,
      dialogue_cue_ids: dialogueCues.map((cue) => cue.cue_id),
      boundary_ids: boundaryRows.map((boundary) => boundary.id),
    }
    return {
      ready: blocks.length === 0,
      episode_id: episodeId,
      drama_id: drama.id,
      production_run_id: run?.id ?? null,
      blocks,
      timeline,
      source_snapshot: sourceSnapshot,
    }
  }

  async previewEditRevision(
    episodeId: number,
    userId: number,
    body: Record<string, unknown> = {},
  ) {
    const audioPolicies =
      body.audio_policies && typeof body.audio_policies === 'object' && !Array.isArray(body.audio_policies)
        ? body.audio_policies as Record<string, unknown>
        : {}
    return this.buildPreview(episodeId, userId, { audioPolicies })
  }

  async createEditRevision(
    episodeId: number,
    userId: number,
    body: Record<string, unknown> = {},
  ) {
    const preview = await this.previewEditRevision(episodeId, userId, body)
    if (!preview.ready) {
      throw new ConflictException({
        code: 'episode_edit_revision_preflight_failed',
        blocks: preview.blocks,
      })
    }
    const [created] = await this.databaseService.db
      .insert(episodeEditRevisions)
      .values({
        userId,
        dramaId: preview.drama_id,
        episodeId,
        productionRunId: preview.production_run_id,
        timelineJson: JSON.stringify(preview.timeline),
        sourceSnapshotJson: JSON.stringify(preview.source_snapshot),
        status: 'draft',
        createdAt: this.now(),
        updatedAt: this.now(),
      })
      .returning()
    if (!created) throw new Error('episode_edit_revision_create_failed')
    return this.serializeRevision(created)
  }

  private serializeRevision(revision: typeof episodeEditRevisions.$inferSelect) {
    return {
      id: revision.id,
      episode_id: revision.episodeId,
      production_run_id: revision.productionRunId,
      timeline: parseJsonObject(revision.timelineJson),
      source_snapshot: parseJsonObject(revision.sourceSnapshotJson),
      status: revision.status,
      merged_video_url: toPublicMediaUrl(revision.mergedVideoUrl),
      failure_code: revision.failureCode,
      failure_detail: revision.failureDetail,
      created_at: revision.createdAt,
      updated_at: revision.updatedAt,
      completed_at: revision.completedAt,
    }
  }

  async listEditRevisions(episodeId: number, userId: number) {
    await this.requireOwnedEpisode(episodeId, userId)
    const rows = await this.databaseService.db
      .select()
      .from(episodeEditRevisions)
      .where(
        and(
          eq(episodeEditRevisions.episodeId, episodeId),
          eq(episodeEditRevisions.userId, userId),
          isNull(episodeEditRevisions.deletedAt),
        ),
      )
      .orderBy(desc(episodeEditRevisions.id))
    return {
      episode_id: episodeId,
      revisions: rows.map((row) => this.serializeRevision(row)),
    }
  }

  async getEditRevision(episodeId: number, revisionId: number, userId: number) {
    const revision = await this.requireOwnedRevision(episodeId, revisionId, userId)
    return this.serializeRevision(revision)
  }

  private async requireOwnedRevision(
    episodeId: number,
    revisionId: number,
    userId: number,
  ) {
    const [revision] = await this.databaseService.db
      .select()
      .from(episodeEditRevisions)
      .where(
        and(
          eq(episodeEditRevisions.id, revisionId),
          eq(episodeEditRevisions.episodeId, episodeId),
          eq(episodeEditRevisions.userId, userId),
          isNull(episodeEditRevisions.deletedAt),
        ),
      )
    if (!revision) throw new NotFoundException('episode_edit_revision_not_found')
    return revision
  }

  private async markRevisionStale(
    revisionId: number,
    reason: string,
  ) {
    await this.databaseService.db
      .update(episodeEditRevisions)
      .set({
        status: 'stale',
        failureCode: 'episode_edit_revision_stale',
        failureDetail: reason,
        updatedAt: this.now(),
      })
      .where(eq(episodeEditRevisions.id, revisionId))
  }

  async approveEditRevision(episodeId: number, revisionId: number, userId: number) {
    const revision = await this.requireOwnedRevision(episodeId, revisionId, userId)
    if (!['draft', 'stale'].includes(revision.status)) {
      throw new ConflictException('episode_edit_revision_not_approvable')
    }
    const savedTimeline = parseJsonObject(revision.timelineJson)
    const preview = await this.buildPreview(episodeId, userId, {
      audioPolicies: audioPoliciesFromTimeline(savedTimeline),
    })
    const isCurrent =
      preview.ready &&
      stableJson(savedTimeline) === stableJson(preview.timeline) &&
      stableJson(parseJsonObject(revision.sourceSnapshotJson)) ===
        stableJson(preview.source_snapshot)
    if (!isCurrent) {
      await this.markRevisionStale(
        revision.id,
        '镜头、交接审核或对白表演已变化，请重新检查并创建新的剪辑版本。',
      )
      throw new ConflictException({
        code: 'episode_edit_revision_stale',
        blocks: preview.blocks,
      })
    }
    if (!preview.ready) {
      // The stale branch above always handles an unready preview.
      throw new ConflictException('episode_edit_revision_stale')
    }
    await this.databaseService.db
      .update(episodeEditRevisions)
      .set({
        status: 'approved',
        failureCode: null,
        failureDetail: null,
        updatedAt: this.now(),
      })
      .where(eq(episodeEditRevisions.id, revisionId))
    return this.getEditRevision(episodeId, revisionId, userId)
  }
}
