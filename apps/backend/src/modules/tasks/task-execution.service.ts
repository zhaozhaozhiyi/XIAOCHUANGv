import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { imageGenerations, storyboards, taskLogs, tasks, videoGenerations, videoMerges } from '../../db/schema'
import { AudioService } from '../audio/audio.service'
import { ComposeService } from '../compose/compose.service'
import { ImagesService } from '../images/images.service'
import { MergeService } from '../merge/merge.service'
import { VideosService } from '../videos/videos.service'
import { TasksService } from './tasks.service'

const LOCK_TTL_MS = 10 * 60_000
const RESUME_MAX_AGE_MS = 12 * 60 * 60_000
const MAX_RETRY_ATTEMPTS = 7

function parsePayload(task: typeof tasks.$inferSelect): Record<string, unknown> {
  if (!task.payloadJson) return {}
  try {
    const parsed = JSON.parse(task.payloadJson)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isCanceledError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes('canceled')
}

function isTaskTooOldForResume(task: typeof tasks.$inferSelect) {
  const createdAt = task.createdAt instanceof Date ? task.createdAt.getTime() : Date.parse(String(task.createdAt || ''))
  if (!Number.isFinite(createdAt)) return true
  return Date.now() - createdAt > RESUME_MAX_AGE_MS
}

function isStaleRunningTask(task: typeof tasks.$inferSelect) {
  const updatedAt =
    task.updatedAt instanceof Date
      ? task.updatedAt.getTime()
      : Date.parse(String(task.updatedAt || task.startedAt || task.createdAt || ''))
  if (!Number.isFinite(updatedAt)) return true
  return Date.now() - updatedAt > 5 * 60_000
}

@Injectable()
export class TaskExecutionService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(TasksService) private readonly tasksService: TasksService,
    @Inject(ImagesService) private readonly imagesService: ImagesService,
    @Inject(VideosService) private readonly videosService: VideosService,
    @Inject(AudioService) private readonly audioService: AudioService,
    @Inject(ComposeService) private readonly composeService: ComposeService,
    @Inject(MergeService) private readonly mergeService: MergeService,
  ) {}

  private log(task: typeof tasks.$inferSelect, message: string, level = 'info', metadata?: Record<string, unknown>) {
    void this.databaseService.db.insert(taskLogs).values({
      taskId: task.id,
      userId: task.userId ?? null,
      level,
      message,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
      createdAt: this.now(),
    }).catch(() => undefined)
  }

  private now() {
    return new Date()
  }

  async listPendingTasks(limit: number) {
    return this.databaseService.db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.status, ['queued', 'running']), isNull(tasks.deletedAt)))
      .orderBy(tasks.updatedAt)
      .limit(limit)
  }

  async recoverPendingTasks(limit: number, dryRun: boolean, workerId: string) {
    const pendingTasks = await this.listPendingTasks(limit)
    let recovered = 0
    const failures: Array<{ id: number; error: string }> = []
    const pending: Array<{ id: number; status: string; domainTable: string; domainId: number }> = []

    for (const task of pendingTasks) {
      try {
        if (dryRun) {
          pending.push({
            id: task.id,
            status: task.status,
            domainTable: task.domainTable,
            domainId: task.domainId,
          })
          recovered += 1
          continue
        }

        const kind = await this.executeTask(task, workerId)
        if (kind !== 'unknown') recovered += 1
      } catch (error) {
        if (isCanceledError(error)) {
          await this.markTaskCanceled(task)
        } else {
          await this.markTaskFailed(task, error)
        }
        failures.push({
          id: task.id,
          error: error instanceof Error ? error.message : 'recover failed',
        })
      }
    }

    return {
      checked: pendingTasks.length,
      recovered,
      dryRun,
      pending,
      failures,
    }
  }

  async executeTaskById(taskId: number, workerId: string) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))

    if (!task || task.deletedAt) {
      return 'missing'
    }

    try {
      return await this.executeTask(task, workerId)
    } catch (error) {
      if (isCanceledError(error)) {
        await this.markTaskCanceled(task)
      } else {
        await this.markTaskFailed(task, error)
      }
      throw error
    }
  }

  private async refreshTaskLock(taskId: number, workerId: string) {
    const timestamp = this.now()
    await this.databaseService.db
      .update(tasks)
      .set({
        lockedBy: workerId,
        lockedAt: timestamp,
        lockExpiresAt: new Date(timestamp.getTime() + LOCK_TTL_MS),
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, taskId))
  }

  private async claimQueuedTask(task: typeof tasks.$inferSelect, workerId: string) {
    const timestamp = this.now()
    this.log(task, `任务开始执行 (worker: ${workerId})`, 'info', {
      worker_id: workerId,
      attempt: (task.attemptCount ?? 0) + 1,
    })
    const [claimed] = await this.databaseService.db
      .update(tasks)
      .set({
        status: 'running',
        attemptCount: (task.attemptCount ?? 0) + 1,
        lockedBy: workerId,
        lockedAt: timestamp,
        lockExpiresAt: new Date(timestamp.getTime() + LOCK_TTL_MS),
        startedAt: task.startedAt ?? timestamp,
        updatedAt: timestamp,
      })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, 'queued'), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id })

    return !!claimed
  }

  private canRecoverRunningTask(task: typeof tasks.$inferSelect, workerId: string) {
    if (!task.lockedBy) return true
    if (task.lockedBy === workerId) return true
    const expiresAt = task.lockExpiresAt instanceof Date ? task.lockExpiresAt.getTime() : Date.parse(String(task.lockExpiresAt || ''))
    return Number.isFinite(expiresAt) && expiresAt <= Date.now()
  }

  private async isTaskCanceled(taskId: number) {
    const [latest] = await this.databaseService.db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
    return latest?.status === 'canceled'
  }

  private async markTaskCanceled(task: typeof tasks.$inferSelect) {
    const timestamp = this.now()
    this.log(task, '任务被取消', 'warn', { domain_table: task.domainTable, domain_id: task.domainId })

    if (task.domainTable === 'image_generations') {
      await this.databaseService.db
        .update(imageGenerations)
        .set({ status: 'canceled', errorMsg: 'Canceled by worker', completedAt: timestamp, updatedAt: timestamp })
        .where(eq(imageGenerations.id, task.domainId))
      await this.tasksService.refreshTaskPresentation(task.id)
      return
    }

    if (task.domainTable === 'video_generations') {
      await this.databaseService.db
        .update(videoGenerations)
        .set({ status: 'canceled', errorMsg: 'Canceled by worker', completedAt: timestamp, updatedAt: timestamp })
        .where(eq(videoGenerations.id, task.domainId))
      await this.tasksService.refreshTaskPresentation(task.id)
      return
    }

    if (task.domainTable === 'storyboard_tts') {
      await this.databaseService.db
        .update(tasks)
        .set({
          status: 'canceled',
          errorKind: 'canceled',
          errorMessage: 'Canceled by worker',
          errorDetailsJson: JSON.stringify({
            error_kind: 'canceled',
            raw_error: 'Canceled by worker',
          }),
          completedAt: timestamp,
          updatedAt: timestamp,
          lockedBy: null,
          lockedAt: null,
          lockExpiresAt: null,
        })
        .where(eq(tasks.id, task.id))
      return
    }

    if (task.domainTable === 'storyboard_compose') {
      await this.databaseService.db
        .update(storyboards)
        .set({ status: 'compose_canceled', composedVideoUrl: null, updatedAt: timestamp })
        .where(eq(storyboards.id, task.domainId))
      await this.tasksService.refreshTaskPresentation(task.id)
      return
    }

    if (task.domainTable === 'video_merges') {
      await this.databaseService.db
        .update(videoMerges)
        .set({ status: 'canceled', errorMsg: 'Canceled by worker', completedAt: timestamp })
        .where(eq(videoMerges.id, task.domainId))
      await this.tasksService.refreshTaskPresentation(task.id)
    }
  }

  private async markTaskDeadLetter(task: typeof tasks.$inferSelect) {
    const timestamp = this.now()
    this.log(task, `任务已达最大重试次数(${MAX_RETRY_ATTEMPTS})，转为死信`, 'warn', {
      attempt_count: task.attemptCount ?? 0,
      max_attempts: MAX_RETRY_ATTEMPTS,
    })
    await this.databaseService.db
      .update(tasks)
      .set({
        status: 'dead_letter',
        errorKind: 'exhausted',
        errorMessage: `已达到最大重试次数(${MAX_RETRY_ATTEMPTS})，任务已转为死信`,
        errorDetailsJson: JSON.stringify({
          error_kind: 'exhausted',
          attempt_count: task.attemptCount ?? 0,
          max_attempts: MAX_RETRY_ATTEMPTS,
          raw_error: 'Retry limit exceeded',
        }),
        completedAt: timestamp,
        updatedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })
      .where(eq(tasks.id, task.id))
  }

  private async markTaskFailed(task: typeof tasks.$inferSelect, error: unknown) {
    const timestamp = this.now()
    const message = error instanceof Error ? error.message : 'recover failed'
    this.log(task, `任务失败: ${message}`, 'error', { domain_table: task.domainTable, domain_id: task.domainId, error: message })

    if (task.domainTable === 'image_generations') {
      await this.databaseService.db
        .update(imageGenerations)
        .set({ status: 'failed', errorMsg: message, completedAt: timestamp, updatedAt: timestamp })
        .where(eq(imageGenerations.id, task.domainId))
      await this.tasksService.refreshTaskPresentation(task.id)
      return
    }

    if (task.domainTable === 'video_generations') {
      await this.databaseService.db
        .update(videoGenerations)
        .set({ status: 'failed', errorMsg: message, completedAt: timestamp, updatedAt: timestamp })
        .where(eq(videoGenerations.id, task.domainId))
      await this.tasksService.refreshTaskPresentation(task.id)
      return
    }

    if (task.domainTable === 'storyboard_tts') {
      await this.databaseService.db
        .update(tasks)
        .set({
          status: 'failed',
          errorKind: 'provider',
          errorMessage: message,
          errorDetailsJson: JSON.stringify({
            error_kind: 'provider',
            raw_error: message,
          }),
          completedAt: timestamp,
          updatedAt: timestamp,
          lockedBy: null,
          lockedAt: null,
          lockExpiresAt: null,
        })
        .where(eq(tasks.id, task.id))
      return
    }

    if (task.domainTable === 'storyboard_compose') {
      await this.databaseService.db
        .update(storyboards)
        .set({ status: 'compose_failed', composedVideoUrl: null, updatedAt: timestamp })
        .where(eq(storyboards.id, task.domainId))
      await this.tasksService.refreshTaskPresentation(task.id)
      return
    }

    if (task.domainTable === 'video_merges') {
      await this.databaseService.db
        .update(videoMerges)
        .set({ status: 'failed', errorMsg: message, completedAt: timestamp })
        .where(eq(videoMerges.id, task.domainId))
      await this.tasksService.refreshTaskPresentation(task.id)
    }
  }

  private async executeTask(task: typeof tasks.$inferSelect, workerId: string) {
    if (task.status === 'queued') {
      if ((task.attemptCount ?? 0) >= MAX_RETRY_ATTEMPTS) {
        await this.markTaskDeadLetter(task)
        return 'dead_letter'
      }
      if (!(await this.claimQueuedTask(task, workerId))) return 'claimed_elsewhere'
    }
    if (task.status === 'running' && !this.canRecoverRunningTask(task, workerId)) return 'locked_elsewhere'
    if (task.status === 'running') await this.refreshTaskLock(task.id, workerId)

    if (task.domainTable === 'image_generations') {
      if (task.status === 'running' && isTaskTooOldForResume(task)) {
        throw new Error('Image task too old to resume — provider download URL likely expired')
      }
      if (task.status === 'queued') {
        await this.databaseService.db
          .update(imageGenerations)
          .set({ status: 'processing', updatedAt: this.now() })
          .where(eq(imageGenerations.id, task.domainId))
        await this.tasksService.refreshTaskPresentation(task.id)
        await this.imagesService.processImageGeneration(task.domainId, task.aiConfigId)
        return 'image_queued'
      }

      const resumed = await this.imagesService.resumeImageGeneration(task.domainId, task.aiConfigId)
      if (!resumed && !task.providerTaskId && isStaleRunningTask(task)) {
        throw new Error('Image task was running without provider task id; manual retry required to avoid duplicate submission')
      }
      return 'image'
    }

    if (task.domainTable === 'video_generations') {
      if (task.status === 'running' && isTaskTooOldForResume(task)) {
        throw new Error('Video task too old to resume — provider download URL likely expired')
      }
      if (task.status === 'queued') {
        await this.databaseService.db
          .update(videoGenerations)
          .set({ status: 'processing', updatedAt: this.now() })
          .where(eq(videoGenerations.id, task.domainId))
        await this.tasksService.refreshTaskPresentation(task.id)
        await this.videosService.processVideoGeneration(task.domainId, task.aiConfigId)
        return 'video_queued'
      }

      const resumed = await this.videosService.resumeVideoGeneration(task.domainId, task.aiConfigId)
      if (!resumed && !task.providerTaskId && isStaleRunningTask(task)) {
        throw new Error('Video task was running without provider task id; manual retry required to avoid duplicate submission')
      }
      return 'video'
    }

    if (task.domainTable === 'storyboard_tts') {
      const payload = parsePayload(task)
      const text = String(payload.text || '').trim()
      if (!text) throw new Error(`TTS task ${task.id} missing text payload`)

      await this.audioService.processStoryboardTtsTask(task.id)

      if (await this.isTaskCanceled(task.id)) {
        return 'storyboard_tts_canceled'
      }

      return 'storyboard_tts'
    }

    if (task.domainTable === 'storyboard_compose') {
      await this.composeService.composeStoryboard(task.domainId)
      return task.status === 'queued' ? 'storyboard_compose_queued' : 'storyboard_compose'
    }

    if (task.domainTable === 'video_merges') {
      await this.mergeService.processVideoMerge(task.domainId)
      return task.status === 'queued' ? 'video_merge_queued' : 'video_merge'
    }

    return 'unknown'
  }
}
