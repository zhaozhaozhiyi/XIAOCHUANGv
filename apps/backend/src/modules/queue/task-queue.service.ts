import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import {
  buildCanvasTaskJobId,
  buildTaskJobId,
  CANVAS_TASK_JOB_NAME,
  createTaskQueueConnection,
  DRAMA_TASK_JOB_NAME,
  TASK_QUEUE_NAME,
  type CanvasQueueJobData,
} from './task-queue.shared'

@Injectable()
export class TaskQueueService implements OnApplicationShutdown {
  private queue: Queue<any, any, string> | null = null

  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

  private getRedisUrl() {
    return this.configService.get<string>('REDIS_URL', 'redis://127.0.0.1:6379')
  }

  private getQueue(): Queue<any, any, string> {
    if (this.queue) return this.queue

    this.queue = new Queue(TASK_QUEUE_NAME, {
      connection: createTaskQueueConnection(this.getRedisUrl(), 'producer'),
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    })

    return this.queue
  }

  async enqueueTask(taskId: number, options: { replaceExisting?: boolean } = {}) {
    const queue = this.getQueue()
    const jobId = buildTaskJobId(taskId)
    const existing = await queue.getJob(jobId)

    if (existing && options.replaceExisting) {
      await existing.remove().catch(() => undefined)
    } else if (existing) {
      return existing.id
    }

    const job = await queue.add(DRAMA_TASK_JOB_NAME, { taskId }, { jobId })
    return job.id
  }

  async enqueueCanvasTask(data: CanvasQueueJobData, options: { replaceExisting?: boolean } = {}) {
    const queue = this.getQueue()
    const jobId = buildCanvasTaskJobId(data.canvasTaskId)
    const existing = await queue.getJob(jobId)

    if (existing && options.replaceExisting) {
      await existing.remove().catch(() => undefined)
    } else if (existing) {
      return existing.id
    }

    const job = await queue.add(CANVAS_TASK_JOB_NAME, data, { jobId })
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
