import { describe, expect, it, vi } from 'vitest'

import { ImagesTasksService } from './images.tasks'

function createQueuedSelect(rows: unknown[][]) {
  return vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows.shift() ?? [])),
    })),
  }))
}

describe('ImagesTasksService syncTaskForImageGeneration', () => {
  it('reuses a task created by a concurrent sync instead of inserting a duplicate', async () => {
    const timestamp = new Date('2026-07-05T07:30:00.000Z')
    const imageGeneration = {
      id: 1001,
      userId: 7,
      status: 'pending',
      prompt: 'scene image',
      imageUrl: null,
      width: null,
      height: null,
      dramaId: null,
      storyboardId: null,
      sceneId: null,
      characterId: null,
      provider: 'mock',
      taskId: 'provider_1001',
      errorMsg: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    }
    const conflictedTask = {
      id: 5001,
      userId: 7,
      aiConfigId: 12,
      startedAt: null,
      episodeId: null,
      payloadJson: JSON.stringify({ prompt: 'previous' }),
    }
    const returning = vi.fn(() => Promise.resolve([]))
    const onConflictDoNothing = vi.fn(() => ({ returning }))
    const insertValues = vi.fn(() => ({ onConflictDoNothing }))
    const updateSet = vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    }))
    const db = {
      select: createQueuedSelect([[imageGeneration], [], [conflictedTask]]),
      insert: vi.fn(() => ({
        values: insertValues,
      })),
      update: vi.fn(() => ({
        set: updateSet,
      })),
    }
    const assetsService = {
      ensureAssetFromTask: vi.fn(() => Promise.resolve()),
    }
    const service = new ImagesTasksService({ db } as any, assetsService as any)

    const result = await service.syncTaskForImageGeneration(imageGeneration.id)

    expect(result).toBe(conflictedTask.id)
    expect(onConflictDoNothing).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.any(Array),
      where: expect.any(Object),
    }))
    expect(returning).toHaveBeenCalled()
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      domainTable: 'image_generations',
      domainId: imageGeneration.id,
      aiConfigId: conflictedTask.aiConfigId,
      payloadJson: conflictedTask.payloadJson,
    }))
    expect(assetsService.ensureAssetFromTask).not.toHaveBeenCalled()
  })

  it('falls back to a normal insert when the active task unique index is not migrated yet', async () => {
    const timestamp = new Date('2026-07-05T07:45:00.000Z')
    const imageGeneration = {
      id: 1002,
      userId: 7,
      status: 'pending',
      prompt: 'cover image',
      imageUrl: null,
      width: null,
      height: null,
      dramaId: 215,
      storyboardId: null,
      sceneId: null,
      characterId: null,
      provider: 'minimax',
      taskId: null,
      errorMsg: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    }
    const missingIndexError = Object.assign(new Error('Failed query'), {
      cause: Object.assign(
        new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification'),
        { code: '42P10' },
      ),
    })
    const conflictReturning = vi.fn(() => Promise.reject(missingIndexError))
    const onConflictDoNothing = vi.fn(() => ({ returning: conflictReturning }))
    const fallbackReturning = vi.fn(() => Promise.resolve([{ id: 5002 }]))
    const insertValues = vi.fn()
      .mockReturnValueOnce({ onConflictDoNothing })
      .mockReturnValueOnce({ returning: fallbackReturning })
    const db = {
      select: createQueuedSelect([[imageGeneration], []]),
      insert: vi.fn(() => ({
        values: insertValues,
      })),
    }
    const assetsService = {
      ensureAssetFromTask: vi.fn(() => Promise.resolve()),
    }
    const service = new ImagesTasksService({ db } as any, assetsService as any)

    const result = await service.syncTaskForImageGeneration(imageGeneration.id, {
      aiConfigId: 12,
      payload: { drama_id: imageGeneration.dramaId, frame_type: 'drama_cover' },
    })

    expect(result).toBe(5002)
    expect(onConflictDoNothing).toHaveBeenCalled()
    expect(conflictReturning).toHaveBeenCalled()
    expect(fallbackReturning).toHaveBeenCalled()
    expect(insertValues).toHaveBeenLastCalledWith(expect.objectContaining({
      domainTable: 'image_generations',
      domainId: imageGeneration.id,
      dramaId: imageGeneration.dramaId,
      aiConfigId: 12,
    }))
  })
})
