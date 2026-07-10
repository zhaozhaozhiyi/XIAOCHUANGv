import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { DefaultJobOptions, JobsOptions } from 'bullmq'

export const TASK_QUEUE_NAME = String(process.env.TASK_QUEUE_NAME || 'backend-tasks').trim() || 'backend-tasks'

export const TASK_QUEUE_JOB_ATTEMPTS = 3
export const TASK_QUEUE_JOB_BACKOFF_DELAY_MS = 10_000
export const TASK_QUEUE_KEEP_COMPLETED_COUNT = 1000
export const TASK_QUEUE_KEEP_FAILED_COUNT = 1000
export const TASK_QUEUE_KEEP_COMPLETED_AGE_SECONDS = 24 * 60 * 60
export const TASK_QUEUE_KEEP_FAILED_AGE_SECONDS = 7 * 24 * 60 * 60

export const TASK_QUEUE_DEFAULT_JOB_OPTIONS = {
  attempts: TASK_QUEUE_JOB_ATTEMPTS,
  backoff: {
    type: 'exponential',
    delay: TASK_QUEUE_JOB_BACKOFF_DELAY_MS,
    jitter: 0.2,
  },
  removeOnComplete: {
    age: TASK_QUEUE_KEEP_COMPLETED_AGE_SECONDS,
    count: TASK_QUEUE_KEEP_COMPLETED_COUNT,
  },
  removeOnFail: {
    age: TASK_QUEUE_KEEP_FAILED_AGE_SECONDS,
    count: TASK_QUEUE_KEEP_FAILED_COUNT,
  },
} satisfies DefaultJobOptions

export type TaskQueueJobData = {
  taskId: number
}

/** 画布执行任务（与 drama tasks 表解耦，走 canvas_tasks） */
export type CanvasQueueJobData = {
  canvasTaskId: string
  userId: number
}

export type BackendQueueJobData = TaskQueueJobData | CanvasQueueJobData

export function isCanvasQueueJob(data: BackendQueueJobData): data is CanvasQueueJobData {
  return typeof (data as CanvasQueueJobData).canvasTaskId === 'string'
}

export function buildTaskJobId(taskId: number) {
  return `task-${taskId}`
}

export function buildCanvasTaskJobId(canvasTaskId: string) {
  return `canvas-task-${canvasTaskId}`
}

export const CANVAS_TASK_JOB_NAME = 'execute-canvas-task'
export const DRAMA_TASK_JOB_NAME = 'execute-task'

export function buildTaskQueueJobOptions(jobId: string): JobsOptions {
  return {
    ...TASK_QUEUE_DEFAULT_JOB_OPTIONS,
    jobId,
  }
}

export function createTaskQueueConnection(redisUrl: string, role: 'producer' | 'worker' = 'producer') {
  return {
    url: redisUrl,
    // Worker 必须保持 null；API 入队侧需有限重试，避免 Redis 不可用时长时间挂起。
    maxRetriesPerRequest: role === 'worker' ? null : 3,
    connectTimeout: 5_000,
    enableReadyCheck: role === 'worker' ? false : true,
  }
}

export type TaskQueueLogLevel = 'info' | 'warn' | 'error'

export function redactRedisUrl(redisUrl: string) {
  try {
    const url = new URL(redisUrl)
    if (url.username) url.username = '***'
    if (url.password) url.password = '***'
    return url.toString()
  } catch {
    return redisUrl.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://***:***@')
  }
}

export function serializeQueueError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    }
  }

  return {
    name: typeof error,
    message: String(error),
  }
}

export function logTaskQueueEvent(level: TaskQueueLogLevel, payload: Record<string, unknown>) {
  const line = JSON.stringify({
    ...payload,
    at: new Date().toISOString(),
  })

  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export async function writeTaskQueueReadinessFile(filePath: string | undefined, payload: Record<string, unknown>) {
  if (!filePath) return

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    `${JSON.stringify({
      ...payload,
      at: new Date().toISOString(),
    })}\n`,
    'utf8',
  )
}
