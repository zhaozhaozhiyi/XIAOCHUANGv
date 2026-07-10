import { describe, expect, it, vi } from 'vitest'

import { VideosService } from './videos.service'

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
