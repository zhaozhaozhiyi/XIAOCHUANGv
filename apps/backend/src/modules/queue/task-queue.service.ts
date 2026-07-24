import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import {
  buildCanvasTaskJobId,
  buildTaskJobId,
  buildTaskQueueJobOptions,
  CANVAS_TASK_JOB_NAME,
  createTaskQueueConnection,
  DRAMA_TASK_JOB_NAME,
  TASK_QUEUE_DEFAULT_JOB_OPTIONS,
  TASK_QUEUE_NAME,
  type CanvasQueueJobData,
} from './task-queue.shared'

const TERMINAL_REQUEUEABLE_STATES = new Set(['completed', 'failed'])

@Injectable()
export class TaskQueueService implements OnApplicationShutdown {
  private queue: Queue<any, any, string> | null = null

  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

  private getRedisUrl() {
    return this.configService.getOrThrow<string>('REDIS_URL')
  }

  private getQueue(): Queue<any, any, string> {
    if (this.queue) return this.queue

    this.queue = new Queue(TASK_QUEUE_NAME, {
      connection: createTaskQueueConnection(this.getRedisUrl(), 'producer'),
      defaultJobOptions: TASK_QUEUE_DEFAULT_JOB_OPTIONS,
    })

    return this.queue
  }

  private async removeIfRequeueable(
    existing: NonNullable<Awaited<ReturnType<Queue['getJob']>>>,
    replaceExisting: boolean,
  ) {
    if (!replaceExisting) {
      const state = await existing.getState().catch(() => null)
      if (!state || !TERMINAL_REQUEUEABLE_STATES.has(state)) return false
    }

    try {
      await existing.remove()
      return true
    } catch {
      return false
    }
  }

  async enqueueTask(taskId: number, options: { replaceExisting?: boolean } = {}) {
    const queue = this.getQueue()
    const jobId = buildTaskJobId(taskId)
    const existing = await queue.getJob(jobId)

    if (existing) {
      const removed = await this.removeIfRequeueable(existing, Boolean(options.replaceExisting))
      if (!removed) return existing.id
    }

    const job = await queue.add(DRAMA_TASK_JOB_NAME, { taskId }, buildTaskQueueJobOptions(jobId))
    return job.id
  }

  async enqueueCanvasTask(data: CanvasQueueJobData, options: { replaceExisting?: boolean } = {}) {
    const queue = this.getQueue()
    const jobId = buildCanvasTaskJobId(data.canvasTaskId)
    const existing = await queue.getJob(jobId)

    if (existing) {
      const removed = await this.removeIfRequeueable(existing, Boolean(options.replaceExisting))
      if (!removed) return existing.id
    }

    const job = await queue.add(CANVAS_TASK_JOB_NAME, data, buildTaskQueueJobOptions(jobId))
    return job.id
  }

  async removeCanvasTask(canvasTaskId: string) {
    const queue = this.getQueue()
    const job = await queue.getJob(buildCanvasTaskJobId(canvasTaskId))
    if (!job) return false

    try {
      await job.remove()
      return true
    } catch {
      return false
    }
  }

  async removeTask(taskId: number) {
    const queue = this.getQueue()
    const job = await queue.getJob(buildTaskJobId(taskId))
    if (!job) return false

    try {
      await job.remove()
      return true
    } catch {
      return false
    }
  }

  async onApplicationShutdown() {
    await this.queue?.close().catch(() => undefined)
    this.queue = null
  }
}
