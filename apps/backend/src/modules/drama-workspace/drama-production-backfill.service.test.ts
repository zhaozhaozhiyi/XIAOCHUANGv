import { describe, expect, it, vi } from 'vitest'

import { DramaProductionBackfillService } from './drama-production-backfill.service'

type SelectQueue = unknown[][]

function createDbHarness(selectRows: SelectQueue) {
  const updates: Array<Record<string, unknown>> = []
  const inserts: Array<Record<string, unknown>> = []

  const makeSelectBuilder = () => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(selectRows.shift() ?? [])),
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectRows.shift() ?? [])),
      })),
    })),
  })

  const db: Record<string, unknown> = {
    select: vi.fn(() => makeSelectBuilder()),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values)
        return {
          where: vi.fn(() => Promise.resolve([])),
          returning: vi.fn(() => Promise.resolve([{ id: 7001 }])),
        }
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        inserts.push(values)
        return {
          returning: vi.fn(() => Promise.resolve([{ id: 8001 }])),
        }
      }),
    })),
  }

  db.transaction = vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db))

  return { db, updates, inserts }
}

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    userId: 7,
    type: 'image',
    status: 'completed',
    sourceType: 'drama_episode_image',
    dramaId: 231,
    episodeId: 41,
    storyboardId: 901,
    domainTable: 'image_generations',
    domainId: 3001,
    payloadJson: JSON.stringify({
      drama_workspace: true,
      target_type: 'storyboard',
      target_id: '901',
      target_field: 'first_frame',
      asset_role: 'first_frame',
      commit_policy: 'commit_if_empty',
    }),
    resultSummaryJson: JSON.stringify({ image_url: '/storage/shot.png' }),
    deletedAt: null,
    ...overrides,
  }
}

function createAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 601,
    userId: 7,
    kind: 'image',
    title: '镜头首帧',
    sourceType: 'drama_episode_image',
    dramaId: 231,
    episodeId: 41,
    storyboardId: 901,
    taskId: 501,
    url: '/storage/shot.png',
    thumbnailUrl: null,
    deletedAt: null,
    ...overrides,
  }
}

describe('DramaProductionBackfillService', () => {
  it('creates a reviewable candidate without writing the storyboard target', async () => {
    const asset = createAsset()
    const task = createTask()
    const harness = createDbHarness([
      [task],
      [],
    ])
    const service = new DramaProductionBackfillService(
      { db: harness.db } as any,
      { ensureAssetFromTask: vi.fn(() => Promise.resolve(asset)) } as any,
    )

    const result = await service.backfillTaskResult(501)

    expect(result).toMatchObject({ skipped: false, asset_id: 601, committed: false })
    expect(harness.updates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ firstFrameImage: '/storage/shot.png' }),
    ]))
    expect(harness.inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: 601,
        status: 'candidate',
        reviewStatus: 'pending_confirmation',
        qualityStatus: 'passed',
        targetType: 'storyboard',
        targetField: 'firstFrameImage',
        sourceTaskId: 501,
      }),
    ]))
  })

  it('does not inspect or overwrite an existing target while creating a candidate', async () => {
    const asset = createAsset()
    const task = createTask()
    const harness = createDbHarness([
      [task],
      [],
    ])
    const service = new DramaProductionBackfillService(
      { db: harness.db } as any,
      { ensureAssetFromTask: vi.fn(() => Promise.resolve(asset)) } as any,
    )

    const result = await service.backfillTaskResult(501)

    expect(result).toMatchObject({ skipped: false, asset_id: 601, committed: false })
    expect(harness.updates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ firstFrameImage: '/storage/shot.png' }),
    ]))
    expect(harness.inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: 601,
        status: 'candidate',
        previousAssetId: null,
      }),
    ]))
  })

  it('keeps a generated candidate when its target field is not currently supported', async () => {
    const asset = createAsset()
    const task = createTask({
      payloadJson: JSON.stringify({
        drama_workspace: true,
        target_type: 'storyboard',
        target_id: '901',
        target_field: 'unsupported_field',
        commit_policy: 'commit_if_empty',
      }),
    })
    const harness = createDbHarness([
      [task],
      [],
    ])
    const service = new DramaProductionBackfillService(
      { db: harness.db } as any,
      { ensureAssetFromTask: vi.fn(() => Promise.resolve(asset)) } as any,
    )

    await expect(service.backfillTaskResult(501)).resolves.toMatchObject({
      skipped: false,
      committed: false,
    })

    expect(harness.updates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'failed', errorKind: 'backfill_failed' }),
    ]))
    expect(harness.inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: 601,
        status: 'candidate',
        targetField: 'unsupported_field',
      }),
    ]))
  })
})
