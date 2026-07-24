import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { dramas, episodes, storyboards, tasks } from '../../db/schema'
import { AudioService } from '../audio/audio.service'
import { ImagesService } from '../images/images.service'
import { VideosService } from '../videos/videos.service'

type ShotTarget = 'first_frame' | 'voiceover' | 'video'
type SlotStatus = 'completed' | 'running' | 'failed' | 'missing'
type ShotAction = 'create' | 'skip' | 'blocked'

type ShotQuery = {
  episodeId?: number
  storyboardId?: number
  missing?: ShotTarget
  q?: string
  page: number
  pageSize: number
}

type BatchBody = {
  episodeId?: number
  storyboardIds?: number[]
  targets: ShotTarget[]
  replaceExisting: boolean
}

type ShotSlot = {
  target: ShotTarget
  status: SlotStatus
  asset_url: string | null
  task_id: number | null
  error_kind: string | null
  error_message: string | null
}

type ShotRow = {
  id: number
  drama_id: number
  episode_id: number
  episode_number: number
  episode_title: string
  storyboard_number: number
  title: string | null
  description: string | null
  dialogue: string | null
  image_prompt: string | null
  video_prompt: string | null
  first_frame: ShotSlot
  voiceover: ShotSlot
  video: ShotSlot
}

const ACTIVE_TASK_STATUSES = new Set(['queued', 'running'])
const FAILED_TASK_STATUSES = new Set(['failed', 'dead_letter', 'canceled'])
const TARGETS: ShotTarget[] = ['first_frame', 'voiceover', 'video']

function parsePositiveInt(value: unknown, code: string) {
  if (value == null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new BadRequestException(code)
  return parsed
}

function parseTarget(value: unknown): ShotTarget | null {
  const text = String(value || '').trim()
  if (text === 'first_frame' || text === 'voiceover' || text === 'video') return text
  return null
}

function parseTargets(value: unknown): ShotTarget[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? value.split(',')
      : TARGETS
  const targets = rawItems.map(parseTarget).filter((item): item is ShotTarget => item != null)
  if (!targets.length) throw new BadRequestException('invalid_shot_targets')
  return Array.from(new Set(targets))
}

function parseStoryboardIds(value: unknown) {
  if (value == null) return undefined
  if (!Array.isArray(value)) throw new BadRequestException('invalid_storyboard_ids')
  const ids = value.map((item) => parsePositiveInt(item, 'invalid_storyboard_id')).filter((item): item is number => item != null)
  return Array.from(new Set(ids))
}

function parseJsonObject(value: string | null | undefined) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function statusFromTask(task: typeof tasks.$inferSelect | null | undefined): SlotStatus | null {
  if (!task) return null
  if (ACTIVE_TASK_STATUSES.has(task.status)) return 'running'
  if (FAILED_TASK_STATUSES.has(task.status)) return 'failed'
  return null
}

function taskMatchesTarget(task: typeof tasks.$inferSelect, target: ShotTarget) {
  if (target === 'first_frame') {
    if (task.domainTable !== 'image_generations') return false
    const payload = parseJsonObject(task.payloadJson)
    return payload.target_field === 'firstFrameImage'
      || payload.target_field === 'first_frame'
      || payload.frame_type === 'first_frame'
      || task.sourceType === 'drama_episode_image'
  }
  if (target === 'voiceover') return task.domainTable === 'storyboard_tts'
  return task.domainTable === 'video_generations'
}

function latestTaskForTarget(taskRows: Array<typeof tasks.$inferSelect>, storyboardId: number, target: ShotTarget) {
  return taskRows
    .filter((task) => task.storyboardId === storyboardId && taskMatchesTarget(task, target))
    .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt))[0] ?? null
}

function slotFrom(args: {
  target: ShotTarget
  url: string | null
  task: typeof tasks.$inferSelect | null
}): ShotSlot {
  const taskStatus = statusFromTask(args.task)
  return {
    target: args.target,
    status: args.url ? 'completed' : taskStatus ?? 'missing',
    asset_url: args.url,
    task_id: args.task?.id ?? null,
    error_kind: args.task?.errorKind ?? null,
    error_message: args.task?.errorMessage ?? null,
  }
}

function hasVoiceoverSource(row: ShotRow) {
  return Boolean(String(row.dialogue || row.description || '').trim())
}

@Injectable()
export class DramaShotProductionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ImagesService) private readonly imagesService: ImagesService,
    @Inject(VideosService) private readonly videosService: VideosService,
    @Inject(AudioService) private readonly audioService: AudioService,
  ) {}

  private async requireOwnedDrama(dramaId: number, userId: number) {
    const [drama] = await this.db.db
      .select({ id: dramas.id })
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId), isNull(dramas.deletedAt)))
    if (!drama) throw new NotFoundException('drama_not_found')
  }

  private normalizeQuery(query: Record<string, unknown>): ShotQuery {
    return {
      episodeId: parsePositiveInt(query.episode_id, 'invalid_episode_id'),
      storyboardId: parsePositiveInt(query.storyboard_id, 'invalid_storyboard_id'),
      missing: parseTarget(query.missing) ?? undefined,
      q: typeof query.q === 'string' ? query.q.trim() || undefined : undefined,
      page: parsePositiveInt(query.page, 'invalid_page') ?? 1,
      pageSize: Math.min(parsePositiveInt(query.page_size, 'invalid_page_size') ?? 50, 200),
    }
  }

  normalizeBatchBody(body: Record<string, unknown>): BatchBody {
    return {
      episodeId: parsePositiveInt(body.episode_id, 'invalid_episode_id'),
      storyboardIds: parseStoryboardIds(body.storyboard_ids),
      targets: parseTargets(body.targets),
      replaceExisting: body.replace_existing === true,
    }
  }

  private async collectShots(dramaId: number, userId: number, query: ShotQuery) {
    await this.requireOwnedDrama(dramaId, userId)

    let episodeRows = await this.db.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.dramaId, dramaId), eq(episodes.userId, userId), isNull(episodes.deletedAt)))
      .orderBy(asc(episodes.episodeNumber))

    if (query.episodeId) episodeRows = episodeRows.filter((episode) => episode.id === query.episodeId)
    if (!episodeRows.length) return []

    const episodeIds = episodeRows.map((episode) => episode.id)
    const episodeById = new Map(episodeRows.map((episode) => [episode.id, episode]))
    let storyboardRows = await this.db.db
      .select()
      .from(storyboards)
      .where(and(inArray(storyboards.episodeId, episodeIds), eq(storyboards.userId, userId), isNull(storyboards.deletedAt)))
      .orderBy(asc(storyboards.episodeId), asc(storyboards.storyboardNumber))

    if (query.storyboardId) storyboardRows = storyboardRows.filter((storyboard) => storyboard.id === query.storyboardId)
    if (query.q) {
      const keyword = query.q.toLowerCase()
      storyboardRows = storyboardRows.filter((storyboard) => [
        storyboard.title,
        storyboard.description,
        storyboard.dialogue,
        storyboard.imagePrompt,
        storyboard.videoPrompt,
      ].some((value) => String(value || '').toLowerCase().includes(keyword)))
    }
    if (!storyboardRows.length) return []

    const taskRows = await this.db.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.dramaId, dramaId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))

    const rows = storyboardRows
      .map<ShotRow | null>((storyboard) => {
        const episode = episodeById.get(storyboard.episodeId)
        if (!episode) return null
        const firstFrameTask = latestTaskForTarget(taskRows, storyboard.id, 'first_frame')
        const voiceoverTask = latestTaskForTarget(taskRows, storyboard.id, 'voiceover')
        const videoTask = latestTaskForTarget(taskRows, storyboard.id, 'video')
        return {
          id: storyboard.id,
          drama_id: dramaId,
          episode_id: episode.id,
          episode_number: episode.episodeNumber,
          episode_title: episode.title,
          storyboard_number: storyboard.storyboardNumber,
          title: storyboard.title,
          description: storyboard.description,
          dialogue: storyboard.dialogue,
          image_prompt: storyboard.imagePrompt,
          video_prompt: storyboard.videoPrompt,
          first_frame: slotFrom({ target: 'first_frame', url: storyboard.firstFrameImage || storyboard.composedImage || null, task: firstFrameTask }),
          voiceover: slotFrom({ target: 'voiceover', url: storyboard.ttsAudioUrl ?? null, task: voiceoverTask }),
          video: slotFrom({ target: 'video', url: storyboard.videoUrl ?? null, task: videoTask }),
        }
      })
      .filter((row): row is ShotRow => row != null)

    if (!query.missing) return rows
    return rows.filter((row) => row[query.missing!].status !== 'completed')
  }

  async listShots(dramaId: number, userId: number, rawQuery: Record<string, unknown>) {
    const query = this.normalizeQuery(rawQuery)
    const rows = await this.collectShots(dramaId, userId, query)
    const total = rows.length
    const start = (query.page - 1) * query.pageSize
    return {
      items: rows.slice(start, start + query.pageSize),
      total,
      page: query.page,
      page_size: query.pageSize,
      summary: this.summarizeRows(rows),
    }
  }

  private summarizeRows(rows: ShotRow[]) {
    return {
      total: rows.length,
      first_frame_missing: rows.filter((row) => row.first_frame.status !== 'completed').length,
      voiceover_missing: rows.filter((row) => row.voiceover.status !== 'completed').length,
      video_missing: rows.filter((row) => row.video.status !== 'completed').length,
      running: rows.filter((row) => [row.first_frame, row.voiceover, row.video].some((slot) => slot.status === 'running')).length,
      failed: rows.filter((row) => [row.first_frame, row.voiceover, row.video].some((slot) => slot.status === 'failed')).length,
    }
  }

  private async buildPreviewRows(dramaId: number, userId: number, body: BatchBody) {
    const shots = await this.collectShots(dramaId, userId, {
      episodeId: body.episodeId,
      page: 1,
      pageSize: 1000,
    })
    const allowedIds = body.storyboardIds?.length ? new Set(body.storyboardIds) : null
    const scopedShots = allowedIds ? shots.filter((shot) => allowedIds.has(shot.id)) : shots

    return scopedShots.flatMap((shot) => body.targets.map((target) => {
      const slot = shot[target]
      const existing = slot.status === 'completed'
      const running = slot.status === 'running'
      const voiceoverBlocked = target === 'voiceover' && !hasVoiceoverSource(shot)
      const action: ShotAction = running
        ? 'skip'
        : voiceoverBlocked
          ? 'blocked'
          : existing && !body.replaceExisting
            ? 'skip'
            : 'create'
      return {
        storyboard_id: shot.id,
        episode_id: shot.episode_id,
        episode_number: shot.episode_number,
        storyboard_number: shot.storyboard_number,
        target,
        current_status: slot.status,
        action,
        reason: running
          ? 'task_running'
          : voiceoverBlocked
            ? 'voiceover_text_missing'
            : existing && !body.replaceExisting
              ? 'already_completed'
              : 'ready',
      }
    }))
  }

  async previewBatch(dramaId: number, userId: number, rawBody: Record<string, unknown>) {
    const body = this.normalizeBatchBody(rawBody)
    const items = await this.buildPreviewRows(dramaId, userId, body)
    return {
      items,
      summary: {
        create: items.filter((item) => item.action === 'create').length,
        skip: items.filter((item) => item.action === 'skip').length,
        blocked: items.filter((item) => item.action === 'blocked').length,
      },
    }
  }

  private workspacePayload(args: {
    groupId: string
    target: ShotTarget
    shot: { storyboard_id: number; episode_id: number }
    replaceExisting: boolean
  }) {
    const targetField = args.target === 'first_frame'
      ? 'firstFrameImage'
      : args.target === 'voiceover'
        ? 'ttsAudioUrl'
        : 'videoUrl'
    return {
      drama_workspace: true,
      task_group_id: args.groupId,
      target_type: 'storyboard',
      target_id: String(args.shot.storyboard_id),
      target_field: targetField,
      asset_role: args.target === 'first_frame' ? 'first_frame' : args.target === 'voiceover' ? 'voiceover' : 'shot_video',
      commit_policy: args.replaceExisting ? 'replace_confirmed' : 'commit_if_empty',
      replace_existing: args.replaceExisting,
    }
  }

  async batchGenerate(dramaId: number, userId: number, rawBody: Record<string, unknown>) {
    const body = this.normalizeBatchBody(rawBody)
    const previewItems = await this.buildPreviewRows(dramaId, userId, body)
    const createItems = previewItems.filter((item) => item.action === 'create')
    const taskGroupId = `grp_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const results = []

    for (const item of createItems) {
      const payload = this.workspacePayload({
        groupId: taskGroupId,
        target: item.target,
        shot: { storyboard_id: item.storyboard_id, episode_id: item.episode_id },
        replaceExisting: body.replaceExisting,
      })

      try {
        if (item.target === 'first_frame') {
          const params = await this.imagesService.buildImageRequest({
            drama_id: dramaId,
            episode_id: item.episode_id,
            storyboard_id: item.storyboard_id,
            frame_type: 'first_frame',
          }, userId)
          await this.imagesService.enqueueImageGeneration({
            ...params,
            taskPayload: { ...(params.taskPayload ?? {}), ...payload },
          })
        } else if (item.target === 'voiceover') {
          await this.audioService.generateStoryboardTts({
            userId,
            storyboardId: item.storyboard_id,
            taskPayloadExtra: payload,
          })
        } else {
          const params = await this.videosService.buildVideoRequest({
            drama_id: dramaId,
            storyboard_id: item.storyboard_id,
          }, userId)
          await this.videosService.enqueueVideoGeneration({
            ...params,
            taskPayload: { ...(params.taskPayload ?? {}), ...payload },
          })
        }

        results.push({ ...item, status: 'queued' })
      } catch (error) {
        results.push({
          ...item,
          status: 'failed_to_enqueue',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      task_group_id: taskGroupId,
      requested: previewItems.length,
      created: results.filter((item) => item.status === 'queued').length,
      skipped: previewItems.filter((item) => item.action === 'skip').length,
      blocked: previewItems.filter((item) => item.action === 'blocked').length,
      items: results,
    }
  }
}
