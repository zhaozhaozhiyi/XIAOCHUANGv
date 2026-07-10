import { describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'

import { AiConfigResolverService } from '../ai-configs/ai-configs.resolver'
import { DatabaseService } from '../../db/database.service'
import { DramaAgentSchemaValidator, DramaAgentService, RemoteDramaAgentAdapter } from './drama-agent.service'
import {
  DramaAiFirstService,
  markEpisodeGenerationModeSourceStale,
  markEpisodeGenerationModeStale,
} from './drama-ai-first.service'

function makeService() {
  return new DramaAiFirstService({} as DatabaseService)
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
      source_analysis: {
        theme: '身份反转与复仇',
        core_conflict: '女主被夺走继承权后夺回真相。',
        protagonist: '林夏',
        protagonist_goal: '拿回继承权',
        evidence: [{ claim: '第一章出现遗嘱调包', source_trace: [{ source_id: 1, chapter_no: 1 }] }],
      },
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
    expect(briefs).toHaveLength(2)
    expect(blueprints[0]?.source_trace?.[0]?.chapter_no).toBe(1)
    expect(script).toContain('旧宅客厅')
  })

  it('normalizes common nested source analysis output variants', () => {
    const analysis = validator.validateSourceAnalysis({
      source_analysis: {
        analysis: {
          主题: '家族关系修复与代际和解',
          核心冲突: '主角想守住家庭真实情感，但家人长期误解彼此。',
          主角: '小陈',
          主角目标: '重新凝聚家庭',
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
      },
    })

    expect(analysis.theme).toContain('家族关系')
    expect(analysis.core_conflict).toContain('误解')
    expect(analysis.relationship_map).toHaveLength(1)
    expect(analysis.evidence).toHaveLength(1)
    expect(analysis.evidence[0]?.source_trace[0]?.source_id).toBe(1)
  })

  it('normalizes string source traces into excerpt objects', () => {
    const analysis = validator.validateSourceAnalysis({
      source_analysis: {
        theme: '家庭和解',
        core_conflict: '误会累积导致亲情撕裂。',
        protagonist: '小陈',
        protagonist_goal: '修复家庭关系',
        evidence: [{ claim: '饭桌冲突推动关系变化', source_trace: ['饭桌上众人沉默'] }],
      },
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

  it('rejects empty remote brief output', () => {
    expect(() => validator.validateAdaptationBriefs({
      adaptation_briefs: [],
    })).toThrow(/remote_agent_invalid_output/)
  })
})

describe('DramaAgentService prompt context', () => {
  it('passes selected brief and source trace into pilot script generation', async () => {
    const executeJson = vi.fn(async (input) => ({
      result: { script_content: '# 第1集\n场景：旧宅客厅' },
      remoteRunId: 'remote-script-1',
      usage: null,
      warnings: [],
      input,
    }))
    const service = new DramaAgentService({ executeJson } as any, new DramaAgentSchemaValidator())

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

    const prompt = String(executeJson.mock.calls[0]?.[0]?.userPrompt || '')
    expect(prompt).toContain('选中策略')
    expect(prompt).toContain('强钩子版')
    expect(prompt).toContain('原文追溯')
    expect(prompt).toContain('"source_id":7')
    expect(prompt).toContain('不要编造未出现的主线事实')
  })
})
