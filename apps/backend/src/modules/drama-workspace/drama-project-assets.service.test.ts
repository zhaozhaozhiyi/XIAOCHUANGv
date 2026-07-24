import { describe, expect, it, vi } from 'vitest'

import { DramaProjectAssetsService, isProjectMediaKind } from './drama-project-assets.service'

describe('isProjectMediaKind', () => {
  it('accepts only image, video, and audio media', () => {
    expect(isProjectMediaKind('image')).toBe(true)
    expect(isProjectMediaKind('video')).toBe(true)
    expect(isProjectMediaKind('audio')).toBe(true)
  })

  it('rejects short-drama structure records and other unsupported values', () => {
    expect(isProjectMediaKind('character')).toBe(false)
    expect(isProjectMediaKind('scene')).toBe(false)
    expect(isProjectMediaKind('drama')).toBe(false)
    expect(isProjectMediaKind('document')).toBe(false)
    expect(isProjectMediaKind(null)).toBe(false)
    expect(isProjectMediaKind(undefined)).toBe(false)
  })
})

describe('DramaProjectAssetsService review actions', () => {
  it('confirms only the observed candidate version', async () => {
    const link = {
      id: 101,
      dramaId: 7,
      userId: 3,
      assetId: 44,
      reviewStatus: 'pending_confirmation',
      versionKey: 'v1',
      deletedAt: null,
      updatedAt: new Date('2026-07-13T00:00:00.000Z'),
    }
    const asset = {
      id: 44,
      kind: 'image',
      title: '角色候选图',
      url: '/storage/role.png',
      thumbnailUrl: null,
      metadataJson: '{}',
      createdAt: new Date('2026-07-13T00:00:00.000Z'),
      updatedAt: new Date('2026-07-13T00:00:00.000Z'),
    }
    const selectRows = [[{ id: 7 }], [link], [asset]]
    const updates: Array<Record<string, unknown>> = []
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(selectRows.shift() ?? [])),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updates.push(values)
          return {
            where: vi.fn(() => ({
              returning: vi.fn(() => Promise.resolve([{ ...link, ...values }])),
            })),
          }
        }),
      })),
    }
    const service = new DramaProjectAssetsService(
      { db } as any,
      {} as any,
    )

    const result = await service.confirmProjectAssetLink(7, 3, 101, 'v1')

    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ reviewStatus: 'confirmed', reviewedBy: 3 }),
    ]))
    expect(result).toMatchObject({ id: 101, review_status: 'confirmed' })
  })
})
