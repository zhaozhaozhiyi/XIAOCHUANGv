import { describe, expect, it, vi } from 'vitest'

import { cosineSimilarity, keywordScore, localHashEmbedding } from './drama-story-graph-embedding.utils'
import { mergeWritingKnowledgeCards } from './drama-story-graph-writing-preseed'
import { DramaStoryGraphService } from './drama-story-graph.service'

describe('drama-story-graph-embedding.utils', () => {
  it('returns normalized vectors with stable length', () => {
    const vector = localHashEmbedding('陛下与太子在御书房对峙')
    expect(vector.length).toBeGreaterThan(0)
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    expect(norm).toBeCloseTo(1, 5)
  })

  it('scores closer semantic matches higher than unrelated text', () => {
    const query = localHashEmbedding('太子与陛下冲突')
    const close = localHashEmbedding('太子和陛下在御书房爆发冲突')
    const far = localHashEmbedding('城门外下着大雨')
    expect(cosineSimilarity(query, close)).toBeGreaterThan(cosineSimilarity(query, far))
  })

  it('boosts keyword overlap for short queries', () => {
    expect(keywordScore('太子', '太子与陛下在殿内争执')).toBeGreaterThan(0)
    expect(keywordScore('飞船', '太子与陛下在殿内争执')).toBe(0)
  })
})

describe('mergeWritingKnowledgeCards', () => {
  it('merges writing cards into extracted entities without dropping script entities', () => {
    const merged = mergeWritingKnowledgeCards({
      entities: [{
        entityType: 'character',
        canonicalName: '林夏',
        importance: 0.8,
      }],
      relations: [],
      events: [],
    }, [
      {
        id: 11,
        cardType: 'character',
        title: '顾沉',
        content: '冷面总裁，女主上司',
      },
      {
        id: 12,
        cardType: 'setting',
        title: '总裁办公室',
        content: '玻璃幕墙，夜景城市天际线',
      },
    ])

    expect(merged.entities).toHaveLength(3)
    expect(merged.entities.some((entity) => entity.canonicalName === '林夏')).toBe(true)
    expect(merged.entities.some((entity) => entity.canonicalName === '顾沉')).toBe(true)
    expect(merged.entities.some((entity) => entity.canonicalName === '总裁办公室' && entity.entityType === 'scene')).toBe(true)
  })
})

describe('DramaStoryGraphService extraction traces', () => {
  it('keeps episode evidence when a source-analysis character reappears in a script', () => {
    const service = new DramaStoryGraphService({} as any)
    const extracted = (service as any).extractFromScripts([{
      id: 1,
      episodeNumber: 1,
      scriptContent: [
        '【第1集 遗嘱被换】',
        '【场景：林家旧宅客厅 白天】',
        '林夏（攥紧遗嘱）：这份遗嘱被调包了。',
        '顾沉：我有监控录像。',
      ].join('\n'),
    }], {
      protagonist: '林夏',
      antagonist: '苏婉',
    })

    const linXia = extracted.entities.find((entity: { canonicalName: string }) =>
      entity.canonicalName === '林夏',
    )
    expect(linXia?.sourceTrace).toContainEqual({
      kind: 'script',
      episode_number: 1,
      field: 'cast',
    })
    expect(extracted.entities.some((entity: { entityType: string; canonicalName: string }) =>
      entity.entityType === 'scene' && entity.canonicalName === '林家旧宅客厅 白天',
    )).toBe(true)
  })
})

describe('DramaStoryGraphService task lifecycle', () => {
  it('moves a canceled graph back to a retryable building state', async () => {
    const setPayloads: Array<Record<string, unknown>> = []
    const drama = {
      id: 12,
      userId: 7,
      metadata: JSON.stringify({
        ai_first: {
          ai_first_stage: 'graph_building',
          story_graph_id: 24,
          story_graph_task_id: 36,
        },
      }),
    }
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([drama])),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((payload: Record<string, unknown>) => {
          setPayloads.push(payload)
          return {
            where: vi.fn(() => Promise.resolve()),
          }
        }),
      })),
    }
    const service = new DramaStoryGraphService({ db } as any)

    await service.cancelBuildTask({
      taskId: 36,
      graphId: 24,
      dramaId: 12,
      userId: 7,
    })
    await service.retryBuildTask({
      taskId: 36,
      graphId: 24,
      dramaId: 12,
      userId: 7,
    })

    expect(setPayloads[0]).toMatchObject({
      status: 'canceled',
      failureReason: 'Canceled by user',
    })
    expect(JSON.parse(String(setPayloads[1]?.metadata))).toMatchObject({
      ai_first: {
        ai_first_stage: 'script_ready',
        story_graph_id: 24,
        story_graph_task_id: 36,
        story_graph_task_status: 'canceled',
        story_graph_status: 'canceled',
      },
    })
    expect(setPayloads[2]).toMatchObject({
      status: 'building',
      failureReason: null,
      taskId: 36,
    })
    expect(JSON.parse(String(setPayloads[3]?.metadata))).toMatchObject({
      ai_first: {
        ai_first_stage: 'graph_building',
        story_graph_id: 24,
        story_graph_task_id: 36,
        story_graph_task_status: 'queued',
        story_graph_status: 'building',
      },
    })
  })
})
