import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VideosService } from './videos.service'

const { downloadFileMock } = vi.hoisted(() => ({
  downloadFileMock: vi.fn(async () => ({ url: 'stored://video.mp4', key: 'videos/k' })),
}))

vi.mock('../images/images.storage', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, downloadFile: downloadFileMock }
})

function createClaimService(opts: { claimReturns: unknown[] }) {
  const updateChain = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateChain),
    returning: vi.fn(() => Promise.resolve(opts.claimReturns)),
  }
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([{ id: 90, taskId: 'vidu_d', status: 'processing', storyboardId: null }])) })),
    })),
    update: vi.fn(() => updateChain),
  }
  const videosTasksService = { syncTaskForVideoGeneration: vi.fn(() => Promise.resolve()) }
  const service = new VideosService({ db } as any, {} as any, videosTasksService as any, {} as any, {} as any)
  return { service, db, videosTasksService }
}

describe('VideosService handleVideoComplete claim-before-download', () => {
  beforeEach(() => {
    downloadFileMock.mockClear()
  })

  it('claim 失败（已被另一并发调用认领）时不下载、不写终态', async () => {
    const { service, db, videosTasksService } = createClaimService({ claimReturns: [] })

    await (service as any).handleVideoComplete(90, 'https://example.com/v.mp4', null, null)

    expect(downloadFileMock).not.toHaveBeenCalled()
    expect(videosTasksService.syncTaskForVideoGeneration).not.toHaveBeenCalled()
    // claim 阶段只调用一次 update（RETURNING 返回空即返回，不进入 complete 写库）
    expect(db.update).toHaveBeenCalledTimes(1)
  })

  it('claim 成功时才下载并写 completed', async () => {
    const { service, videosTasksService } = createClaimService({ claimReturns: [{ id: 90, storyboardId: null }] })

    await (service as any).handleVideoComplete(90, 'https://example.com/v.mp4', null, null)

    expect(downloadFileMock).toHaveBeenCalledTimes(1)
    expect(videosTasksService.syncTaskForVideoGeneration).toHaveBeenCalledWith(90)
  })
})

function createTerminalWebhookService(status: string) {
  const record = {
    id: 88,
    taskId: 'vidu_terminal',
    status,
    duration: null,
    storyboardId: 99,
  }
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([record])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  }
  const videosTasksService = {
    syncTaskForVideoGeneration: vi.fn(() => Promise.resolve()),
  }
  const service = new VideosService(
    { db } as any,
    {} as any,
    videosTasksService as any,
    {} as any,
    {} as any,
  )

  return { service, db, videosTasksService }
}

describe('VideosService handleViduWebhook', () => {
  it.each(['completed', 'failed', 'canceled', 'cancelled'])(
    'does not reprocess terminal video generations with status %s',
    async (status) => {
      const { service, db, videosTasksService } = createTerminalWebhookService(status)

      const result = await service.handleViduWebhook({
        task_id: 'vidu_terminal',
        state: 'success',
        video_url: 'https://example.com/video.mp4',
      })

      expect(result).toEqual({ message: `Task already ${status}` })
      expect(db.update).not.toHaveBeenCalled()
      expect(videosTasksService.syncTaskForVideoGeneration).not.toHaveBeenCalled()
    },
  )
})
