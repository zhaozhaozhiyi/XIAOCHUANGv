import { describe, expect, it, vi } from 'vitest'

import { TaskExecutionService } from './task-execution.service'

describe('TaskExecutionService', () => {
  it('restores an idempotent source task to queued state before a BullMQ retry', async () => {
    const task = {
      id: 41,
      userId: 7,
      status: 'queued',
      attemptCount: 0,
      domainTable: 'drama_sources',
      domainId: 1000,
      deletedAt: null,
      startedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      payloadJson: JSON.stringify({ source_id: 1000 }),
    }
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([task])),
        })),
      })),
      insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([{ id: task.id }])),
          })),
        })),
      })),
    }
    const failure = new Error('provider timeout')
    const taskDomainRegistry = {
      execute: vi.fn(() => Promise.reject(failure)),
      prepareAutomaticRetry: vi.fn(() => Promise.resolve(true)),
      markFailed: vi.fn(),
      markCanceled: vi.fn(),
    }
    const service = new TaskExecutionService({ db } as any, taskDomainRegistry as any)

    await expect(service.executeTaskById(task.id, 'worker-test', {
      retryOnFailure: true,
    })).rejects.toThrow('provider timeout')

    expect(taskDomainRegistry.prepareAutomaticRetry).toHaveBeenCalledWith(task)
    expect(taskDomainRegistry.markFailed).not.toHaveBeenCalled()
  })

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

  it('releases the worker lock after handing a task to the asynchronous Agent runtime', async () => {
    const task = {
      id: 44,
      userId: 7,
      status: 'queued',
      attemptCount: 0,
      domainTable: 'drama_sources',
      domainId: 1003,
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
      execute: vi.fn(() => Promise.resolve('drama_source_analysis_agent_runtime')),
    }
    const service = new TaskExecutionService({ db } as any, taskDomainRegistry as any)

    const result = await service.executeTaskById(task.id, 'worker-test')

    expect(result).toBe('drama_source_analysis_agent_runtime')
    expect(taskDomainRegistry.execute).toHaveBeenCalledWith(task)
    expect(setPayloads).toHaveLength(2)
    expect(setPayloads[1]).toMatchObject({
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })
  })

  it('leaves a task alone while its remote Agent run is still active', async () => {
    const task = {
      id: 45,
      userId: 7,
      status: 'running',
      attemptCount: 1,
      domainTable: 'drama_sources',
      domainId: 1004,
      deletedAt: null,
      startedAt: new Date(),
      lockedBy: null,
      lockExpiresAt: null,
    }
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([task])),
            })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve()),
      })),
      update: vi.fn(),
    }
    const taskDomainRegistry = {
      execute: vi.fn(),
      markFailed: vi.fn(),
      markCanceled: vi.fn(),
    }
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      reconcileActive: vi.fn(() =>
        Promise.resolve({
          enabled: true,
          checked: 1,
          reconciled: 1,
          orphaned: 0,
          failures: [],
        }),
      ),
    }
    const agentExecutionService = {
      findLatestForTaskIds: vi.fn(() =>
        Promise.resolve([
          {
            id: 501,
            taskId: task.id,
            status: 'running',
            remoteRunId: 'run_501',
          },
        ]),
      ),
    }
    const service = new TaskExecutionService(
      { db } as any,
      taskDomainRegistry as any,
      agentRuntimeService as any,
      agentExecutionService as any,
    )

    const result = await service.recoverPendingTasks(20, false, 'recover-test')

    expect(result.recovered).toBe(0)
    expect(taskDomainRegistry.execute).not.toHaveBeenCalled()
    expect(taskDomainRegistry.markFailed).not.toHaveBeenCalled()
    expect(agentExecutionService.findLatestForTaskIds).toHaveBeenCalledWith([
      task.id,
    ])
  })

  it('fails a still-active business task when Hermes ended without committing the required product', async () => {
    const task = {
      id: 46,
      userId: 7,
      status: 'running',
      attemptCount: 1,
      domainTable: 'drama_episode_blueprints',
      domainId: 1005,
      deletedAt: null,
      startedAt: new Date(),
      lockedBy: null,
      lockExpiresAt: null,
    }
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([task])),
            })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve()),
      })),
      update: vi.fn(),
    }
    const taskDomainRegistry = {
      execute: vi.fn(),
      markFailed: vi.fn(() => Promise.resolve(true)),
      markCanceled: vi.fn(),
    }
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      reconcileActive: vi.fn(() =>
        Promise.resolve({
          enabled: true,
          checked: 1,
          reconciled: 1,
          orphaned: 0,
          failures: [],
        }),
      ),
    }
    const agentExecutionService = {
      findLatestForTaskIds: vi.fn(() =>
        Promise.resolve([
          {
            id: 502,
            taskId: task.id,
            status: 'completed',
            remoteRunId: 'run_502',
          },
        ]),
      ),
    }
    const service = new TaskExecutionService(
      { db } as any,
      taskDomainRegistry as any,
      agentRuntimeService as any,
      agentExecutionService as any,
    )

    const result = await service.recoverPendingTasks(20, false, 'recover-test')

    expect(result.recovered).toBe(1)
    expect(taskDomainRegistry.execute).not.toHaveBeenCalled()
    expect(taskDomainRegistry.markFailed).toHaveBeenCalledWith(
      task,
      expect.objectContaining({
        message: 'Agent 已结束，但未通过受控工具提交当前阶段所需产物',
      }),
    )
  })

  it('restarts an orphaned Agent attempt through the domain handler', async () => {
    const task = {
      id: 47,
      userId: 7,
      status: 'running',
      attemptCount: 1,
      domainTable: 'drama_episode_blueprints',
      domainId: 1006,
      deletedAt: null,
      startedAt: new Date(),
      lockedBy: null,
      lockExpiresAt: null,
    }
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([task])),
            })),
          })),
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
    const taskDomainRegistry = {
      execute: vi.fn(() => Promise.resolve('drama_episode_blueprints_agent_runtime')),
      markFailed: vi.fn(),
      markCanceled: vi.fn(),
    }
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      reconcileActive: vi.fn(() =>
        Promise.resolve({
          enabled: true,
          checked: 1,
          reconciled: 1,
          orphaned: 1,
          failures: [],
        }),
      ),
    }
    const agentExecutionService = {
      findLatestForTaskIds: vi.fn(() =>
        Promise.resolve([
          {
            id: 503,
            taskId: task.id,
            status: 'orphaned',
            remoteRunId: 'run_503',
          },
        ]),
      ),
    }
    const service = new TaskExecutionService(
      { db } as any,
      taskDomainRegistry as any,
      agentRuntimeService as any,
      agentExecutionService as any,
    )

    const result = await service.recoverPendingTasks(20, false, 'recover-test')

    expect(result.recovered).toBe(1)
    expect(taskDomainRegistry.execute).toHaveBeenCalledWith(task)
    expect(taskDomainRegistry.markFailed).not.toHaveBeenCalled()
  })
})
