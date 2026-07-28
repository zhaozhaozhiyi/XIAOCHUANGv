import { describe, expect, it, vi } from 'vitest'

import {
  canvasEdges,
  canvasNodes,
  characters,
  dramas,
  episodes,
  scenes,
  storyboards,
} from '../../db/schema'
import { DramaCanvasProjectionService } from './drama-canvas-projection.service'

type Row = Record<string, unknown>

function query(rows: Row[]) {
  const value: any = {
    where: vi.fn(() => value),
    orderBy: vi.fn(() => value),
    then: (resolve: (value: Row[]) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
  return value
}

describe('DramaCanvasProjectionService', () => {
  it('projects script-only episodes into visible storyboard nodes', async () => {
    const episode = {
      id: 15,
      userId: 7,
      dramaId: 282,
      episodeNumber: 3,
      title: '仇家找上门',
      scriptContent: '【场景：竹屋院子 日 外】\n少年推门而出。仇家持剑闯入，老人挡在门前。少年发现墙上的封剑令已经破裂。',
      content: '',
      deletedAt: null,
    }
    const insertedNodes: Row[] = []
    const rowsFor = (table: unknown) => {
      if (table === dramas) return [{ id: 282, userId: 7, title: '剑鞘里的梨花', deletedAt: null }]
      if (table === episodes) return [episode]
      if (table === characters || table === scenes || table === storyboards || table === canvasNodes || table === canvasEdges) return []
      return []
    }
    const db: any = {
      select: vi.fn(() => ({ from: vi.fn((table: unknown) => query(rowsFor(table))) })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Row[]) => {
          if (table === canvasNodes) insertedNodes.push(...values)
          return Promise.resolve()
        }),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
    }
    const canvasService = {
      requireOwnedCanvas: vi.fn(() => Promise.resolve({
        id: 'canvas_script_only',
        sourceDramaId: '282',
        sourceEpisodeId: '15',
        productionContextJson: JSON.stringify({ source: 'episode_projection' }),
      })),
    }
    const service = new DramaCanvasProjectionService({ db } as any, canvasService as any)

    const result = await service.syncEpisodeToCanvas(282, 7, 'canvas_script_only', {
      episodeId: 15,
      syncMode: 'append_missing',
    })

    const storyboardNodes = insertedNodes.filter((node) => node.nodeDefId === 'storyboard')
    expect(result.created_nodes).toBeGreaterThanOrEqual(3)
    expect(storyboardNodes).toHaveLength(3)
    expect(storyboardNodes.map((node) => JSON.parse(String(node.dataJson)))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'drama_projection',
          generatedFromScript: true,
          shotIndex: 1,
          shotDescription: expect.any(String),
        }),
      ]),
    )
    expect(insertedNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeDefId: 'scene', label: '竹屋院子' }),
    ]))
  })
})
