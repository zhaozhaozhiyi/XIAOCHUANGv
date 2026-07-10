import { describe, expect, it, vi } from 'vitest'

import { TasksService } from './tasks.service'

function createSelectDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  }
}

describe('TasksService retryTask', () => {
  it('delegates retry without incrementing attemptCount before worker claim', async () => {
    const task = {
      id: 42,
      userId: 7,
      status: 'failed',
      attemptCount: 2,
      domainTable: 'image_generations',
      domainId: 1001,
      payloadJson: JSON.stringify({ prompt: 'try again' }),
      deletedAt: null,
    }
    const db = createSelectDb([task])
    const taskQueueService = {
      enqueueTask: vi.fn(() => Promise.resolve('job_42')),
    }
    const taskDomainRegistry = {
      retry: vi.fn(() => Promise.resolve({ task_id: task.id })),
    }
    const service = new TasksService({ db } as any, taskQueueService as any, taskDomainRegistry as any)

    const result = await service.retryTask(task.id, { id: task.userId })

    expect(result).toEqual({ task_id: task.id })
    expect(taskDomainRegistry.retry).toHaveBeenCalledWith(task, { prompt: 'try again' })
    expect(taskQueueService.enqueueTask).toHaveBeenCalledWith(task.id, { replaceExisting: true })
    expect(db.update).not.toHaveBeenCalled()
  })
})
