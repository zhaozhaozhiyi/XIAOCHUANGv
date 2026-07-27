import { describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'

import { AiConfigResolverService } from '../ai-configs/ai-configs.resolver'
import { DatabaseService } from '../../db/database.service'
import { DramaAgentSchemaValidator, DramaAgentService, RemoteDramaAgentAdapter } from './drama-agent.service'
import {
  DramaAiFirstService,
  buildEpisodeBlueprintBatchRanges,
  markEpisodeGenerationModeSourceStale,
  markEpisodeGenerationModeStale,
  resolveWholePlanBlueprintState,
} from './drama-ai-first.service'

function makeService() {
  return new DramaAiFirstService({} as DatabaseService)
}

function reliableSourceAnalysis(overrides: Record<string, unknown> = {}) {
  const sourceTrace = [{ source_id: 1, chapter_no: 1 }]
  return {
    adaptation_mode: 'faithful',
    source_completeness: 'complete',
    major_beat_count: 8,
    supported_duration_seconds: { min: 720, max: 1080 },
    recommended_episode_count: { min: 10, preferred: 12, max: 14 },
    episode_duration_seconds: { min: 60, max: 90 },
    target_episode_count: 12,
    episode_duration: 'ignored model display value',
    recommendation_confidence: 0.78,
    recommendation_basis: [{ claim: '八个主要情节点可支撑十至十四集', source_trace: sourceTrace }],
    expansion_notes: [],
    evidence: [{ claim: '第一章建立核心冲突', source_trace: sourceTrace }],
    ...overrides,
  }
}

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T
function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T>
function withEnv<T>(values: Record<string, string | undefined>, fn: () => T | Promise<T>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  try {
    const result = fn()
    if (result && typeof (result as Promise<T>).then === 'function') {
      return (result as Promise<T>).finally(restore)
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

describe('DramaAiFirstService source health', () => {
  it('blocks API envelope content', () => {
    const health = makeService().buildSourceHealth('{"code":0,"message":"ok","data":{"content":"not source"}}')

    expect(health.status).toBe('blocked')
    expect(health.anomalies?.some((item) => item.type === 'api_envelope')).toBe(true)
  })

  it('builds a chapter index from source headings', () => {
    const health = makeService().buildSourceHealth([
      '第一章 归来',
      '她推开门，看见旧宅灯火未灭。',
      '',
      '第二章 风暴',
      '雨声逼近，所有秘密都浮出水面。',
    ].join('\n'))

    expect(health.chapter_count).toBe(2)
    expect(health.chapter_index?.[0]?.title).toContain('第一章')
  })

  it('marks very long source as async long-source mode', () => {
    const longSource = `第一章 长夜\n${'她决定重新夺回命运。'.repeat(35_000)}`
    const health = makeService().buildSourceHealth(longSource)

    expect(health.over_context_limit).toBe(true)
    expect(health.recommended_mode).toBe('long_source_async')
    expect(health.chunk_count).toBeGreaterThan(1)
  })

  it('builds long-source chunks on chapter boundaries when chapters fit', () => {
    const service = makeService()
    const chapterBody = `${'林夏发现遗嘱被调包，顾沉递来证据，旧宅里的秘密被重新翻出。\n'.repeat(85)}`
    const source = Array.from({ length: 24 }, (_, index) => [
      `第${index + 1}章 线索${index + 1}`,
      chapterBody,
    ].join('\n')).join('\n\n')
    const health = service.buildSourceHealth(source)
    const chunks = service.buildSourceChunks(source, 77, health)

    expect(health.over_context_limit).toBe(true)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.length).toBe(health.chunk_count)
    expect(chunks.length).toBeLessThan(health.chapter_count)
    expect(chunks.every((chunk) => source.slice(chunk.contentStart, chunk.contentStart + 12).trimStart().startsWith('第'))).toBe(true)

    for (const chunk of chunks) {
      const trace = JSON.parse(chunk.sourceTrace) as Array<Record<string, unknown>>
      expect(chunk.estimatedTokens).toBeLessThanOrEqual(12_000)
      expect(trace[0]).toMatchObject({
        source_id: 77,
        chapter_no: expect.any(Number),
      })
    }
  })

  it('splits oversized chapters on readable boundaries and keeps chapter trace', () => {
    const service = makeService()
    const paragraph = '林夏在雨夜里反复核对证据，顾沉守在门外，旧宅灯火像一条逼近的线索。'.repeat(150)
    const firstChapter = Array.from({ length: 12 }, (_, index) => `${paragraph}${index}`).join('\n\n')
    const source = [
      '第一章 长夜',
      firstChapter,
      '',
      '第二章 破晓',
      '顾沉带来新的证词，林夏决定公开遗嘱真相。'.repeat(400),
    ].join('\n')
    const health = service.buildSourceHealth(source)
    const chunks = service.buildSourceChunks(source, 88, health)
    const firstChapterChunks = chunks.filter((chunk) => {
      const [trace] = JSON.parse(chunk.sourceTrace) as Array<Record<string, unknown>>
      return trace?.chapter_no === 1
    })

    expect(health.over_context_limit).toBe(true)
    expect(firstChapterChunks.length).toBeGreaterThan(1)
    expect(firstChapterChunks[0]?.title).toContain('第一章 长夜')
    for (const chunk of firstChapterChunks.slice(0, -1)) {
      const [trace] = JSON.parse(chunk.sourceTrace) as Array<Record<string, unknown>>
      expect(source[chunk.contentEnd]).toBe('\n')
      expect(trace).toMatchObject({
        source_id: 88,
        chapter_no: 1,
        chapter_title: '第一章 长夜',
      })
    }
  })

  it('creates selectable local-rule briefs and episode blueprints', () => {
    const service = makeService() as unknown as {
      buildSourceHealth(content: string): any
      buildLocalSourceAnalysis(input: any): any
      buildLocalAdaptationBriefs(input: any): any[]
      buildLocalEpisodeBlueprints(input: any): any[]
    }
    const source = [
      '第一章 归来',
      '林夏推开门，看见旧宅灯火未灭。顾沉站在窗前说真相还没结束。',
      '',
      '第二章 风暴',
      '林夏回到医院，顾沉递来证据，新的对手逼近。',
      '',
      '第三章 反转',
      '林夏决定夺回命运，所有秘密都浮出水面。',
    ].join('\n')
    const health = service.buildSourceHealth(source)
    const analysis = service.buildLocalSourceAnalysis({
      dramaTitle: '旧宅灯火',
      sourceId: 7,
      content: source,
      health,
      aiRunId: 101,
    })
    const briefs = service.buildLocalAdaptationBriefs({
      dramaTitle: '旧宅灯火',
      analysis,
      health,
      count: 2,
      aiRunId: 102,
      generatedAt: '2026-07-06T00:00:00.000Z',
    })
    const blueprints = service.buildLocalEpisodeBlueprints({
      sourceId: 7,
      health,
      analysis,
      brief: briefs[0],
      aiRunId: 103,
      generatedAt: '2026-07-06T00:00:00.000Z',
    })

    expect(briefs).toHaveLength(2)
    expect(briefs[0]?.generation_mode).toBe('local_rule_seed')
    expect(blueprints).toHaveLength(briefs[0]?.target_episode_count)
    expect(blueprints[0]?.source_trace?.[0]?.source_id).toBe(7)
    expect(blueprints[0]?.brief_id).toBe(briefs[0]?.id)
  })

  it('builds a pilot script from an episode blueprint', () => {
    const service = makeService() as unknown as {
      buildLocalPilotScript(blueprint: any, episodeNumber: number): string
    }
    const script = service.buildLocalPilotScript({
      episode_number: 1,
      title: '第1集：开局钩子',
      opening_hook: '女主发现遗嘱被人调包。',
      summary: '围绕旧宅争夺推进第一轮冲突。',
      ending_hook: '真正的继承人出现在门口。',
      characters: ['林夏', '顾沉'],
      scenes: ['旧宅客厅'],
    }, 1)

    expect(script).toContain('# 第1集：开局钩子')
    expect(script).toContain('场景：旧宅客厅')
    expect(script).toContain('出场：林夏、顾沉')
    expect(script).toContain('【开场钩子】女主发现遗嘱被人调包。')
    expect(script).toContain('本地规则执行器生成')
  })

  it('keeps the local-rule AI-first smoke chain source-to-pilot coherent', () => {
    const service = makeService() as unknown as {
      buildSourceHealth(content: string): any
      buildLocalSourceAnalysis(input: any): any
      buildLocalAdaptationBriefs(input: any): any[]
      buildLocalEpisodeBlueprints(input: any): any[]
      buildLocalPilotScript(blueprint: any, episodeNumber: number): string
    }
    const source = [
      '第一章 遗嘱',
      '林夏发现遗嘱被调包，顾沉递出证据，旧宅客厅里的所有人都沉默了。',
      '',
      '第二章 逼近',
      '对手逼近医院，林夏必须在公开真相和保护顾沉之间做选择。',
      '',
      '第三章 反击',
      '林夏决定夺回继承权，真正继承人在门口出现。',
    ].join('\n')
    const health = service.buildSourceHealth(source)
    const analysis = service.buildLocalSourceAnalysis({
      dramaTitle: '遗嘱风暴',
      sourceId: 88,
      content: source,
      health,
      aiRunId: 201,
    })
    const [selectedBrief] = service.buildLocalAdaptationBriefs({
      dramaTitle: '遗嘱风暴',
      analysis,
      health,
      count: 2,
      aiRunId: 202,
      generatedAt: '2026-07-06T00:00:00.000Z',
    })
    const [firstBlueprint] = service.buildLocalEpisodeBlueprints({
      sourceId: 88,
      health,
      analysis,
      brief: selectedBrief,
      aiRunId: 203,
      generatedAt: '2026-07-06T00:00:00.000Z',
    })
    const pilotScript = service.buildLocalPilotScript(firstBlueprint, firstBlueprint.episode_number)

    expect(health.status).not.toBe('blocked')
    expect(analysis.evidence[0]?.source_trace[0]?.source_id).toBe(88)
    expect(selectedBrief?.id).toBeTruthy()
    expect(firstBlueprint.brief_id).toBe(selectedBrief.id)
    expect(firstBlueprint.source_trace[0]?.source_id).toBe(88)
    expect(pilotScript).toContain(firstBlueprint.title)
    expect(pilotScript).toContain(firstBlueprint.opening_hook)
    expect(pilotScript).toContain(firstBlueprint.ending_hook)
  })

  it('marks existing episode generation modes stale after source content changes', () => {
    expect(markEpisodeGenerationModeSourceStale('remote_agent_script', true)).toBe('remote_agent_script_source_stale')
    expect(markEpisodeGenerationModeSourceStale('local_rule_blueprint', false)).toBe('local_rule_blueprint_source_stale')
    expect(markEpisodeGenerationModeSourceStale('remote_agent_script_source_stale', true)).toBe('remote_agent_script_source_stale')
    expect(markEpisodeGenerationModeSourceStale(null, true)).toBe('script_source_stale')
    expect(markEpisodeGenerationModeSourceStale(null, false)).toBe('blueprint_source_stale')
  })

  it('keeps stale generation modes bounded to the latest invalidation reason', () => {
    expect(markEpisodeGenerationModeStale('remote_agent_script_source_stale', true, 'strategy')).toBe('remote_agent_script_strategy_stale')
    expect(markEpisodeGenerationModeStale('local_rule_blueprint_strategy_stale', false, 'analysis')).toBe('local_rule_blueprint_analysis_stale')
    expect(markEpisodeGenerationModeStale('remote_agent_script', true, 'blueprint')).toBe('remote_agent_script_blueprint_stale')
    expect(markEpisodeGenerationModeStale('remote_agent_script_strategy_stale', true, 'strategy')).toBe('remote_agent_script_strategy_stale')
  })

  it('replaces a whole-plan blueprint without discarding existing script text', () => {
    const scripted = resolveWholePlanBlueprintState({
      scriptContent: '# 第1集\n旧剧本正文',
      generationMode: 'remote_agent_script_source_stale',
    } as any, 'remote_agent')
    const blueprintOnly = resolveWholePlanBlueprintState({
      scriptContent: null,
      generationMode: 'local_rule_blueprint',
    } as any, 'local_rule_seed')

    expect(scripted).toEqual({
      generationMode: 'remote_agent_script_blueprint_stale',
      status: 'script_ready',
    })
    expect(blueprintOnly).toEqual({
      generationMode: 'local_rule_blueprint',
      status: 'blueprint',
    })
  })
})

describe('episode blueprint batching', () => {
  it('splits a 24-episode plan into continuous four-episode ranges', () => {
    expect(buildEpisodeBlueprintBatchRanges(24, 4)).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 8 },
      { start: 9, end: 12 },
      { start: 13, end: 16 },
      { start: 17, end: 20 },
      { start: 21, end: 24 },
    ])
  })

  it('clamps oversized batches and keeps the final range bounded', () => {
    expect(buildEpisodeBlueprintBatchRanges(10, 99)).toEqual([
      { start: 1, end: 8 },
      { start: 9, end: 10 },
    ])
  })

  it('generates consecutive batches, carries continuity, and reports progress', async () => {
    const makeBlueprint = (episodeNumber: number) => ({
      episode_number: episodeNumber,
      title: `第${episodeNumber}集`,
      positioning: '推进主线',
      opening_hook: '冲突升级。',
      summary: '围绕核心冲突推进。',
      source_trace: [{ source_id: 7, chapter_no: 1 }],
      characters: ['林夏'],
      scenes: ['旧宅客厅'],
      ending_hook: '新的线索出现。',
      risk_notes: [],
      brief_id: 'brief-1',
    })
    const generateEpisodeBlueprints = vi.fn(async (input: {
      episodeStart: number
      episodeEnd: number
      previousBlueprint?: { episode_number: number } | null
    }) => ({
      blueprints: Array.from(
        { length: input.episodeEnd - input.episodeStart + 1 },
        (_, index) => makeBlueprint(input.episodeStart + index),
      ),
      remoteRunId: `run-${input.episodeStart}-${input.episodeEnd}`,
      usage: {},
      warnings: [],
    }))
    const inserted: Array<Record<string, unknown>> = []
    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          inserted.push(value)
          return Promise.resolve()
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
      })),
    }
    const databaseService = {
      db: {
        transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
      },
    }
    const service = new DramaAiFirstService(
      databaseService as unknown as DatabaseService,
      { generateEpisodeBlueprints } as unknown as DramaAgentService,
    ) as any
    const taskUpdates: Array<Record<string, unknown>> = []
    service.loadEpisodeBlueprintContext = vi.fn().mockResolvedValue({
      drama: { id: 10, totalEpisodes: 0, metadata: null },
      metadata: {},
      aiFirst: {},
      health: {},
      analysis: {},
      effectiveBrief: { id: 'brief-1', target_episode_count: 8 },
      existingEpisodes: [],
      sourceId: 7,
    })
    service.shouldUseRemoteAgent = vi.fn().mockResolvedValue(true)
    service.assertAiFirstTaskNotCanceled = vi.fn().mockResolvedValue(undefined)
    service.recordRemoteRun = vi.fn()
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 })
    service.updateEpisodeBlueprintsTask = vi.fn(async (_taskId: number, update: Record<string, unknown>) => {
      taskUpdates.push(update)
    })
    service.getAiFirst = vi.fn().mockResolvedValue({ ok: true })

    await withEnv({ DRAMA_AGENT_BLUEPRINT_BATCH_SIZE: '4' }, () =>
      service.generateEpisodeBlueprintsNow({ userId: 1, dramaId: 10, taskId: 99 }),
    )

    expect(generateEpisodeBlueprints).toHaveBeenCalledTimes(2)
    expect(generateEpisodeBlueprints.mock.calls[0]?.[0]).toMatchObject({
      episodeStart: 1,
      episodeEnd: 4,
      previousBlueprint: null,
    })
    expect(generateEpisodeBlueprints.mock.calls[1]?.[0]).toMatchObject({
      episodeStart: 5,
      episodeEnd: 8,
      previousBlueprint: { episode_number: 4 },
    })
    expect(taskUpdates.map((update) => {
      const summary = JSON.parse(String(update.resultSummaryJson || '{}'))
      return summary.generated_episodes
    }).filter(Boolean)).toEqual([4, 8])
    expect(inserted).toHaveLength(8)
  })
})

describe('RemoteDramaAgentAdapter capability detection', () => {
  function makeResolvedTextConfig() {
    return {
      id: 60,
      userId: 1,
      serviceType: 'text',
      provider: 'volcengine',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'test-key',
      model: 'doubao-seed',
      modelList: ['doubao-seed'],
      settings: {},
    }
  }

  it('accepts active text AI configs even when DRAMA_AGENT_PROVIDER is unset', async () => {
    const resolver = {
      resolveConfig: vi.fn().mockResolvedValue(makeResolvedTextConfig()),
    }
    const adapter = new RemoteDramaAgentAdapter(resolver as any)

    await withEnv({
      DRAMA_AGENT_PROVIDER: undefined,
      DRAMA_AGENT_BASE_URL: undefined,
      DRAMA_AGENT_API_KEY: undefined,
      DRAMA_AGENT_MODEL: undefined,
    }, async () => {
      await expect(adapter.canExecute(1)).resolves.toBe(true)
      expect(resolver.resolveConfig).toHaveBeenCalledWith('text', null, 1)
    })
  })

  it('leaves duration and completion length to the configured model service', async () => {
    const resolver = {
      resolveConfig: vi.fn().mockResolvedValue(makeResolvedTextConfig()),
    }
    const adapter = new RemoteDramaAgentAdapter(resolver as any)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        id: 'run-free-output',
        choices: [{ message: { content: '{"result":{"ok":true}}' } }],
      })),
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      await adapter.executeJson({
        userId: 1,
        taskType: 'episode_blueprint_generate',
        idempotencyKey: 'test-free-output',
        systemPrompt: 'system',
        userPrompt: 'user',
        outputSchemaName: 'EpisodeBlueprint[]',
      })

      const [, options] = fetchMock.mock.calls[0] || []
      const body = JSON.parse(String(options?.body || '{}'))
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      expect(body).not.toHaveProperty('max_tokens')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('retries transient provider failures with the same idempotency key', async () => {
    const resolver = {
      resolveConfig: vi.fn().mockResolvedValue(makeResolvedTextConfig()),
    }
    const adapter = new RemoteDramaAgentAdapter(resolver as any)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue('temporarily unavailable'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          id: 'run-after-retry',
          choices: [{ message: { content: '{"result":{"ok":true}}' } }],
        })),
      })
    vi.stubGlobal('fetch', fetchMock)

    try {
      await expect(adapter.executeJson({
        userId: 1,
        taskType: 'source_chunk_analyze',
        idempotencyKey: 'stable-retry-key',
        systemPrompt: 'system',
        userPrompt: 'user',
        outputSchemaName: 'SourceChunkAnalysis',
      })).resolves.toMatchObject({ remoteRunId: 'run-after-retry' })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[0]?.[1]?.headers['X-Idempotency-Key']).toBe('stable-retry-key')
      expect(fetchMock.mock.calls[1]?.[1]?.headers['X-Idempotency-Key']).toBe('stable-retry-key')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps a local request timeout without retrying it', async () => {
    const resolver = {
      resolveConfig: vi.fn().mockResolvedValue(makeResolvedTextConfig()),
    }
    const adapter = new RemoteDramaAgentAdapter(resolver as any)
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    const fetchMock = vi.fn().mockRejectedValue(timeout)
    vi.stubGlobal('fetch', fetchMock)

    try {
      await expect(adapter.executeJson({
        userId: 1,
        taskType: 'episode_blueprint_generate',
        idempotencyKey: 'timeout-once',
        systemPrompt: 'system',
        userPrompt: 'user',
        outputSchemaName: 'EpisodeBlueprint[]',
      })).rejects.toThrow(/remote_agent_timeout/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('wires adapter dependencies through Nest providers', async () => {
    const resolver = {
      resolveConfig: vi.fn().mockResolvedValue(makeResolvedTextConfig()),
    }
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: AiConfigResolverService, useValue: resolver },
        DramaAgentSchemaValidator,
        RemoteDramaAgentAdapter,
        DramaAgentService,
      ],
    }).compile()

    try {
      const service = moduleRef.get(DramaAgentService)
      await expect(service.canExecute(1)).resolves.toBe(true)
      expect(resolver.resolveConfig).toHaveBeenCalledWith('text', null, 1)
    } finally {
      await moduleRef.close()
    }
  })
})

describe('DramaAiFirstService AI-first gates', () => {
  it('keeps local-rule fallback as test/internal-only by default', () => {
    const service = makeService() as unknown as {
      shouldUseLocalRuleFallback(): boolean
    }

    withEnv({ NODE_ENV: 'test', DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK: undefined }, () => {
      expect(service.shouldUseLocalRuleFallback()).toBe(true)
    })
    withEnv({ NODE_ENV: 'production', DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK: undefined }, () => {
      expect(service.shouldUseLocalRuleFallback()).toBe(false)
    })
    withEnv({ NODE_ENV: 'development', DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK: '1' }, () => {
      expect(service.shouldUseLocalRuleFallback()).toBe(true)
    })
  })

  it('treats db-backed text AI capability as remote-agent available', async () => {
    const dramaAgentService = {
      canExecute: vi.fn().mockResolvedValue(true),
    }
    const service = new DramaAiFirstService(
      {} as DatabaseService,
      dramaAgentService as unknown as DramaAgentService,
    ) as unknown as {
      shouldUseRemoteAgent(userId: number): Promise<boolean>
    }

    await expect(service.shouldUseRemoteAgent(1)).resolves.toBe(true)
    expect(dramaAgentService.canExecute).toHaveBeenCalledWith(1)
  })

  it('honors an explicit disabled legacy remote provider even when a text config exists', async () => {
    const dramaAgentService = {
      canExecute: vi.fn().mockResolvedValue(true),
    }
    const service = new DramaAiFirstService(
      {} as DatabaseService,
      dramaAgentService as unknown as DramaAgentService,
    ) as unknown as {
      shouldUseRemoteAgent(userId: number): Promise<boolean>
    }

    await withEnv({ DRAMA_AGENT_PROVIDER: 'disabled' }, async () => {
      await expect(service.shouldUseRemoteAgent(1)).resolves.toBe(false)
    })
    expect(dramaAgentService.canExecute).not.toHaveBeenCalled()
  })

  it('wires DramaAiFirstService to DramaAgentService through Nest providers', async () => {
    const dramaAgentService = {
      canExecute: vi.fn().mockResolvedValue(true),
    }
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: DatabaseService, useValue: {} },
        { provide: DramaAgentService, useValue: dramaAgentService },
        DramaAiFirstService,
      ],
    }).compile()

    try {
      const service = moduleRef.get(DramaAiFirstService) as unknown as {
        shouldUseRemoteAgent(userId: number): Promise<boolean>
      }
      await expect(service.shouldUseRemoteAgent(1)).resolves.toBe(true)
      expect(dramaAgentService.canExecute).toHaveBeenCalledWith(1)
    } finally {
      await moduleRef.close()
    }
  })

  it('queues source analysis for direct sources so saving and understanding stay separate', async () => {
    const updates: Array<Record<string, unknown>> = []
    const insertedTasks: Array<Record<string, unknown>> = []
    const drama = {
      id: 8,
      userId: 2,
      title: '旧宅灯火',
      metadata: JSON.stringify({
        ai_first: {
          source_id: 11,
          source_health: {
            status: 'ok',
            word_count: 3009,
            chapter_count: 1,
            estimated_tokens: 4815,
            over_context_limit: false,
            chunk_count: 0,
            recommended_mode: 'direct',
          },
        },
      }),
      deletedAt: null,
    }
    const source = {
      id: 11,
      userId: 2,
      dramaId: 8,
      title: '旧宅灯火源稿',
      contentHash: 'hash-direct',
      content: '第一章 归来\n她推开门，看见旧宅灯火未灭。',
      deletedAt: null,
    }
    const task = {
      id: 101,
      status: 'queued',
      domainTable: 'drama_sources',
      domainId: 11,
    }
    let whereCall = 0
    const whereResults = [
      [drama],
      { limit: vi.fn(() => Promise.resolve([source])) },
      { limit: vi.fn(() => Promise.resolve([])) },
      [drama],
      { limit: vi.fn(() => Promise.resolve([source])) },
      { orderBy: vi.fn(() => Promise.resolve([])) },
      { limit: vi.fn(() => Promise.resolve([task])) },
      { limit: vi.fn(() => Promise.resolve([])) },
      { limit: vi.fn(() => Promise.resolve([])) },
      { limit: vi.fn(() => Promise.resolve([])) },
      { orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) },
      { orderBy: vi.fn(() => Promise.resolve([])) },
    ]
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            const result = whereResults[whereCall]
            whereCall += 1
            return result ?? { limit: vi.fn(() => Promise.resolve([])) }
          }),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((payload: Record<string, unknown>) => {
          insertedTasks.push(payload)
          return {
            returning: vi.fn(() => Promise.resolve([task])),
          }
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((payload: Record<string, unknown>) => {
          updates.push(payload)
          if (typeof payload.metadata === 'string') drama.metadata = payload.metadata
          return {
            where: vi.fn(() => Promise.resolve()),
          }
        }),
      })),
    }
    const taskQueueService = {
      enqueueTask: vi.fn(() => Promise.resolve('job-101')),
    }
    const dramaAgentService = {
      canExecute: vi.fn(() => Promise.resolve(true)),
    }
    const service = new DramaAiFirstService(
      { db } as unknown as DatabaseService,
      dramaAgentService as unknown as DramaAgentService,
      taskQueueService as any,
    )

    const payload = await service.analyzeSource({ userId: 2, dramaId: 8 })

    expect(insertedTasks[0]).toMatchObject({
      type: 'source_analysis',
      status: 'queued',
      domainTable: 'drama_sources',
      domainId: 11,
    })
    expect(taskQueueService.enqueueTask).toHaveBeenCalledWith(101)
    const queuedMetadata = updates
      .map((item) => typeof item.metadata === 'string' ? JSON.parse(item.metadata) : null)
      .find(Boolean)
    expect(queuedMetadata).toMatchObject({
      ai_first: {
        source_analysis_task_status: 'queued',
      },
    })
    expect(payload.source_analysis_task).toMatchObject({
      id: 101,
      status: 'queued',
    })
  })
})

describe('DramaAiFirstService pilot task recovery', () => {
  it('keeps canceled pilot script tasks canceled and rolls generating episodes back to blueprint', async () => {
    const setPayloads: Array<Record<string, unknown>> = []
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{
              id: 99,
              userId: 7,
              payloadJson: JSON.stringify({ episode_ids: [10, 11] }),
              resultSummaryJson: JSON.stringify({ phase: 'episode_script' }),
            }])),
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
    const service = new DramaAiFirstService({ db } as unknown as DatabaseService)

    await service.failPilotScriptsTask(99, new Error('canceled'))

    expect(setPayloads[0]).toMatchObject({
      status: 'blueprint',
      failureReason: 'Canceled by user',
    })
    expect(setPayloads[1]).toMatchObject({
      status: 'canceled',
      errorKind: 'canceled',
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })
    expect(JSON.parse(String(setPayloads[1]?.resultSummaryJson))).toMatchObject({
      phase: 'canceled',
    })
  })
})

describe('DramaAgentSchemaValidator', () => {
  const validator = new DramaAgentSchemaValidator()

  it('rejects unexplained single-value episode recommendations', () => {
    expect(() => validator.validateSourceAnalysis({
      source_analysis: {
        theme: '身份反转与复仇',
        core_conflict: '女主被夺走继承权后夺回真相。',
        protagonist: '林夏',
        protagonist_goal: '拿回继承权',
        target_episode_count: 24,
        episode_duration: '60-90 秒',
        evidence: [{ claim: '第一章出现遗嘱调包', source_trace: [{ source_id: 1, chapter_no: 1 }] }],
      },
    })).toThrow(/remote_agent_invalid_output/)
  })

  it('accepts structured remote agent outputs', () => {
    const chunk = validator.validateSourceChunkAnalysis({
      source_chunk_analysis: {
        summary: '林夏发现遗嘱被调包，顾沉提供关键线索。',
        key_events: ['遗嘱调包', '顾沉递出证据'],
        characters: ['林夏', '顾沉'],
        scenes: ['旧宅客厅'],
        source_trace: [{ source_id: 1, chunk_id: 2, chapter_no: 1 }],
      },
    })
    const analysis = validator.validateSourceAnalysis({
      source_analysis: reliableSourceAnalysis({
        theme: '身份反转与复仇',
        core_conflict: '女主被夺走继承权后夺回真相。',
        protagonist: '林夏',
        protagonist_goal: '拿回继承权',
        evidence: [{ claim: '第一章出现遗嘱调包', source_trace: [{ source_id: 1, chapter_no: 1 }] }],
      }),
    })
    const briefs = validator.validateAdaptationBriefs({
      adaptation_briefs: [
        {
          id: 'b1',
          name: '强钩子版',
          claim: '每集前 5 秒给出反转。',
          rhythm_model: '三集一反转',
          target_episode_count: 24,
          episode_duration: '60-90 秒',
          style_direction: '都市爽剧',
        },
        {
          id: 'b2',
          name: '情绪版',
          claim: '保留人物关系和情绪递进。',
          rhythm_model: '情绪递进',
          target_episode_count: 24,
          episode_duration: '60-90 秒',
          style_direction: '都市爽剧',
        },
      ],
    })
    const blueprints = validator.validateEpisodeBlueprints({
      episode_blueprints: [{
        episode_number: 1,
        title: '第1集：遗嘱调包',
        positioning: '试播关键集',
        opening_hook: '女主发现遗嘱被调包。',
        summary: '围绕遗嘱争夺推进第一轮冲突。',
        source_trace: [{ source_id: 1, chapter_no: 1 }],
        characters: ['林夏'],
        scenes: ['旧宅客厅'],
        ending_hook: '真正继承人出现。',
      }],
    })
    const script = validator.validateEpisodeScript({ script_content: '# 第1集\n场景：旧宅客厅' })

    expect(chunk.source_trace[0]?.chunk_id).toBe(2)
    expect(analysis.relationship_map).toEqual([])
    expect(analysis.target_episode_count).toBe(12)
    expect(analysis.episode_duration).toBe('60-90 秒')
    expect(analysis.recommended_episode_count).toEqual({ min: 10, preferred: 12, max: 14 })
    expect(briefs).toHaveLength(2)
    expect(blueprints[0]?.source_trace?.[0]?.chapter_no).toBe(1)
    expect(script).toContain('旧宅客厅')
  })

  it('bounds source chunk summaries before they enter global reduction', () => {
    const chunk = validator.validateSourceChunkAnalysis({
      source_chunk_analysis: {
        summary: '长'.repeat(5_000),
        key_events: Array.from({ length: 40 }, (_, index) => `事件${index}-${'细'.repeat(500)}`),
        characters: Array.from({ length: 80 }, (_, index) => `角色${index}`),
        scenes: Array.from({ length: 80 }, (_, index) => `场景${index}`),
        risks: Array.from({ length: 40 }, (_, index) => `风险${index}`),
        source_trace: Array.from({ length: 100 }, (_, index) => ({
          source_id: 1,
          chunk_id: index + 1,
          excerpt: '证'.repeat(1_000),
          ignored_payload: 'x'.repeat(5_000),
        })),
      },
    })

    expect(chunk.summary.length).toBeLessThanOrEqual(1_803)
    expect(chunk.key_events).toHaveLength(16)
    expect(chunk.characters).toHaveLength(40)
    expect(chunk.scenes).toHaveLength(32)
    expect(chunk.risks).toHaveLength(16)
    expect(chunk.source_trace).toHaveLength(64)
    expect(chunk.source_trace[0]).not.toHaveProperty('ignored_payload')
    expect(String(chunk.source_trace[0]?.excerpt).length).toBeLessThanOrEqual(303)
  })

  it('normalizes common nested source analysis output variants', () => {
    const analysis = validator.validateSourceAnalysis({
      source_analysis: reliableSourceAnalysis({
        analysis: {
          主题: '家族关系修复与代际和解',
          核心冲突: '主角想守住家庭真实情感，但家人长期误解彼此。',
          主角: '小陈',
          主角目标: '重新凝聚家庭',
          目标集数: '16集',
          单集时长: '45秒',
          人物关系: {
            father: { from: '小陈', to: '父亲', relation: '父子' },
          },
        },
        evidence: {
          family_scene: {
            claim: '家庭饭桌冲突反复出现',
            source_trace: [{ source_id: 1, chapter_no: 1 }],
          },
        },
        recommended_episode_count: { min: 14, preferred: 16, max: 18 },
        episode_duration_seconds: { min: 45, max: 45 },
        target_episode_count: 16,
      }),
    })

    expect(analysis.theme).toContain('家族关系')
    expect(analysis.core_conflict).toContain('误解')
    expect(analysis.target_episode_count).toBe(16)
    expect(analysis.episode_duration).toBe('45 秒')
    expect(analysis.relationship_map).toHaveLength(1)
    expect(analysis.evidence).toHaveLength(1)
    expect(analysis.evidence[0]?.source_trace[0]?.source_id).toBe(1)
  })

  it('normalizes string source traces into excerpt objects', () => {
    const analysis = validator.validateSourceAnalysis({
      source_analysis: reliableSourceAnalysis({
        theme: '家庭和解',
        core_conflict: '误会累积导致亲情撕裂。',
        protagonist: '小陈',
        protagonist_goal: '修复家庭关系',
        evidence: [{ claim: '饭桌冲突推动关系变化', source_trace: ['饭桌上众人沉默'] }],
      }),
    })

    expect(analysis.evidence[0]?.source_trace[0]).toMatchObject({ excerpt: '饭桌上众人沉默' })
  })

  it('normalizes common Chinese adaptation brief fields', () => {
    const briefs = validator.validateAdaptationBriefs({
      adaptation_strategies: [
        {
          策略名称: '亲情催泪版',
          核心主张: '以父子遗憾作为主线钩子。',
          节奏模型: '前3集建立亏欠，第4集反转',
          目标集数: '24集',
          单集时长: '90秒',
          风格方向: '现实亲情短剧',
          保留点: ['父亲等待儿子返乡'],
          风险提示: ['避免煽情过度'],
        },
        {
          策略名称: '返乡成长版',
          核心主张: '用返乡后的自我和解推动剧情。',
          节奏模型: '每5集一个故乡线索',
          目标集数: 18,
          单集时长: '60秒',
          风格方向: '温情现实主义',
        },
      ],
    })

    expect(briefs[0]).toMatchObject({
      id: 'brief_1',
      name: '亲情催泪版',
      target_episode_count: 24,
      style_direction: '现实亲情短剧',
    })
    expect(briefs[0]?.retained_points).toEqual(['父亲等待儿子返乡'])
    expect(briefs[1]?.production_cost).toBe('中')
  })

  it('normalizes AI-first failure samples with wrappers, arrays, and Chinese fields', () => {
    const analysis = validator.validateSourceAnalysis({
      result: {
        data: [{
          源稿分析: reliableSourceAnalysis({
            主题: '身份反转与继承权争夺',
            主要冲突: '林夏想夺回被调包的遗嘱，但家族对手不断制造伪证。',
            主人公: '林夏',
            人物目标: '公开真遗嘱并夺回继承权',
            人物关系: [{ from: '林夏', to: '顾沉', relation: '盟友' }],
            evidence: undefined,
          }),
          证据: [{ 结论: '第一章出现遗嘱调包', 来源: ['旧宅客厅里，遗嘱被调包的事实曝光。'] }],
        }],
      },
    })
    const briefs = validator.validateAdaptationBriefs({
      result: {
        data: {
          方案: [
            {
              方案名称: '强冲突版',
              策略主张: '把遗嘱调包作为前三集连续钩子。',
              节奏: '三集一反转',
              集数: '24集',
              时长: '60秒',
              风格: '都市爽剧',
              保留内容: '遗嘱调包',
              风险: '避免家族成员动机混乱',
            },
            {
              名称: '情绪反击版',
              简介: '以林夏被误解后的反击推动剧情。',
              叙事节奏: '每4集一个证据反转',
              目标集数: 18,
              单集时长: '90秒',
              风格方向: '情绪爽剧',
            },
          ],
        },
      },
    })
    const blueprints = validator.validateEpisodeBlueprints({
      data: {
        分集蓝图: [{
          第几集: '第1集',
          标题: '第1集：遗嘱调包',
          本集定位: '试播钩子',
          开篇钩子: '林夏发现遗嘱被人替换。',
          本集梗概: '旧宅客厅里，林夏和顾沉确认遗嘱调包的第一条证据。',
          来源: ['第一章旧宅客厅，遗嘱被调包。'],
          角色: '林夏',
          地点: '旧宅客厅',
          结尾悬念: '真正的遗嘱保管人出现在门口。',
        }],
      },
    })

    expect(analysis.theme).toContain('身份反转')
    expect(analysis.relationship_map).toHaveLength(1)
    expect(analysis.evidence[0]?.source_trace[0]).toMatchObject({ excerpt: '旧宅客厅里，遗嘱被调包的事实曝光。' })
    expect(briefs[0]).toMatchObject({
      id: 'brief_1',
      name: '强冲突版',
      target_episode_count: 24,
      hook_density: '中',
    })
    expect(briefs[0]?.retained_points).toEqual(['遗嘱调包'])
    expect(blueprints[0]).toMatchObject({
      episode_number: 1,
      title: '第1集：遗嘱调包',
      opening_hook: '林夏发现遗嘱被人替换。',
      characters: ['林夏'],
      scenes: ['旧宅客厅'],
    })
    expect(blueprints[0]?.source_trace[0]).toMatchObject({ excerpt: '第一章旧宅客厅，遗嘱被调包。' })
  })

  it('rejects empty remote brief output', () => {
    expect(() => validator.validateAdaptationBriefs({
      adaptation_briefs: [],
    })).toThrow(/remote_agent_invalid_output/)
  })

  it('rejects brief recommendations that omit episode count or duration', () => {
    expect(() => validator.validateAdaptationBriefs({
      adaptation_briefs: [
        {
          id: 'b1',
          name: '强钩子版',
          claim: '围绕主线冲突推进。',
          rhythm_model: '逐集推进',
          style_direction: '都市短剧',
        },
        {
          id: 'b2',
          name: '情绪版',
          claim: '保留人物情绪。',
          rhythm_model: '情绪递进',
          style_direction: '现实主义',
        },
      ],
    })).toThrow(/remote_agent_invalid_output/)
  })
})

describe('DramaAgentService prompt context', () => {
  function blueprint(episodeNumber: number) {
    return {
      episode_number: episodeNumber,
      title: `第${episodeNumber}集`,
      positioning: '推进主线',
      opening_hook: '冲突升级。',
      summary: '围绕核心冲突推进。',
      source_trace: [{ source_id: 7, chapter_no: 1 }],
      characters: ['林夏'],
      scenes: ['旧宅客厅'],
      ending_hook: '新的线索出现。',
      risk_notes: [],
      brief_id: 'brief-strong-hook',
    }
  }

  function brief() {
    return {
      id: 'brief-strong-hook',
      name: '强钩子版',
      claim: '每集前 5 秒给出反转。',
      rhythm_model: '三集一反转',
      target_episode_count: 24,
      episode_duration: '60-90 秒',
      style_direction: '都市爽剧',
      hook_density: '高',
      retained_points: ['遗嘱调包'],
      removed_points: ['弱支线'],
      risk_notes: [],
      production_cost: '中',
      recommended_for: '试播验证',
    }
  }

  it('requests an exact blueprint range with continuity context', async () => {
    const executeJson = vi.fn(async (_input: any) => ({
      result: { episode_blueprints: [5, 6, 7, 8].map(blueprint) },
      remoteRunId: 'remote-blueprints-5-8',
      usage: null,
      warnings: [],
    }))
    const service = new DramaAgentService(
      { executeJson } as any,
      new DramaAgentSchemaValidator(),
      { getSkillContent: vi.fn(() => '# Skill') } as any,
    )

    await service.generateEpisodeBlueprints({
      userId: 1,
      dramaId: 10,
      sourceId: 7,
      health: {} as any,
      analysis: {} as any,
      brief: brief(),
      episodeStart: 5,
      episodeEnd: 8,
      previousBlueprint: blueprint(4),
    })

    const input = executeJson.mock.calls[0]?.[0]
    const runtimeContext = JSON.parse(String(input?.userPrompt || '{}'))
    expect(input?.idempotencyKey).toContain('blueprint:5-8')
    expect(runtimeContext.request).toEqual({
      episode_range: { start: 5, end: 8 },
      episode_start: 5,
      episode_end: 8,
      required_episode_numbers: [5, 6, 7, 8],
      target_episode_count: 24,
    })
    expect(runtimeContext.previous_blueprint).toMatchObject({ episode_number: 4 })
  })

  it('rejects a blueprint batch with missing or unexpected episode numbers', async () => {
    const executeJson = vi.fn(async () => ({
      result: { episode_blueprints: [blueprint(5), blueprint(7), blueprint(8)] },
      remoteRunId: 'remote-blueprints-invalid',
      usage: null,
      warnings: [],
    }))
    const service = new DramaAgentService(
      { executeJson } as any,
      new DramaAgentSchemaValidator(),
      { getSkillContent: vi.fn(() => '# Skill') } as any,
    )

    await expect(service.generateEpisodeBlueprints({
      userId: 1,
      dramaId: 10,
      sourceId: 7,
      health: {} as any,
      analysis: {} as any,
      brief: brief(),
      episodeStart: 5,
      episodeEnd: 8,
    })).rejects.toThrow(/remote_agent_blueprint_range_mismatch:5-8:5,7,8/)
  })

  it('binds the adaptation skill and passes selected brief and source trace as runtime context', async () => {
    const executeJson = vi.fn(async (input) => ({
      result: { script_content: '# 第1集\n场景：旧宅客厅' },
      remoteRunId: 'remote-script-1',
      usage: null,
      warnings: [],
      input,
    }))
    const skillsService = {
      getSkillContent: vi.fn(() => '# 短剧项目级改编 Skill\n\n规则由 Skill 驱动。'),
    }
    const service = new DramaAgentService(
      { executeJson } as any,
      new DramaAgentSchemaValidator(),
      skillsService as any,
    )

    await service.generateEpisodeScript({
      userId: 1,
      dramaId: 10,
      episodeId: 100,
      brief: {
        id: 'brief-strong-hook',
        name: '强钩子版',
        claim: '每集前 5 秒给出反转。',
        rhythm_model: '三集一反转',
        target_episode_count: 24,
        episode_duration: '60-90 秒',
        style_direction: '都市爽剧',
        hook_density: '高',
        retained_points: ['遗嘱调包'],
        removed_points: ['弱支线'],
        risk_notes: [],
        production_cost: '中',
        recommended_for: '试播验证',
      },
      blueprint: {
        episode_number: 1,
        title: '第1集：遗嘱调包',
        positioning: '试播关键集',
        opening_hook: '女主发现遗嘱被调包。',
        summary: '围绕遗嘱争夺推进第一轮冲突。',
        source_trace: [{ source_id: 7, chapter_no: 1, excerpt: '遗嘱被调包' }],
        characters: ['林夏', '顾沉'],
        scenes: ['旧宅客厅'],
        ending_hook: '真正继承人出现。',
        risk_notes: [],
        brief_id: 'brief-strong-hook',
      },
      sourceTrace: [{ source_id: 7, chapter_no: 1, excerpt: '遗嘱被调包' }],
    })

    const input = executeJson.mock.calls[0]?.[0]
    const runtimeContext = JSON.parse(String(input?.userPrompt || '{}'))
    expect(skillsService.getSkillContent).toHaveBeenCalledWith(['drama_adaptation_copilot'])
    expect(String(input?.systemPrompt || '')).toContain('# 短剧项目级改编 Skill')
    expect(String(input?.systemPrompt || '')).toContain('mode: episode_script_generate')
    expect(runtimeContext).toMatchObject({
      selected_brief: {
        name: '强钩子版',
      },
      source_trace: [{
        source_id: 7,
      }],
    })
  })
})
