import { describe, expect, it, vi } from 'vitest'

import { TaskExecutionService } from './task-execution.service'

describe('TaskExecutionService', () => {
  it('increments attemptCount only when a queued task is claimed for execution', async () => {
    const task = {
      id: 42,
      userId: 7,
      status: 'queued',
      attemptCount: 2,
      domainTable: 'image_generations',
      domainId: 1001,
      deletedAt: null,
      startedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
    }
    const setPayloads: Array<Record<string, unknown>> = []
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([task])),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve()),
      })),
      update: vi.fn(() => ({
        set: vi.fn((payload: Record<string, unknown>) => {
          setPayloads.push(payload)
          return {
            where: vi.fn(() => ({
              returning: vi.fn(() => Promise.resolve([{ id: task.id }])),
            })),
          }
        }),
      })),
    }
    const taskDomainRegistry = {
      execute: vi.fn(() => Promise.resolve('image_queued')),
    }
    const service = new TaskExecutionService({ db } as any, taskDomainRegistry as any)

    const result = await service.executeTaskById(task.id, 'worker-test')

    expect(result).toBe('image_queued')
    expect(setPayloads).toHaveLength(1)
    expect(setPayloads[0]).toMatchObject({
      status: 'running',
      attemptCount: 3,
      lockedBy: 'worker-test',
    })
    expect(taskDomainRegistry.execute).toHaveBeenCalledWith(task)
  })

  it('does not execute task records that are already terminal', async () => {
    const task = {
      id: 43,
      userId: 7,
      status: 'failed',
      attemptCount: 3,
      domainTable: 'image_generations',
      domainId: 1002,
      deletedAt: null,
    }
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([task])),
        })),
      })),
      update: vi.fn(),
    }
    const taskDomainRegistry = {
      execute: vi.fn(),
    }
    const service = new TaskExecutionService({ db } as any, taskDomainRegistry as any)

    const result = await service.executeTaskById(task.id, 'worker-test')

    expect(result).toBe('terminal:failed')
    expect(db.update).not.toHaveBeenCalled()
    expect(taskDomainRegistry.execute).not.toHaveBeenCalled()
  })
})
