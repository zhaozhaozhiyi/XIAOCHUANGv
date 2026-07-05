import { beforeEach, describe, expect, it, vi } from 'vitest'

const queueMock = vi.hoisted(() => ({
  add: vi.fn(),
  close: vi.fn(),
  getJob: vi.fn(),
  Queue: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: queueMock.Queue,
  UnrecoverableError: class UnrecoverableError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'UnrecoverableError'
    }
  },
}))

import { TaskExecutionService } from '../tasks/task-execution.service'
import { TaskQueueService } from './task-queue.service'
import {
  buildTaskJobId,
  DRAMA_TASK_JOB_NAME,
  TASK_QUEUE_DEFAULT_JOB_OPTIONS,
  type BackendQueueJobData,
} from './task-queue.shared'
import { processBackendQueueJob } from './task-worker.processor'

function createMemoryTaskDb(task: Record<string, any>) {
  const logs: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []

  return {
    logs,
    updates,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([{ ...task }])),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((payload: Record<string, unknown>) => {
          logs.push(payload)
          return Promise.resolve()
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((payload: Record<string, unknown>) => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => {
              updates.push(payload)
              if (payload.status === 'running' && task.status === 'queued' && !task.deletedAt) {
                Object.assign(task, payload)
                return Promise.resolve([{ id: task.id }])
              }
              return Promise.resolve([])
            }),
          })),
        })),
      })),
    },
  }
}

describe('task queue worker integration', () => {
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

  it('carries a drama task from enqueue contract through worker execution to terminal state', async () => {
    const task = {
      id: 9001,
      userId: 7,
      type: 'image',
      status: 'queued',
      title: 'integration image',
      progress: 0,
      sourceType: 'storyboard',
      domainTable: 'image_generations',
      domainId: 1001,
      aiConfigId: 12,
      attemptCount: 0,
      deletedAt: null,
      startedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
      payloadJson: JSON.stringify({ prompt: 'main chain' }),
    }
    const memoryDb = createMemoryTaskDb(task)
    const taskDomainRegistry = {
      execute: vi.fn(async (taskRecord: typeof task) => {
        expect(taskRecord.status).toBe('queued')
        Object.assign(task, {
          status: 'completed',
          progress: 100,
          completedAt: new Date('2026-07-05T10:00:00.000Z'),
          lockedBy: null,
          lockedAt: null,
          lockExpiresAt: null,
          resultSummaryJson: JSON.stringify({ ok: true }),
        })
        return 'image_completed'
      }),
    }
    const taskExecutionService = new TaskExecutionService({ db: memoryDb.db } as any, taskDomainRegistry as any)
    const taskQueueService = new TaskQueueService({
      get: vi.fn(() => 'redis://integration.test:6379'),
    } as any)

    let enqueuedJob: {
      name: string
      data: BackendQueueJobData
      options: Record<string, unknown>
    } | null = null
    queueMock.getJob.mockResolvedValue(null)
    queueMock.add.mockImplementation(async (name, data, options) => {
      enqueuedJob = { name, data, options }
      return { id: options.jobId }
    })

    const jobId = await taskQueueService.enqueueTask(task.id)

    expect(jobId).toBe(buildTaskJobId(task.id))
    expect(enqueuedJob).toEqual({
      name: DRAMA_TASK_JOB_NAME,
      data: { taskId: task.id },
      options: {
        ...TASK_QUEUE_DEFAULT_JOB_OPTIONS,
        jobId: buildTaskJobId(task.id),
      },
    })

    const result = await processBackendQueueJob(
      {
        id: jobId,
        name: enqueuedJob!.name,
        data: enqueuedJob!.data,
        attemptsMade: 0,
        attemptsStarted: 0,
        opts: enqueuedJob!.options,
      } as any,
      {
        workerId: 'worker-integration',
        dramaExecutor: taskExecutionService,
        canvasExecutor: { executeCanvasTaskById: vi.fn() },
        canvasOrchestrator: { onTaskSettled: vi.fn() },
      },
    )

    expect(result).toBe('image_completed')
    expect(memoryDb.updates[0]).toMatchObject({
      status: 'running',
      attemptCount: 1,
      lockedBy: `${'worker-integration'}:${jobId}`,
    })
    expect(taskDomainRegistry.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: task.id,
      status: 'queued',
    }))
    expect(task).toMatchObject({
      status: 'completed',
      progress: 100,
      attemptCount: 1,
      lockedBy: null,
    })
    expect(memoryDb.logs).toHaveLength(1)
  })
})
