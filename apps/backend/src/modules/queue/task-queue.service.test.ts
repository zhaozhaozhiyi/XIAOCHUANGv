import { beforeEach, describe, expect, it, vi } from 'vitest'

const queueMock = vi.hoisted(() => ({
  add: vi.fn(),
  close: vi.fn(),
  getJob: vi.fn(),
  Queue: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: queueMock.Queue,
}))

import { TaskQueueService } from './task-queue.service'
import {
  buildCanvasTaskJobId,
  buildTaskJobId,
  CANVAS_TASK_JOB_NAME,
  createTaskQueueConnection,
  DRAMA_TASK_JOB_NAME,
  TASK_QUEUE_DEFAULT_JOB_OPTIONS,
  TASK_QUEUE_NAME,
} from './task-queue.shared'

describe('TaskQueueService', () => {
  beforeEach(() => {
    queueMock.add.mockReset()
    queueMock.close.mockReset()
    queueMock.getJob.mockReset()
    queueMock.Queue.mockReset()
    queueMock.Queue.mockImplementation(() => ({
      add: queueMock.add,
      close: queueMock.close,
      getJob: queueMock.getJob,
    }))
  })

  it('enqueues drama tasks with retry/backoff and retention options', async () => {
    const redisUrl = 'redis://:secret@redis.local:6379'
    const service = new TaskQueueService({
      get: vi.fn(() => redisUrl),
    } as any)
    queueMock.getJob.mockResolvedValue(null)
    queueMock.add.mockResolvedValue({ id: buildTaskJobId(123) })

    const jobId = await service.enqueueTask(123)

    expect(jobId).toBe(buildTaskJobId(123))
    expect(queueMock.Queue).toHaveBeenCalledWith(TASK_QUEUE_NAME, {
      connection: createTaskQueueConnection(redisUrl, 'producer'),
      defaultJobOptions: TASK_QUEUE_DEFAULT_JOB_OPTIONS,
    })
    expect(queueMock.add).toHaveBeenCalledWith(
      DRAMA_TASK_JOB_NAME,
      { taskId: 123 },
      {
        ...TASK_QUEUE_DEFAULT_JOB_OPTIONS,
        jobId: buildTaskJobId(123),
      },
    )
  })

  it('enqueues canvas tasks with the same operational job options', async () => {
    const redisUrl = 'redis://127.0.0.1:6379'
    const service = new TaskQueueService({
      get: vi.fn(() => redisUrl),
    } as any)
    const data = { canvasTaskId: 'canvas-task-1', userId: 7 }
    queueMock.getJob.mockResolvedValue(null)
    queueMock.add.mockResolvedValue({ id: buildCanvasTaskJobId(data.canvasTaskId) })

    const jobId = await service.enqueueCanvasTask(data)

    expect(jobId).toBe(buildCanvasTaskJobId(data.canvasTaskId))
    expect(queueMock.add).toHaveBeenCalledWith(
      CANVAS_TASK_JOB_NAME,
      data,
      {
        ...TASK_QUEUE_DEFAULT_JOB_OPTIONS,
        jobId: buildCanvasTaskJobId(data.canvasTaskId),
      },
    )
  })
})
