import { describe, expect, it, vi } from 'vitest'

import { TasksController } from './tasks.controller'

function createWhereOnlyQuery(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  }
}

function createPagedQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    offset: vi.fn(() => Promise.resolve(rows)),
  }
  return query
}

describe('TasksController listTasks', () => {
  it('pushes count, sorting, limit, and offset into the database query', async () => {
    const task = {
      id: 42,
      userId: 7,
      type: 'image',
      status: 'queued',
      title: 'Opening shot',
      progress: 0,
      sourceType: 'drama_episode_image',
      dramaId: 10,
      episodeId: 20,
      storyboardId: null,
      aiConfigId: null,
      domainTable: 'image_generations',
      domainId: 1001,
      providerTaskId: null,
      attemptCount: 0,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
      payloadJson: JSON.stringify({ prompt: 'Opening shot' }),
      resultSummaryJson: null,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      createdAt: new Date('2026-07-05T07:00:00.000Z'),
      updatedAt: new Date('2026-07-05T07:30:00.000Z'),
      startedAt: null,
      completedAt: null,
      deletedAt: null,
    }
    const pagedQuery = createPagedQuery([task])
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(createWhereOnlyQuery([{ total: 21 }]))
        .mockReturnValueOnce(pagedQuery),
    }
    const controller = new TasksController({ db } as any, {} as any, {} as any)

    const result = await controller.listTasks({
      page: '3',
      page_size: '10',
      status: 'queued,running',
      type: 'image',
      source_type: 'drama_episode_image',
      drama_id: '10',
      episode_id: '20',
      q: 'Opening',
      sort: 'created_at',
      order: 'asc',
    }, { id: 7 } as any)

    expect(db.select).toHaveBeenCalledTimes(2)
    expect(pagedQuery.orderBy).toHaveBeenCalled()
    expect(pagedQuery.limit).toHaveBeenCalledWith(10)
    expect(pagedQuery.offset).toHaveBeenCalledWith(20)
    expect(result).toMatchObject({
      total: 21,
      page: 3,
      page_size: 10,
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].payload).toEqual({ prompt: 'Opening shot' })
  })
})
