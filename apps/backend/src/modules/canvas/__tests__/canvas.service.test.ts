import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { CanvasService } from '../canvas.service'

/**
 * Drizzle 链式调用 mock：返回 thenable 对象，await 时 resolve 为预设值
 */
function makeDrizzleMock(defaultResult: any = []) {
  const chain: any = {
    then: (resolve: any) => resolve(defaultResult),
  }
  chain.select = vi.fn(() => chain)
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.offset = vi.fn(() => chain)
  chain.insert = vi.fn(() => chain)
  chain.values = vi.fn(() => chain)
  chain.update = vi.fn(() => chain)
  chain.set = vi.fn(() => chain)
  chain.delete = vi.fn(() => chain)
  chain.returning = vi.fn(() => chain)
  chain.transaction = vi.fn()
  return chain
}

function createChain(result: any) {
  const chain: any = {
    then: (resolve: any) => resolve(result),
  }
  chain.select = vi.fn(() => chain)
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.offset = vi.fn(() => chain)
  chain.insert = vi.fn(() => chain)
  chain.values = vi.fn(() => chain)
  chain.update = vi.fn(() => chain)
  chain.set = vi.fn(() => chain)
  chain.delete = vi.fn(() => chain)
  chain.returning = vi.fn(() => chain)
  return chain
}

describe('CanvasService', () => {
  let service: CanvasService

  beforeEach(() => {
    // 基础 mock：所有查询返回 []
    const dbMock = { db: createChain([]) }
    service = new CanvasService(dbMock as any)
  })

  // ═══════════════════════════════════════════════
  it('requireOwnedCanvas: 存在且有权限时返回画布', async () => {
    const canvas = {
      id: 'cnv_1', userId: 1, title: 'test', source: 'blank',
      isPinned: false, sortOrder: 0,
      colorPaletteJson: '[]', compositeSettingsJson: '{}',
      currentVersionId: null, thumbnail: null,
      sourceDramaId: null, sourceEpisodeId: null,
      sourceDramaTitle: null, sourceDramaSnapshotAt: null,
      createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    }
    // replace service with one that returns [canvas] on select
    const dbMock = { db: createChain([canvas]) }
    service = new CanvasService(dbMock as any)

    const result = await service.requireOwnedCanvas('cnv_1', 1)
    expect(result.id).toBe('cnv_1')
  })

  it('requireOwnedCanvas: 不存在时抛 NotFoundException', async () => {
    await expect(service.requireOwnedCanvas('cnv_nonexistent', 1))
      .rejects.toThrow(NotFoundException)
  })

  // ═══════════════════════════════════════════════
  it('listCanvases: 返回 snake_case 格式的摘要列表', async () => {
    const now = new Date()
    const dbMock = { db: createChain([
      {
        id: 'cnv_1', userId: 1, title: '画布1', source: 'blank',
        isPinned: false, sortOrder: 0,
        colorPaletteJson: '[]', compositeSettingsJson: '{}',
        currentVersionId: null, thumbnail: null,
        sourceDramaId: null, sourceEpisodeId: null,
        sourceDramaTitle: null, sourceDramaSnapshotAt: null,
        createdAt: now, updatedAt: now, deletedAt: null,
      },
    ]) }
    service = new CanvasService(dbMock as any)

    const result = await service.listCanvases(1)

    expect(result.data).toHaveLength(1)
    expect(result.total).toBe(1)
    const c1 = result.data[0]
    expect(c1.id).toBe('cnv_1')
    expect(c1.is_pinned).toBe(false)
    expect(c1.created_at).toBeTruthy()
  })

  // ═══════════════════════════════════════════════
  it('createCanvas: 创建并返回 snake_case 摘要', async () => {
    const now = new Date()
    const dbMock = {
      db: {
        select: vi.fn(() => createChain([])),
        from: vi.fn(() => createChain([])),
        where: vi.fn(() => createChain([])),
        orderBy: vi.fn(() => createChain([])),

        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([{
              id: 'cnv_new', userId: 1, title: '我的画布', source: 'blank',
              isPinned: false, sortOrder: 0,
              colorPaletteJson: '[]', compositeSettingsJson: '{}',
              currentVersionId: null, thumbnail: null,
              sourceDramaId: null, sourceEpisodeId: null,
              sourceDramaTitle: null, sourceDramaSnapshotAt: null,
              createdAt: now, updatedAt: now, deletedAt: null,
            }])),
          })),
        })),

        update: vi.fn(() => ({
          set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
        })),

        delete: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      } as any,
    }
    service = new CanvasService(dbMock as any)

    const result = await service.createCanvas(1, '我的画布')
    expect(result.id).toMatch(/^cnv_/)
    expect(result.title).toBe('我的画布')
    expect(result.source).toBe('blank')
  })

  // ═══════════════════════════════════════════════
  it('deleteCanvas: 普通画布可删除', async () => {
    const now = new Date()
    const dbMock = {
      db: {
        select: vi.fn(() => createChain([{
          id: 'cnv_1', userId: 1, title: '普通画布', source: 'blank',
          isPinned: false, sortOrder: 0,
          colorPaletteJson: '[]', compositeSettingsJson: '{}',
          currentVersionId: null, thumbnail: null,
          sourceDramaId: null, sourceEpisodeId: null,
          sourceDramaTitle: null, sourceDramaSnapshotAt: null,
          createdAt: now, updatedAt: now, deletedAt: null,
        }])),
        from: vi.fn(() => createChain([])),
        where: vi.fn(() => createChain([])),
        update: vi.fn(() => ({
          set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
        })),
      } as any,
    }
    service = new CanvasService(dbMock as any)

    const result = await service.deleteCanvas('cnv_1', 1)
    expect(result.deleted_at).toBeTruthy()
  })

  // ═══════════════════════════════════════════════
  it('getCanvas: 返回 React Flow 格式（position, type, source/target）', async () => {
    const now = new Date()
    const dbMock = {
      db: {
        select: vi.fn(() => createChain([{
          id: 'cnv_1', userId: 1, title: 'test', source: 'blank',
          isPinned: false, sortOrder: 0,
          colorPaletteJson: '[]', compositeSettingsJson: '{}',
          currentVersionId: 'ver_1', thumbnail: null,
          sourceDramaId: null, sourceEpisodeId: null,
          sourceDramaTitle: null, sourceDramaSnapshotAt: null,
          createdAt: now, updatedAt: now, deletedAt: null,
        }])),
        from: vi.fn(() => createChain([])),
        where: vi.fn(() => createChain([])),
        orderBy: vi.fn(() => createChain([])),
      } as any,
    }
    service = new CanvasService(dbMock as any)

    const detail = await service.getCanvas('cnv_1', 1)

    // 基本字段
    expect(detail.id).toBe('cnv_1')
    expect(detail.nodes).toBeDefined()
    expect(detail.edges).toBeDefined()
    expect(detail.viewport).toBeDefined()
    expect(detail.current_version_id).toBe('ver_1')
  })
})
