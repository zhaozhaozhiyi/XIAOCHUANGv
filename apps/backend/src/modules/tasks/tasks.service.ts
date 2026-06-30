import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, isNull } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../common/media-url'
import { DatabaseService } from '../../db/database.service'
import {
  imageGenerations,
  storyboards,
  taskLogs,
  tasks,
  videoGenerations,
  videoMerges,
} from '../../db/schema'
import { TaskQueueService } from '../queue/task-queue.service'
import type { TaskActionResponse } from './tasks.types'

type CurrentUser = {
  id: number
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function sanitizePayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) return null
  const cleanEntries = Object.entries(payload).filter(([, value]) => value !== undefined)
  if (!cleanEntries.length) return null
  return JSON.stringify(Object.fromEntries(cleanEntries))
}

function trimText(value: unknown, maxLength: number) {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length <= maxLength) return text
  if (maxLength <= 3) return text.slice(0, maxLength)
  return `${text.slice(0, maxLength - 3)}...`
}

function mapVideoGenerationStatus(status: string | null | undefined) {
  switch (String(status || '').trim().toLowerCase()) {
    case 'pending':
      return 'queued'
    case 'processing':
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'canceled':
    case 'cancelled':
      return 'canceled'
    default:
      return 'queued'
  }
}

function mapImageGenerationStatus(status: string | null | undefined) {
  switch (String(status || '').trim().toLowerCase()) {
    case 'pending':
      return 'queued'
    case 'processing':
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'canceled':
    case 'cancelled':
      return 'canceled'
    default:
      return 'queued'
  }
}

const MAX_RETRY_ATTEMPTS = 7

function inferErrorKind(message: string | null | undefined) {
  const text = String(message || '').toLowerCase()
  if (!text) return 'internal'
  if (text.includes('cancel')) return 'canceled'
  if (text.includes('moderat')) return 'moderation'
  if (text.includes('429') || text.includes('quota') || text.includes('rate limit') || text.includes('too many requests')) {
    return 'quota'
  }
  if (
    text.includes('timeout')
    || text.includes('timed out')
    || text.includes('network')
    || text.includes('fetch failed')
    || text.includes('econn')
    || text.includes('enotfound')
    || text.includes('socket')
  ) {
    return 'network'
  }
  if (text.includes('invalid') || text.includes('required') || text.includes('not found')) {
    return 'validation'
  }
  return 'provider'
}

@Injectable()
export class TasksService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(TaskQueueService) private readonly taskQueueService: TaskQueueService,
  ) {}

  private now() {
    return new Date()
  }

  async appendTaskLog(args: {
    taskId: number
    userId?: number
    level?: string
    message: string
    metadata?: Record<string, unknown>
  }) {
    await this.databaseService.db.insert(taskLogs).values({
      taskId: args.taskId,
      userId: args.userId ?? null,
      level: args.level ?? 'info',
      message: args.message,
      metadataJson: args.metadata ? JSON.stringify(args.metadata) : null,
      createdAt: this.now(),
    })
  }

  async listTaskLogs(taskId: number, limit = 50) {
    const [task] = await this.databaseService.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, taskId))

    if (!task) throw new NotFoundException('task_not_found')

    const rows = await this.databaseService.db
      .select()
      .from(taskLogs)
      .where(eq(taskLogs.taskId, taskId))
      .orderBy(desc(taskLogs.createdAt))
      .limit(limit)

    return rows.map((row) => ({
      ...row,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
      metadataJson: undefined,
    }))
  }

  async loadOwnedTask(taskId: number, userId: number) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))

    return task || null
  }

  private parseRetryPayload(task: typeof tasks.$inferSelect) {
    const raw = parseJsonValue(task.payloadJson)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw as Record<string, unknown>
  }

  private async syncTaskUpdate(taskId: number, values: Partial<typeof tasks.$inferInsert>) {
    await this.databaseService.db
      .update(tasks)
      .set({
        ...values,
        updatedAt: this.now(),
      })
      .where(eq(tasks.id, taskId))
  }

  private async retryImageGeneration(task: typeof tasks.$inferSelect, payload: Record<string, unknown>) {
    const [generation] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(
        and(
          eq(imageGenerations.id, task.domainId),
          eq(imageGenerations.userId, task.userId ?? 0),
        ),
      )

    if (!generation) {
      throw new NotFoundException('image_generation_not_found')
    }

    await this.databaseService.db
      .update(imageGenerations)
      .set({
        status: 'pending',
        taskId: null,
        errorMsg: null,
        completedAt: null,
        updatedAt: this.now(),
      })
      .where(eq(imageGenerations.id, generation.id))

    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      providerTaskId: null,
      attemptCount: (task.attemptCount ?? 0) + 1,
      payloadJson: sanitizePayload(payload) ?? task.payloadJson,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })

    return {
      task_id: task.id,
      image_generation_id: generation.id,
    }
  }

  private async retryVideoGeneration(task: typeof tasks.$inferSelect, payload: Record<string, unknown>) {
    const [generation] = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(
        and(
          eq(videoGenerations.id, task.domainId),
          eq(videoGenerations.userId, task.userId ?? 0),
          isNull(videoGenerations.deletedAt),
        ),
      )

    if (!generation) {
      throw new NotFoundException('video_generation_not_found')
    }

    await this.databaseService.db
      .update(videoGenerations)
      .set({
        status: 'pending',
        taskId: null,
        errorMsg: null,
        completedAt: null,
        updatedAt: this.now(),
      })
      .where(eq(videoGenerations.id, generation.id))

    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      providerTaskId: null,
      attemptCount: (task.attemptCount ?? 0) + 1,
      payloadJson: sanitizePayload(payload) ?? task.payloadJson,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })

    return {
      task_id: task.id,
      video_generation_id: generation.id,
    }
  }

  private async retryStoryboardTts(task: typeof tasks.$inferSelect, payload: Record<string, unknown>) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, task.domainId))

    if (!storyboard) {
      throw new NotFoundException('storyboard_not_found')
    }

    const text = String(payload.text || '').trim()
    if (!text) {
      throw new ConflictException('当前配音任务缺少可重试文本')
    }

    await this.databaseService.db
      .update(storyboards)
      .set({
        ttsAudioUrl: null,
        updatedAt: this.now(),
      })
      .where(eq(storyboards.id, storyboard.id))

    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      attemptCount: (task.attemptCount ?? 0) + 1,
      payloadJson: sanitizePayload(payload) ?? task.payloadJson,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })

    return {
      task_id: task.id,
      storyboard_id: storyboard.id,
      status: 'queued',
    }
  }

  private async retryStoryboardCompose(task: typeof tasks.$inferSelect, payload: Record<string, unknown>) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, task.domainId))

    if (!storyboard) {
      throw new NotFoundException('storyboard_not_found')
    }

    if (!storyboard.videoUrl) {
      throw new ConflictException('当前分镜缺少可合成视频')
    }

    await this.databaseService.db
      .update(storyboards)
      .set({
        status: 'compose_queued',
        composedVideoUrl: null,
        updatedAt: this.now(),
      })
      .where(eq(storyboards.id, storyboard.id))

    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      attemptCount: (task.attemptCount ?? 0) + 1,
      payloadJson: sanitizePayload(payload) ?? task.payloadJson,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })

    return {
      task_id: task.id,
      storyboard_id: storyboard.id,
      status: 'queued',
    }
  }

  private async retryVideoMerge(task: typeof tasks.$inferSelect, payload: Record<string, unknown>) {
    const [merge] = await this.databaseService.db
      .select()
      .from(videoMerges)
      .where(eq(videoMerges.id, task.domainId))

    if (!merge) {
      throw new NotFoundException('video_merge_not_found')
    }

    const videos = Array.isArray(parseJsonValue(merge.scenes))
      ? parseJsonValue(merge.scenes)
      : parseJsonValue(task.payloadJson)?.videos

    await this.databaseService.db
      .update(videoMerges)
      .set({
        status: 'pending',
        mergedUrl: null,
        duration: null,
        errorMsg: null,
        completedAt: null,
      })
      .where(eq(videoMerges.id, merge.id))

    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      attemptCount: (task.attemptCount ?? 0) + 1,
      payloadJson: sanitizePayload({
        ...payload,
        episode_id: merge.episodeId,
        drama_id: merge.dramaId,
        videos,
      }) ?? task.payloadJson,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })

    return {
      task_id: task.id,
      merge_id: merge.id,
    }
  }

  async retryTask(taskId: number, currentUser: CurrentUser) {
    const task = await this.loadOwnedTask(taskId, currentUser.id)
    if (!task) {
      throw new NotFoundException('task_not_found')
    }

    const payload = this.parseRetryPayload(task)
    if (!payload) {
      throw new ConflictException('当前任务缺少可重试参数')
    }

    if (!['failed', 'canceled'].includes(task.status)) {
      throw new ConflictException('当前任务状态不能重试')
    }

    if ((task.attemptCount ?? 0) >= MAX_RETRY_ATTEMPTS) {
      throw new ConflictException(`已达到最大重试次数(${MAX_RETRY_ATTEMPTS})，无法继续重试`)
    }

    await this.appendTaskLog({
      taskId: task.id,
      userId: currentUser.id,
      level: 'info',
      message: `用户手动重试任务 (attempt ${(task.attemptCount ?? 0) + 1})`,
      metadata: { domain_table: task.domainTable, domain_id: task.domainId },
    })

    let response: TaskActionResponse

    if (task.domainTable === 'image_generations') {
      response = await this.retryImageGeneration(task, payload)
    } else if (task.domainTable === 'video_generations') {
      response = await this.retryVideoGeneration(task, payload)
    } else if (task.domainTable === 'storyboard_tts') {
      response = await this.retryStoryboardTts(task, payload)
    } else if (task.domainTable === 'storyboard_compose') {
      response = await this.retryStoryboardCompose(task, payload)
    } else if (task.domainTable === 'video_merges') {
      response = await this.retryVideoMerge(task, payload)
    } else {
      throw new ConflictException('当前任务暂不支持重试')
    }

    await this.taskQueueService.enqueueTask(task.id, { replaceExisting: true })
    return response
  }

  async cancelTask(taskId: number, currentUser: CurrentUser) {
    const task = await this.loadOwnedTask(taskId, currentUser.id)
    if (!task) {
      throw new NotFoundException('task_not_found')
    }

    if (!['queued', 'running'].includes(task.status)) {
      throw new ConflictException('当前任务状态不能取消')
    }

    if (task.domainTable === 'image_generations') {
      const [generation] = await this.databaseService.db
        .select()
        .from(imageGenerations)
        .where(and(eq(imageGenerations.id, task.domainId), eq(imageGenerations.userId, currentUser.id)))

      if (!generation) {
        throw new NotFoundException('image_generation_not_found')
      }

      await this.databaseService.db
        .update(imageGenerations)
        .set({
          status: 'canceled',
          errorMsg: 'Canceled by user',
          completedAt: this.now(),
          updatedAt: this.now(),
        })
        .where(eq(imageGenerations.id, generation.id))

      await this.syncTaskUpdate(task.id, {
        status: 'canceled',
        progress: task.progress ?? 0,
        errorKind: 'canceled',
        errorMessage: 'Canceled by user',
        errorDetailsJson: JSON.stringify({
          error_kind: 'canceled',
          provider: generation.provider || null,
          provider_task_id: generation.taskId || null,
          raw_error: 'Canceled by user',
        }),
        completedAt: this.now(),
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })

      await this.taskQueueService.removeTask(task.id)
      return { canceled: true }
    }

    if (task.domainTable === 'video_generations') {
      const [generation] = await this.databaseService.db
        .select()
        .from(videoGenerations)
        .where(and(eq(videoGenerations.id, task.domainId), eq(videoGenerations.userId, currentUser.id), isNull(videoGenerations.deletedAt)))

      if (!generation) {
        throw new NotFoundException('video_generation_not_found')
      }

      await this.databaseService.db
        .update(videoGenerations)
        .set({
          status: 'canceled',
          errorMsg: 'Canceled by user',
          completedAt: this.now(),
          updatedAt: this.now(),
        })
        .where(eq(videoGenerations.id, generation.id))

      await this.syncTaskUpdate(task.id, {
        status: 'canceled',
        progress: task.progress ?? 0,
        errorKind: 'canceled',
        errorMessage: 'Canceled by user',
        errorDetailsJson: JSON.stringify({
          error_kind: 'canceled',
          provider: generation.provider || null,
          provider_task_id: generation.taskId || null,
          raw_error: 'Canceled by user',
        }),
        completedAt: this.now(),
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })

      await this.taskQueueService.removeTask(task.id)
      return { canceled: true }
    }

    if (task.domainTable === 'storyboard_tts') {
      await this.databaseService.db
        .update(storyboards)
        .set({
          updatedAt: this.now(),
        })
        .where(eq(storyboards.id, task.domainId))

      await this.syncTaskUpdate(task.id, {
        status: 'canceled',
        errorKind: 'canceled',
        errorMessage: 'Canceled by user',
        errorDetailsJson: JSON.stringify({
          error_kind: 'canceled',
          raw_error: 'Canceled by user',
        }),
        completedAt: this.now(),
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })

      await this.taskQueueService.removeTask(task.id)
      return { canceled: true }
    }

    if (task.domainTable === 'storyboard_compose') {
      await this.databaseService.db
        .update(storyboards)
        .set({
          status: 'compose_canceled',
          composedVideoUrl: null,
          updatedAt: this.now(),
        })
        .where(eq(storyboards.id, task.domainId))

      await this.syncTaskUpdate(task.id, {
        status: 'canceled',
        errorKind: 'canceled',
        errorMessage: 'Canceled by user',
        errorDetailsJson: JSON.stringify({
          error_kind: 'canceled',
          raw_error: 'Canceled by user',
        }),
        completedAt: this.now(),
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })

      await this.taskQueueService.removeTask(task.id)
      return { canceled: true }
    }

    if (task.domainTable === 'video_merges') {
      await this.databaseService.db
        .update(videoMerges)
        .set({
          status: 'canceled',
          errorMsg: 'Canceled by user',
          completedAt: this.now(),
        })
        .where(eq(videoMerges.id, task.domainId))

      await this.syncTaskUpdate(task.id, {
        status: 'canceled',
        errorKind: 'canceled',
        errorMessage: 'Canceled by user',
        errorDetailsJson: JSON.stringify({
          error_kind: 'canceled',
          raw_error: 'Canceled by user',
        }),
        completedAt: this.now(),
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })

      await this.taskQueueService.removeTask(task.id)
      return { canceled: true }
    }

    throw new ConflictException('当前任务暂不支持取消')
  }

  async refreshTaskPresentation(taskId: number) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))

    if (!task) return

    if (task.domainTable === 'image_generations') {
      const [generation] = await this.databaseService.db
        .select()
        .from(imageGenerations)
        .where(eq(imageGenerations.id, task.domainId))

      if (!generation) return

      const status = mapImageGenerationStatus(generation.status)
      const errorKind = status === 'failed'
        ? inferErrorKind(generation.errorMsg)
        : status === 'canceled'
          ? 'canceled'
          : null

      await this.syncTaskUpdate(task.id, {
        status,
        title: trimText(generation.prompt, 40) || task.title,
        progress: status === 'completed' ? 100 : status === 'queued' ? 0 : task.progress,
        providerTaskId: generation.taskId ?? null,
        resultSummaryJson: status === 'completed'
          ? JSON.stringify({
            image_url: toPublicMediaUrl(generation.imageUrl),
          })
          : null,
        errorKind,
        errorMessage:
          status === 'failed' || status === 'canceled'
            ? trimText(generation.errorMsg || (status === 'canceled' ? 'Task canceled' : 'Task failed'), 240)
            : null,
        errorDetailsJson: errorKind
          ? JSON.stringify({
            error_kind: errorKind,
            provider: generation.provider || null,
            provider_task_id: generation.taskId || null,
            raw_error: generation.errorMsg || null,
          })
          : null,
        completedAt: status === 'completed' || status === 'failed' || status === 'canceled'
          ? generation.completedAt || this.now()
          : null,
      })
      return
    }

    if (task.domainTable === 'video_generations') {
      const [generation] = await this.databaseService.db
        .select()
        .from(videoGenerations)
        .where(eq(videoGenerations.id, task.domainId))

      if (!generation) return

      const status = mapVideoGenerationStatus(generation.status)
      const errorKind = status === 'failed'
        ? inferErrorKind(generation.errorMsg)
        : status === 'canceled'
          ? 'canceled'
          : null

      await this.syncTaskUpdate(task.id, {
        status,
        title: trimText(generation.prompt, 40) || task.title,
        progress: status === 'completed' ? 100 : status === 'queued' ? 0 : task.progress,
        providerTaskId: generation.taskId ?? null,
        resultSummaryJson: status === 'completed'
          ? JSON.stringify({
            video_url: toPublicMediaUrl(generation.videoUrl),
            image_url: toPublicMediaUrl(generation.firstFrameUrl || generation.imageUrl),
          })
          : null,
        errorKind,
        errorMessage:
          status === 'failed' || status === 'canceled'
            ? trimText(generation.errorMsg || (status === 'canceled' ? 'Task canceled' : 'Task failed'), 240)
            : null,
        errorDetailsJson: errorKind
          ? JSON.stringify({
            error_kind: errorKind,
            provider: generation.provider || null,
            provider_task_id: generation.taskId || null,
            raw_error: generation.errorMsg || null,
          })
          : null,
        completedAt: status === 'completed' || status === 'failed' || status === 'canceled'
          ? generation.completedAt || this.now()
          : null,
      })
      return
    }

    if (task.domainTable === 'storyboard_compose' || task.domainTable === 'storyboard_tts') {
      const [storyboard] = await this.databaseService.db
        .select()
        .from(storyboards)
        .where(eq(storyboards.id, task.domainId))

      if (!storyboard) return

      if (task.domainTable === 'storyboard_compose') {
        const status = storyboard.status === 'compose_failed'
          ? 'failed'
          : storyboard.status === 'compose_canceled'
            ? 'canceled'
            : storyboard.composedVideoUrl
              ? 'completed'
              : storyboard.status === 'compose_processing'
                ? 'running'
                : 'queued'

        await this.syncTaskUpdate(task.id, {
          status,
          progress: status === 'completed' ? 100 : status === 'queued' ? 0 : task.progress,
          resultSummaryJson: status === 'completed'
            ? JSON.stringify({
              video_url: toPublicMediaUrl(storyboard.composedVideoUrl),
            })
            : null,
          errorKind: status === 'canceled' ? 'canceled' : task.errorKind,
          errorMessage: status === 'canceled' ? 'Canceled by user' : task.errorMessage,
          completedAt: status === 'completed' || status === 'failed' || status === 'canceled' ? this.now() : null,
        })
        return
      }

      const status = storyboard.ttsAudioUrl ? 'completed' : task.status
      await this.syncTaskUpdate(task.id, {
        status,
        progress: status === 'completed' ? 100 : task.progress,
        resultSummaryJson: status === 'completed'
          ? JSON.stringify({
            audio_url: toPublicMediaUrl(storyboard.ttsAudioUrl),
          })
          : null,
        completedAt: status === 'completed' ? this.now() : task.completedAt,
      })
      return
    }

    if (task.domainTable === 'video_merges') {
      const [merge] = await this.databaseService.db
        .select()
        .from(videoMerges)
        .where(eq(videoMerges.id, task.domainId))

      if (!merge) return

      const status = mapVideoGenerationStatus(merge.status)
      const errorKind = status === 'failed'
        ? inferErrorKind(merge.errorMsg)
        : status === 'canceled'
          ? 'canceled'
          : null

      await this.syncTaskUpdate(task.id, {
        status,
        progress: status === 'completed' ? 100 : status === 'queued' ? 0 : task.progress,
        providerTaskId: merge.taskId ?? null,
        resultSummaryJson: status === 'completed'
          ? JSON.stringify({
            video_url: toPublicMediaUrl(merge.mergedUrl),
          })
          : null,
        errorKind,
        errorMessage:
          status === 'failed' || status === 'canceled'
            ? trimText(merge.errorMsg || (status === 'canceled' ? 'Task canceled' : 'Task failed'), 240)
            : null,
        errorDetailsJson: errorKind
          ? JSON.stringify({
            error_kind: errorKind,
            provider: merge.provider || null,
            provider_task_id: merge.taskId || null,
            raw_error: merge.errorMsg || null,
          })
          : null,
        completedAt: status === 'completed' || status === 'failed' || status === 'canceled'
          ? merge.completedAt || this.now()
          : null,
      })
    }
  }
}
