export const TASK_QUEUE_NAME = String(process.env.TASK_QUEUE_NAME || 'backend-tasks').trim() || 'backend-tasks'

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

export function createTaskQueueConnection(redisUrl: string, role: 'producer' | 'worker' = 'producer') {
  return {
    url: redisUrl,
    // Worker 必须保持 null；API 入队侧需有限重试，避免 Redis 不可用时长时间挂起。
    maxRetriesPerRequest: role === 'worker' ? null : 3,
    connectTimeout: 5_000,
    enableReadyCheck: role === 'worker' ? false : true,
  }
}
