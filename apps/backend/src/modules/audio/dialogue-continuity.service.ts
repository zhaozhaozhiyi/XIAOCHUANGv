import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../common/media-url'
import { DatabaseService } from '../../db/database.service'
import {
  characters,
  dramas,
  episodeDialogueCues,
  episodeDialogueTakeAttempts,
  episodeDialogueTakes,
  episodes,
  storyboardBoundaries,
  storyboards,
  tasks,
} from '../../db/schema'
import { resolveProjectConfigId } from '../dramas/drama-metadata'
import { TaskQueueService } from '../queue/task-queue.service'
import {
  getStoryboardTtsDialogue,
  isNarratorSpeaker,
  parseDialogueForTTS,
} from './audio.dialogue'
import { AudioService } from './audio.service'

type JsonObject = Record<string, unknown>
type CueMode =
  | 'within_shot'
  | 'continue_from_previous'
  | 'lead_into_next'
  | 'overlap'
type SyncPolicy = 'required' | 'preferred' | 'not_required'

type DialogueCuePlan = {
  storyboardId: number
  boundaryId: number | null
  cueMode: CueMode
  syncPolicy: SyncPolicy
  sourceText: string
}

type DialogueTakePlan = {
  speakerName: string
  speakerCharacterId: number | null
  languageTag: string
  pronunciationManifest: JsonObject
  voiceSnapshot: JsonObject | null
  text: string
  textHash: string
  performance: JsonObject
  sourceStoryboardIds: number[]
  cuePlan: DialogueCuePlan[]
}

const DEFAULT_DIALOGUE_LANGUAGE_TAG = 'zh-CN'

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

function isCueMode(value: unknown): value is CueMode {
  return [
    'within_shot',
    'continue_from_previous',
    'lead_into_next',
    'overlap',
  ].includes(String(value))
}

function isSyncPolicy(value: unknown): value is SyncPolicy {
  return ['required', 'preferred', 'not_required'].includes(String(value))
}

function handoffCueMode(value: unknown): CueMode {
  if (value === 'continue_same_speaker') return 'continue_from_previous'
  if (value === 'offscreen') return 'lead_into_next'
  if (value === 'overlap') return 'overlap'
  return 'within_shot'
}

function taskStatusFromTakeStatus(status: string) {
  if (status === 'failed') return 'failed'
  if (status === 'canceled') return 'canceled'
  if (status === 'generating') return 'running'
  if (['alignment_review_required', 'cue_review_required', 'approved_for_mix'].includes(status)) {
    return 'completed'
  }
  return 'queued'
}

function titleForTake(speakerName: string, text: string) {
  const prefix = `${speakerName || '旁白'}：`
  const source = `${prefix}${text}`.replace(/\s+/g, ' ').trim()
  return source.length > 40 ? `${source.slice(0, 40)}…` : source
}

function parseNonNegativeInteger(value: unknown, code: string) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException(code)
  }
  return parsed
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeLanguageTag(value: unknown) {
  const languageTag = String(value || '').trim()
  if (!languageTag) return null
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(languageTag)
    ? languageTag
    : null
}

function identityPronunciationManifest(text: string, languageTag: string): JsonObject {
  return {
    source_text: text,
    source_text_hash: sha256(text),
    spoken_text: text,
    spoken_text_hash: sha256(text),
    primary_language_tag: languageTag,
    segments: [
      {
        source_start: 0,
        source_end: text.length,
        text,
        language_tag: languageTag,
        kind: 'verbatim',
      },
    ],
    confirmed_by: 'script_revision',
  }
}

@Injectable()
export class DialogueContinuityService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AudioService) private readonly audioService: AudioService,
    @Inject(TaskQueueService)
    private readonly taskQueueService: TaskQueueService,
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

  private async loadPlanningRows(episodeId: number, userId: number) {
    const { episode, drama } = await this.requireOwnedEpisode(episodeId, userId)
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
    const characterRows = await this.databaseService.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.dramaId, drama.id),
          eq(characters.userId, userId),
          isNull(characters.deletedAt),
        ),
      )

    return { episode, drama, storyboardRows, boundaryRows, characterRows }
  }

  private async buildTakePlans(episodeId: number, userId: number) {
    const { episode, drama, storyboardRows, boundaryRows, characterRows } =
      await this.loadPlanningRows(episodeId, userId)
    const blocks: Array<{ code: string; message: string; storyboard_id?: number }> = []
    const sourceStoryboardSetIds = Array.from(
      new Set(
        storyboardRows
          .map((storyboard) => storyboard.storyboardSetId)
          .filter((value): value is number => value != null),
      ),
    )
    if (storyboardRows.length && sourceStoryboardSetIds.length !== 1) {
      blocks.push({
        code: 'dialogue_storyboard_set_inconsistent',
        message: '当前分镜版本不完整，请重新确认分镜后再生成连续对白。',
      })
    }
    const boundaryByToStoryboardId = new Map(
      boundaryRows.map((boundary) => [boundary.toStoryboardId, boundary]),
    )
    const characterByName = new Map(
      characterRows.map((character) => [String(character.name || '').trim(), character]),
    )
    const configId =
      episode.audioConfigId ??
      resolveProjectConfigId(drama.metadata, 'audio') ??
      null

    const plans: DialogueTakePlan[] = []
    let previousSpokenStoryboardId: number | null = null
    let previousSpeakerName: string | null = null

    for (const storyboard of storyboardRows) {
      const parsed = parseDialogueForTTS(getStoryboardTtsDialogue(storyboard))
      if (parsed.ignorable || !parsed.pureText) {
        previousSpokenStoryboardId = null
        previousSpeakerName = null
        continue
      }

      const speakerName = String(parsed.speaker || '旁白').trim() || '旁白'
      const character = isNarratorSpeaker(speakerName)
        ? null
        : characterByName.get(speakerName) ?? null
      if (!isNarratorSpeaker(speakerName) && !character?.voiceStyle) {
        blocks.push({
          code: 'voice_profile_missing',
          message: `镜头 ${storyboard.storyboardNumber} 的角色“${speakerName}”尚未锁定音色。`,
          storyboard_id: storyboard.id,
        })
      }

      const incomingBoundary = boundaryByToStoryboardId.get(storyboard.id) ?? null
      const handoff = parseJsonObject(incomingBoundary?.handoffJson)
      const dialogueHandoff = (() => {
        const value = handoff.dialogue_handoff
        return value && typeof value === 'object' && !Array.isArray(value)
          ? value as JsonObject
          : {}
      })()
      const requestedLanguageTag =
        dialogueHandoff.language_tag ?? dialogueHandoff.languageTag
      const parsedLanguageTag = normalizeLanguageTag(requestedLanguageTag)
      if (requestedLanguageTag != null && !parsedLanguageTag) {
        blocks.push({
          code: 'dialogue_language_invalid',
          message: `镜头 ${storyboard.storyboardNumber} 的对白语言标记无效，请使用如 zh-CN 或 en-US 的格式。`,
          storyboard_id: storyboard.id,
        })
      }
      const languageTag = parsedLanguageTag || DEFAULT_DIALOGUE_LANGUAGE_TAG
      let voiceSnapshot: JsonObject | null = null
      try {
        voiceSnapshot = {
          ...(await this.audioService.resolveDialogueVoiceSnapshot({
            configId,
            requestedVoiceId: character?.voiceStyle ?? null,
            languageTag,
          })),
          configId,
        }
      } catch (error) {
        const code =
          error instanceof Error &&
          error.message.includes('voice_language_unsupported')
            ? 'voice_language_unsupported'
            : 'voice_profile_rejected'
        blocks.push({
          code,
          message:
            code === 'voice_language_unsupported'
              ? `镜头 ${storyboard.storyboardNumber} 的角色“${speakerName}”音色未声明支持 ${languageTag}，请选择兼容的音色或语音模型。`
              : `镜头 ${storyboard.storyboardNumber} 的角色“${speakerName}”音色不兼容当前语音配置。`,
          storyboard_id: storyboard.id,
        })
      }
      const takePolicy = String(dialogueHandoff.take_policy || '').trim()
      const mode = String(dialogueHandoff.mode || '').trim()
      const canContinue =
        previousSpokenStoryboardId != null &&
        previousSpokenStoryboardId === storyboardRows[storyboardRows.indexOf(storyboard) - 1]?.id &&
        previousSpeakerName === speakerName &&
        plans[plans.length - 1]?.languageTag === languageTag &&
        (takePolicy === 'continue_current_take' || mode === 'continue_same_speaker')

      const cuePlan: DialogueCuePlan = {
        storyboardId: storyboard.id,
        boundaryId: incomingBoundary?.id ?? null,
        cueMode: handoffCueMode(mode),
        syncPolicy: isSyncPolicy(dialogueHandoff.sync_policy)
          ? dialogueHandoff.sync_policy
          : 'not_required',
        sourceText: parsed.pureText,
      }
      const performance =
        dialogueHandoff.performance &&
        typeof dialogueHandoff.performance === 'object' &&
        !Array.isArray(dialogueHandoff.performance)
          ? dialogueHandoff.performance as JsonObject
          : {}

      if (canContinue && plans.length) {
        const previousPlan = plans[plans.length - 1]
        previousPlan.text = `${previousPlan.text}\n${parsed.pureText}`
        previousPlan.textHash = sha256(previousPlan.text)
        previousPlan.pronunciationManifest = identityPronunciationManifest(
          previousPlan.text,
          previousPlan.languageTag,
        )
        previousPlan.sourceStoryboardIds.push(storyboard.id)
        previousPlan.cuePlan.push(cuePlan)
        previousPlan.performance = {
          ...previousPlan.performance,
          handoff_performance: performance,
        }
      } else {
        plans.push({
          speakerName,
          speakerCharacterId: character?.id ?? null,
          languageTag,
          pronunciationManifest: identityPronunciationManifest(
            parsed.pureText,
            languageTag,
          ),
          voiceSnapshot,
          text: parsed.pureText,
          textHash: sha256(parsed.pureText),
          performance: {
            source_storyboard_ids: [storyboard.id],
            ...performance,
          },
          sourceStoryboardIds: [storyboard.id],
          cuePlan: [cuePlan],
        })
      }

      previousSpokenStoryboardId = storyboard.id
      previousSpeakerName = speakerName
    }

    return {
      episode,
      drama,
      sourceStoryboardSetId:
        sourceStoryboardSetIds.length === 1 ? sourceStoryboardSetIds[0] : null,
      plans,
      blocks,
    }
  }

  async previewDialogueTakes(episodeId: number, userId: number) {
    const built = await this.buildTakePlans(episodeId, userId)
    return {
      ready: built.blocks.length === 0,
      episode_id: episodeId,
      storyboard_set_id: built.sourceStoryboardSetId,
      blocks: built.blocks,
      takes: built.plans.map((plan, index) => ({
        plan_index: index,
        speaker_name: plan.speakerName,
        speaker_character_id: plan.speakerCharacterId,
        language_tag: plan.languageTag,
        pronunciation_manifest: plan.pronunciationManifest,
        voice_snapshot: plan.voiceSnapshot,
        text: plan.text,
        text_hash: plan.textHash,
        performance: plan.performance,
        source_storyboard_ids: plan.sourceStoryboardIds,
        cues: plan.cuePlan.map((cue) => ({
          storyboard_id: cue.storyboardId,
          boundary_id: cue.boundaryId,
          cue_mode: cue.cueMode,
          sync_policy: cue.syncPolicy,
          source_text: cue.sourceText,
        })),
      })),
    }
  }

  private async createTaskForTake(args: {
    take: typeof episodeDialogueTakes.$inferSelect
    userId: number
    dramaId: number
    episodeId: number
  }) {
    const payload = {
      dialogue_take_id: args.take.id,
      episode_id: args.episodeId,
      drama_id: args.dramaId,
      speaker_name: args.take.speakerName,
      language_tag: args.take.languageTag,
      text_hash: args.take.textHash,
      voice_snapshot: parseJsonObject(args.take.voiceSnapshotJson),
    }
    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, 'episode_dialogue_takes'),
          eq(tasks.domainId, args.take.id),
          isNull(tasks.deletedAt),
        ),
      )
    const timestamp = this.now()
    const values = {
      userId: args.userId,
      type: 'audio' as const,
      status: 'queued',
      title: titleForTake(args.take.speakerName, args.take.text),
      progress: 0,
      sourceType: 'drama_episode_dialogue' as const,
      dramaId: args.dramaId,
      episodeId: args.episodeId,
      storyboardId: null,
      aiConfigId: null,
      domainTable: 'episode_dialogue_takes',
      domainId: args.take.id,
      providerTaskId: null,
      attemptCount: existing?.attemptCount ?? 0,
      payloadJson: JSON.stringify(payload),
      resultSummaryJson: null,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
      deletedAt: existing?.deletedAt ?? null,
    }
    if (existing) {
      await this.databaseService.db
        .update(tasks)
        .set(values)
        .where(eq(tasks.id, existing.id))
      return existing.id
    }

    const [created] = await this.databaseService.db
      .insert(tasks)
      .values(values)
      .onConflictDoNothing({
        target: [tasks.domainTable, tasks.domainId],
        where: sql`${tasks.deletedAt} IS NULL`,
      })
      .returning({ id: tasks.id })
    if (created?.id) return created.id

    const [conflicted] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, 'episode_dialogue_takes'),
          eq(tasks.domainId, args.take.id),
          isNull(tasks.deletedAt),
        ),
      )
    if (!conflicted) throw new Error('dialogue_take_task_create_failed')
    await this.databaseService.db
      .update(tasks)
      .set(values)
      .where(eq(tasks.id, conflicted.id))
    return conflicted.id
  }

  async createDialogueTakes(episodeId: number, userId: number) {
    const built = await this.buildTakePlans(episodeId, userId)
    if (built.blocks.length) {
      throw new ConflictException({
        code: 'dialogue_take_preflight_failed',
        blocks: built.blocks,
      })
    }
    if (!built.plans.length) {
      throw new ConflictException('dialogue_take_plan_empty')
    }
    if (!built.sourceStoryboardSetId) {
      throw new ConflictException('dialogue_storyboard_set_inconsistent')
    }

    const takeIds: number[] = []
    const taskIds: number[] = []
    for (const plan of built.plans) {
      const [created] = await this.databaseService.db
        .insert(episodeDialogueTakes)
        .values({
          userId,
          dramaId: built.drama.id,
          episodeId,
          sourceStoryboardSetId: built.sourceStoryboardSetId,
          sourceScriptRevisionId: null,
          speakerCharacterId: plan.speakerCharacterId,
          speakerName: plan.speakerName,
          languageTag: plan.languageTag,
          pronunciationManifestJson: JSON.stringify(plan.pronunciationManifest),
          voiceSnapshotJson: JSON.stringify(plan.voiceSnapshot || {}),
          text: plan.text,
          textHash: plan.textHash,
          performanceJson: JSON.stringify(plan.performance),
          status: 'planned',
          createdAt: this.now(),
          updatedAt: this.now(),
        })
        .returning()
      if (!created) throw new Error('dialogue_take_create_failed')

      await this.databaseService.db.insert(episodeDialogueCues).values(
        plan.cuePlan.map((cue) => ({
          dialogueTakeId: created.id,
          storyboardId: cue.storyboardId,
          boundaryId: cue.boundaryId,
          cueMode: cue.cueMode,
          syncPolicy: cue.syncPolicy,
          status: 'planned',
          createdAt: this.now(),
          updatedAt: this.now(),
        })),
      )
      const taskId = await this.createTaskForTake({
        take: created,
        userId,
        dramaId: built.drama.id,
        episodeId,
      })
      await this.databaseService.db
        .update(episodeDialogueTakes)
        .set({
          taskId,
          status: 'queued',
          updatedAt: this.now(),
        })
        .where(eq(episodeDialogueTakes.id, created.id))
      takeIds.push(created.id)
      taskIds.push(taskId)
    }

    for (const taskId of taskIds) {
      await this.taskQueueService.enqueueTask(taskId)
    }
    return {
      take_ids: takeIds,
      task_ids: taskIds,
      status: 'queued',
    }
  }

  private async requireOwnedTake(takeId: number, userId?: number) {
    const [take] = await this.databaseService.db
      .select()
      .from(episodeDialogueTakes)
      .where(
        and(
          eq(episodeDialogueTakes.id, takeId),
          userId == null ? undefined : eq(episodeDialogueTakes.userId, userId),
          isNull(episodeDialogueTakes.deletedAt),
        ),
      )
    if (!take) throw new NotFoundException('dialogue_take_not_found')
    return take
  }

  private serializeTake(
    take: typeof episodeDialogueTakes.$inferSelect,
    cues: Array<typeof episodeDialogueCues.$inferSelect>,
    attempts: Array<typeof episodeDialogueTakeAttempts.$inferSelect> = [],
  ) {
    return {
      id: take.id,
      episode_id: take.episodeId,
      source_storyboard_set_id: take.sourceStoryboardSetId,
      speaker_character_id: take.speakerCharacterId,
      speaker_name: take.speakerName,
      language_tag: take.languageTag,
      pronunciation_manifest: parseJsonObject(take.pronunciationManifestJson),
      voice_snapshot: parseJsonObject(take.voiceSnapshotJson),
      text: take.text,
      text_hash: take.textHash,
      performance: parseJsonObject(take.performanceJson),
      approved_attempt_id: take.approvedAttemptId,
      supersedes_take_id: take.supersedesTakeId,
      audio_url: toPublicMediaUrl(take.audioUrl),
      duration_ms: take.durationMs,
      timings: parseJsonArray(take.timingsJson),
      timing_source: take.timingSource,
      status: take.status,
      task_id: take.taskId,
      failure_code: take.failureCode,
      failure_detail: take.failureDetail,
      cues: cues.map((cue) => ({
        id: cue.id,
        storyboard_id: cue.storyboardId,
        boundary_id: cue.boundaryId,
        take_in_ms: cue.takeInMs,
        take_out_ms: cue.takeOutMs,
        timeline_in_ms: cue.timelineInMs,
        take_sample_in: cue.takeSampleIn,
        take_sample_out: cue.takeSampleOut,
        cue_mode: cue.cueMode,
        sync_policy: cue.syncPolicy,
        subtitle_segments: parseJsonArray(cue.subtitleSegmentsJson),
        status: cue.status,
      })),
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        attempt_no: attempt.attemptNo,
        kind: attempt.kind,
        status: attempt.status,
        provider_snapshot: parseJsonObject(attempt.providerSnapshotJson),
        spoken_text_hash: attempt.spokenTextHash,
        spoken_language_tag: attempt.spokenLanguageTag,
        audio_url: toPublicMediaUrl(attempt.audioUrl),
        audio_sha256: attempt.audioSha256,
        duration_ms: attempt.durationMs,
        sample_rate_hz: attempt.sampleRateHz,
        channel_count: attempt.channelCount,
        audio_format: attempt.audioFormat,
        timing_source: attempt.timingSource,
        failure_code: attempt.failureCode,
        failure_detail: attempt.failureDetail,
        created_at: attempt.createdAt,
        completed_at: attempt.completedAt,
      })),
      updated_at: take.updatedAt,
    }
  }

  async getDialogueTakes(episodeId: number, userId: number) {
    await this.requireOwnedEpisode(episodeId, userId)
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
      .orderBy(desc(episodeDialogueTakes.id))
    const takeIds = takeRows.map((take) => take.id)
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
    const attemptRows = takeIds.length
      ? await this.databaseService.db
        .select()
        .from(episodeDialogueTakeAttempts)
        .where(
          and(
            inArray(episodeDialogueTakeAttempts.takeId, takeIds),
            isNull(episodeDialogueTakeAttempts.deletedAt),
          ),
        )
        .orderBy(
          asc(episodeDialogueTakeAttempts.takeId),
          desc(episodeDialogueTakeAttempts.attemptNo),
        )
      : []
    const cuesByTake = new Map<number, Array<typeof episodeDialogueCues.$inferSelect>>()
    for (const cue of cueRows) {
      const list = cuesByTake.get(cue.dialogueTakeId) ?? []
      list.push(cue)
      cuesByTake.set(cue.dialogueTakeId, list)
    }
    const attemptsByTake = new Map<
      number,
      Array<typeof episodeDialogueTakeAttempts.$inferSelect>
    >()
    for (const attempt of attemptRows) {
      const list = attemptsByTake.get(attempt.takeId) ?? []
      list.push(attempt)
      attemptsByTake.set(attempt.takeId, list)
    }
    return {
      episode_id: episodeId,
      takes: takeRows.map((take) =>
        this.serializeTake(
          take,
          cuesByTake.get(take.id) ?? [],
          attemptsByTake.get(take.id) ?? [],
        ),
      ),
    }
  }

  async regenerateDialogueTake(episodeId: number, takeId: number, userId: number) {
    const take = await this.requireOwnedTake(takeId, userId)
    if (take.episodeId !== episodeId) throw new NotFoundException('dialogue_take_not_found')
    const { drama } = await this.requireOwnedEpisode(episodeId, userId)
    const existingCues = await this.databaseService.db
      .select()
      .from(episodeDialogueCues)
      .where(
        and(
          eq(episodeDialogueCues.dialogueTakeId, takeId),
          isNull(episodeDialogueCues.deletedAt),
        ),
      )
      .orderBy(asc(episodeDialogueCues.id))
    const timestamp = this.now()
    const [created] = await this.databaseService.db
      .insert(episodeDialogueTakes)
      .values({
        userId: take.userId,
        dramaId: take.dramaId,
        episodeId: take.episodeId,
        sourceStoryboardSetId: take.sourceStoryboardSetId,
        sourceScriptRevisionId: take.sourceScriptRevisionId,
        speakerCharacterId: take.speakerCharacterId,
        speakerName: take.speakerName,
        languageTag: take.languageTag,
        pronunciationManifestJson: take.pronunciationManifestJson,
        voiceSnapshotJson: take.voiceSnapshotJson,
        text: take.text,
        textHash: take.textHash,
        performanceJson: take.performanceJson,
        supersedesTakeId: take.id,
        status: 'planned',
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
    if (!created) throw new Error('dialogue_take_regeneration_create_failed')
    if (existingCues.length) {
      await this.databaseService.db.insert(episodeDialogueCues).values(
        existingCues.map((cue) => ({
          dialogueTakeId: created.id,
          storyboardId: cue.storyboardId,
          boundaryId: cue.boundaryId,
          cueMode: cue.cueMode,
          syncPolicy: cue.syncPolicy,
          status: 'planned',
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      )
    }
    const taskId = await this.createTaskForTake({
      take: created,
      userId,
      dramaId: drama.id,
      episodeId,
    })
    await this.databaseService.db
      .update(episodeDialogueTakes)
      .set({ taskId, status: 'queued', updatedAt: this.now() })
      .where(eq(episodeDialogueTakes.id, created.id))
    await this.taskQueueService.enqueueTask(taskId, { replaceExisting: true })
    return {
      take_id: created.id,
      supersedes_take_id: take.id,
      task_id: taskId,
      status: 'queued',
    }
  }

  private async refreshTakeCueStatus(takeId: number) {
    const take = await this.requireOwnedTake(takeId)
    const cues = await this.databaseService.db
      .select()
      .from(episodeDialogueCues)
      .where(
        and(
          eq(episodeDialogueCues.dialogueTakeId, takeId),
          isNull(episodeDialogueCues.deletedAt),
        ),
      )
    const allApproved =
      cues.length > 0 &&
      cues.every(
        (cue) =>
          cue.status === 'approved' &&
          cue.takeInMs != null &&
          cue.takeOutMs != null &&
          cue.timelineInMs != null &&
          cue.takeSampleIn != null &&
          cue.takeSampleOut != null,
      )
    const nextStatus = allApproved ? 'approved_for_mix' : 'cue_review_required'
    await this.databaseService.db
      .update(episodeDialogueTakes)
      .set({
        status: nextStatus,
        timingSource: allApproved ? take.timingSource || 'manual_review' : take.timingSource,
        updatedAt: this.now(),
      })
      .where(eq(episodeDialogueTakes.id, takeId))
  }

  async updateDialogueCue(
    episodeId: number,
    cueId: number,
    userId: number,
    body: Record<string, unknown>,
  ) {
    const [cue] = await this.databaseService.db
      .select()
      .from(episodeDialogueCues)
      .where(and(eq(episodeDialogueCues.id, cueId), isNull(episodeDialogueCues.deletedAt)))
    if (!cue) throw new NotFoundException('dialogue_cue_not_found')
    const take = await this.requireOwnedTake(cue.dialogueTakeId, userId)
    if (take.episodeId !== episodeId) throw new NotFoundException('dialogue_cue_not_found')

    const takeInMs = Object.prototype.hasOwnProperty.call(body, 'take_in_ms')
      ? parseNonNegativeInteger(body.take_in_ms, 'invalid_dialogue_cue_take_in_ms')
      : cue.takeInMs
    const takeOutMs = Object.prototype.hasOwnProperty.call(body, 'take_out_ms')
      ? parseNonNegativeInteger(body.take_out_ms, 'invalid_dialogue_cue_take_out_ms')
      : cue.takeOutMs
    const timelineInMs = Object.prototype.hasOwnProperty.call(body, 'timeline_in_ms')
      ? parseNonNegativeInteger(body.timeline_in_ms, 'invalid_dialogue_cue_timeline_in_ms')
      : cue.timelineInMs
    if (takeInMs != null && takeOutMs != null && takeOutMs <= takeInMs) {
      throw new BadRequestException('invalid_dialogue_cue_range')
    }
    if (take.durationMs != null && takeOutMs != null && takeOutMs > take.durationMs) {
      throw new BadRequestException('dialogue_cue_exceeds_take_duration')
    }
    const cueMode = Object.prototype.hasOwnProperty.call(body, 'cue_mode')
      ? body.cue_mode
      : cue.cueMode
    if (!isCueMode(cueMode)) throw new BadRequestException('invalid_dialogue_cue_mode')
    const syncPolicy = Object.prototype.hasOwnProperty.call(body, 'sync_policy')
      ? body.sync_policy
      : cue.syncPolicy
    if (!isSyncPolicy(syncPolicy)) throw new BadRequestException('invalid_dialogue_sync_policy')
    const subtitleSegments = Object.prototype.hasOwnProperty.call(body, 'subtitle_segments')
      ? body.subtitle_segments
      : parseJsonArray(cue.subtitleSegmentsJson)
    if (!Array.isArray(subtitleSegments)) {
      throw new BadRequestException('invalid_dialogue_subtitle_segments')
    }
    const requestedStatus = Object.prototype.hasOwnProperty.call(body, 'status')
      ? String(body.status || '').trim()
      : cue.status
    if (!['planned', 'alignment_review_required', 'approved'].includes(requestedStatus)) {
      throw new BadRequestException('invalid_dialogue_cue_status')
    }
    if (
      requestedStatus === 'approved' &&
      (takeInMs == null || takeOutMs == null || timelineInMs == null)
    ) {
      throw new ConflictException('dialogue_cue_timing_required')
    }
    let sampleRateHz: number | null = null
    if (take.approvedAttemptId != null) {
      const [approvedAttempt] = await this.databaseService.db
        .select()
        .from(episodeDialogueTakeAttempts)
        .where(
          and(
            eq(episodeDialogueTakeAttempts.id, take.approvedAttemptId),
            eq(episodeDialogueTakeAttempts.takeId, take.id),
            eq(episodeDialogueTakeAttempts.status, 'succeeded'),
            isNull(episodeDialogueTakeAttempts.deletedAt),
          ),
        )
      sampleRateHz = approvedAttempt?.sampleRateHz ?? null
    }
    if (requestedStatus === 'approved' && (!take.approvedAttemptId || !sampleRateHz)) {
      throw new ConflictException('dialogue_take_attempt_not_ready')
    }
    const takeSampleIn =
      takeInMs != null && sampleRateHz != null
        ? Math.round((takeInMs * sampleRateHz) / 1000)
        : null
    const takeSampleOut =
      takeOutMs != null && sampleRateHz != null
        ? Math.round((takeOutMs * sampleRateHz) / 1000)
        : null

    await this.databaseService.db
      .update(episodeDialogueCues)
      .set({
        takeInMs,
        takeOutMs,
        timelineInMs,
        takeSampleIn,
        takeSampleOut,
        cueMode,
        syncPolicy,
        subtitleSegmentsJson: JSON.stringify(subtitleSegments),
        status: requestedStatus,
        updatedAt: this.now(),
      })
      .where(eq(episodeDialogueCues.id, cue.id))
    await this.refreshTakeCueStatus(take.id)
    return this.getDialogueTakes(episodeId, userId)
  }

  private async createGeneratingAttempt(
    take: typeof episodeDialogueTakes.$inferSelect,
    providerSnapshot: JsonObject,
    spokenTextHash: string,
  ) {
    const [latestAttempt] = await this.databaseService.db
      .select()
      .from(episodeDialogueTakeAttempts)
      .where(
        and(
          eq(episodeDialogueTakeAttempts.takeId, take.id),
          isNull(episodeDialogueTakeAttempts.deletedAt),
        ),
      )
      .orderBy(desc(episodeDialogueTakeAttempts.attemptNo))
      .limit(1)
    const timestamp = this.now()
    const [created] = await this.databaseService.db
      .insert(episodeDialogueTakeAttempts)
      .values({
        takeId: take.id,
        attemptNo: (latestAttempt?.attemptNo ?? 0) + 1,
        kind: 'final_generation',
        status: 'generating',
        providerSnapshotJson: JSON.stringify(providerSnapshot),
        spokenTextHash,
        spokenLanguageTag: take.languageTag,
        startedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
    if (!created) throw new Error('dialogue_take_attempt_create_failed')
    return created
  }

  private async markLatestActiveAttempt(
    takeId: number,
    status: 'failed' | 'canceled',
    failureCode: string,
    failureDetail: string,
  ) {
    const [attempt] = await this.databaseService.db
      .select()
      .from(episodeDialogueTakeAttempts)
      .where(
        and(
          eq(episodeDialogueTakeAttempts.takeId, takeId),
          inArray(episodeDialogueTakeAttempts.status, ['queued', 'generating']),
          isNull(episodeDialogueTakeAttempts.deletedAt),
        ),
      )
      .orderBy(desc(episodeDialogueTakeAttempts.attemptNo))
      .limit(1)
    if (!attempt) return
    const timestamp = this.now()
    await this.databaseService.db
      .update(episodeDialogueTakeAttempts)
      .set({
        status,
        failureCode,
        failureDetail,
        completedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(episodeDialogueTakeAttempts.id, attempt.id))
  }

  async processDialogueTakeTask(taskId: number) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.domainTable, 'episode_dialogue_takes'),
          isNull(tasks.deletedAt),
        ),
      )
    if (!task) throw new NotFoundException('dialogue_take_task_not_found')
    const take = await this.requireOwnedTake(task.domainId)
    const snapshot = parseJsonObject(take.voiceSnapshotJson)
    const voiceId = String(snapshot.voiceId || '').trim()
    const provider = String(snapshot.provider || '').trim()
    const model = String(snapshot.model || '').trim()
    if (!voiceId || !provider || !model) throw new Error('voice_profile_rejected')
    const snapshotLanguageTag =
      typeof snapshot.languageTag === 'string'
        ? normalizeLanguageTag(snapshot.languageTag)
        : null
    if (snapshotLanguageTag && snapshotLanguageTag !== take.languageTag) {
      throw new Error('voice_language_unsupported')
    }
    if (take.approvedAttemptId != null) {
      throw new ConflictException('dialogue_take_already_approved')
    }
    if (take.textHash && take.textHash !== sha256(take.text)) {
      throw new ConflictException('dialogue_take_text_hash_mismatch')
    }
    const pronunciationManifest = parseJsonObject(take.pronunciationManifestJson)
    const spokenText =
      typeof pronunciationManifest.spoken_text === 'string' &&
      pronunciationManifest.spoken_text.trim()
        ? pronunciationManifest.spoken_text
        : take.text
    const spokenTextHash = sha256(spokenText)
    if (
      typeof pronunciationManifest.spoken_text_hash === 'string' &&
      pronunciationManifest.spoken_text_hash &&
      pronunciationManifest.spoken_text_hash !== spokenTextHash
    ) {
      throw new ConflictException('dialogue_pronunciation_manifest_invalid')
    }
    const attempt = await this.createGeneratingAttempt(
      take,
      snapshot,
      spokenTextHash,
    )

    await this.databaseService.db
      .update(episodeDialogueTakes)
      .set({
        status: 'generating',
        failureCode: null,
        failureDetail: null,
        updatedAt: this.now(),
      })
      .where(eq(episodeDialogueTakes.id, take.id))

    try {
      const generated = await this.audioService.generateDialogueTake({
        text: spokenText,
        voice: voiceId,
        model,
        configId:
          typeof snapshot.configId === 'number' && Number.isInteger(snapshot.configId)
            ? snapshot.configId
            : null,
        speed:
          typeof snapshot.speed === 'number' && Number.isFinite(snapshot.speed)
            ? snapshot.speed
            : undefined,
        emotion: typeof snapshot.emotion === 'string' ? snapshot.emotion : undefined,
        languageTag: take.languageTag,
      })
      const timestamp = this.now()
      await this.databaseService.db.transaction(async (tx) => {
        await tx
          .update(episodeDialogueTakeAttempts)
          .set({
            status: 'succeeded',
            audioUrl: generated.url,
            audioSha256: generated.audioSha256,
            durationMs: generated.durationMs,
            sampleRateHz: generated.sampleRateHz,
            channelCount: generated.channelCount,
            audioFormat: generated.format,
            spokenLanguageTag: take.languageTag,
            completedAt: timestamp,
            updatedAt: timestamp,
          })
          .where(eq(episodeDialogueTakeAttempts.id, attempt.id))
        await tx
          .update(episodeDialogueTakes)
          .set({
            approvedAttemptId: attempt.id,
            audioUrl: generated.url,
            durationMs: generated.durationMs,
            timingsJson: '[]',
            timingSource: null,
            status: 'alignment_review_required',
            failureCode: null,
            failureDetail: null,
            updatedAt: timestamp,
          })
          .where(eq(episodeDialogueTakes.id, take.id))
        await tx
          .update(episodeDialogueCues)
          .set({
            status: 'alignment_review_required',
            updatedAt: timestamp,
          })
          .where(eq(episodeDialogueCues.dialogueTakeId, take.id))
      })
      return {
        take_id: take.id,
        attempt_id: attempt.id,
        status: 'alignment_review_required',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'dialogue_take_generation_failed'
      const failureCode = message.includes('voice_profile_rejected')
        ? 'voice_profile_rejected'
        : message.includes('voice_language_unsupported')
          ? 'voice_language_unsupported'
        : message.includes('dialogue_audio_duration_unavailable')
          ? 'dialogue_audio_duration_unavailable'
          : 'tts_provider_failed'
      const timestamp = this.now()
      await this.databaseService.db.transaction(async (tx) => {
        await tx
          .update(episodeDialogueTakeAttempts)
          .set({
            status: 'failed',
            failureCode,
            failureDetail: message,
            completedAt: timestamp,
            updatedAt: timestamp,
          })
          .where(eq(episodeDialogueTakeAttempts.id, attempt.id))
        await tx
          .update(episodeDialogueTakes)
          .set({
            status: 'failed',
            failureCode,
            failureDetail: message,
            updatedAt: timestamp,
          })
          .where(eq(episodeDialogueTakes.id, take.id))
      })
      throw error
    }
  }

  async retryDialogueTakeTask(taskId: number) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.domainTable, 'episode_dialogue_takes')))
    if (!task) throw new NotFoundException('dialogue_take_task_not_found')
    const take = await this.requireOwnedTake(task.domainId)
    if (take.approvedAttemptId != null) {
      throw new ConflictException('dialogue_take_already_approved')
    }
    await this.databaseService.db
      .update(episodeDialogueTakes)
      .set({
        status: 'queued',
        failureCode: null,
        failureDetail: null,
        updatedAt: this.now(),
      })
      .where(eq(episodeDialogueTakes.id, take.id))
    return take
  }

  async cancelDialogueTakeTask(taskId: number, reason = 'Canceled by user') {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.domainTable, 'episode_dialogue_takes')))
    if (!task) return
    await this.markLatestActiveAttempt(
      task.domainId,
      'canceled',
      'canceled',
      reason,
    )
    await this.databaseService.db
      .update(episodeDialogueTakes)
      .set({
        status: 'canceled',
        failureCode: 'canceled',
        failureDetail: reason,
        updatedAt: this.now(),
      })
      .where(eq(episodeDialogueTakes.id, task.domainId))
  }

  async failDialogueTakeTask(taskId: number, error: unknown) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.domainTable, 'episode_dialogue_takes')))
    if (!task) return
    const message = error instanceof Error ? error.message : 'dialogue_take_generation_failed'
    const failureCode = message.includes('voice_profile_rejected')
      ? 'voice_profile_rejected'
      : message.includes('voice_language_unsupported')
        ? 'voice_language_unsupported'
      : 'tts_provider_failed'
    await this.markLatestActiveAttempt(
      task.domainId,
      'failed',
      failureCode,
      message,
    )
    await this.databaseService.db
      .update(episodeDialogueTakes)
      .set({
        status: 'failed',
        failureCode,
        failureDetail: message,
        updatedAt: this.now(),
      })
      .where(eq(episodeDialogueTakes.id, task.domainId))
  }

  async refreshDialogueTakeTask(taskId: number) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.domainTable, 'episode_dialogue_takes')))
    if (!task) return
    const take = await this.requireOwnedTake(task.domainId)
    const status = taskStatusFromTakeStatus(String(take.status || ''))
    await this.databaseService.db
      .update(tasks)
      .set({
        status,
        progress: status === 'completed' ? 100 : task.progress,
        resultSummaryJson:
          status === 'completed'
            ? JSON.stringify({
              audio_url: toPublicMediaUrl(take.audioUrl),
              take_status: take.status,
              duration_ms: take.durationMs,
            })
            : null,
        errorKind: status === 'failed' ? 'provider' : status === 'canceled' ? 'canceled' : null,
        errorMessage:
          status === 'failed' || status === 'canceled'
            ? take.failureDetail || 'Dialogue take failed'
            : null,
        completedAt: status === 'completed' || status === 'failed' || status === 'canceled'
          ? this.now()
          : null,
        updatedAt: this.now(),
        lockedBy: status === 'completed' || status === 'failed' || status === 'canceled' ? null : task.lockedBy,
        lockedAt: status === 'completed' || status === 'failed' || status === 'canceled' ? null : task.lockedAt,
        lockExpiresAt: status === 'completed' || status === 'failed' || status === 'canceled' ? null : task.lockExpiresAt,
      })
      .where(eq(tasks.id, task.id))
  }
}
