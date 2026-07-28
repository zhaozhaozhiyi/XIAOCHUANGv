import { describe, expect, it, vi } from 'vitest'

import { CanvasRunOrchestratorService } from '../execution/canvas-run-orchestrator.service'

function queryResult(result: any[]) {
  const promise = Promise.resolve(result)
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    for: vi.fn(() => promise),
    then: promise.then.bind(promise),
  }
  return chain
}

describe('CanvasRunOrchestratorService', () => {
  it('skips downstream stages when the completed stage contains a failed task', async () => {
    const failedTask = { id: 'task_video_1', runId: 'run_1', status: 'failed' }
    const completedTask = { id: 'task_video_2', runId: 'run_1', status: 'completed' }
    const skippedTask = { id: 'task_concat', runId: 'run_1', status: 'skipped' }
    const dbSelectResults = [
      [failedTask],
      [failedTask, completedTask],
      [{ id: 'run_1', status: 'running' }],
    ]
    let selectIndex = 0
    const updateSets: any[] = []
    const tx = {
      select: vi.fn()
        .mockImplementationOnce(() => queryResult([{ id: 'run_1', status: 'running' }]))
        .mockImplementationOnce(() => queryResult([failedTask, completedTask, skippedTask])),
      update: vi.fn(() => ({
        set: vi.fn((value: any) => {
          updateSets.push(value)
          return { where: vi.fn(() => Promise.resolve()) }
        }),
      })),
    }
    const db = {
      db: {
        select: vi.fn(() => queryResult(dbSelectResults[selectIndex++] ?? [])),
        update: vi.fn(() => ({
          set: vi.fn((value: any) => {
            updateSets.push(value)
            return { where: vi.fn(() => Promise.resolve()) }
          }),
        })),
        transaction: vi.fn(async (callback: any) => callback(tx)),
      },
    }
    const plan = {
      runId: 'run_1', canvasId: 'cnv_1', versionId: 'ver_1', totalNodes: 3,
      stages: [
        { order: 0, tasks: [
          { taskId: 'task_video_1', nodeId: 'video_1', nodeDefId: 'image-to-video', params: {}, dependsOn: [] },
          { taskId: 'task_video_2', nodeId: 'video_2', nodeDefId: 'image-to-video', params: {}, dependsOn: [] },
        ] },
        { order: 1, tasks: [
          { taskId: 'task_concat', nodeId: 'concat_1', nodeDefId: 'concat', params: {}, dependsOn: [] },
        ] },
      ],
    }
    const executionPlan = { rebuildPlan: vi.fn(() => Promise.resolve(plan)) }
    const queue = { enqueueCanvasTask: vi.fn() }
    const service = new CanvasRunOrchestratorService(
      db as any,
      executionPlan as any,
      queue as any,
      {} as any,
    )

    await service.onTaskSettled('task_video_1')

    expect(updateSets).toContainEqual(expect.objectContaining({ status: 'skipped' }))
    expect(queue.enqueueCanvasTask).not.toHaveBeenCalled()
  })
})
