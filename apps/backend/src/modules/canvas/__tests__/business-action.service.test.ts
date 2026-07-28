import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BusinessActionService } from '../business-action/business-action.service'

function queryResult(result: any[]) {
  const promise = Promise.resolve(result)
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    for: vi.fn(() => promise),
    then: promise.then.bind(promise),
  }
  return chain
}

function createDbMock(
  sourceNode: any | null = null,
  options: { activeRun?: any; activeVersion?: any; activeTasks?: any[] } = {},
) {
  let txSelectCallCount = 0
  const insertedValues: any[] = []
  const txMock = {
    select: vi.fn(() => {
      const callIdx = txSelectCallCount++
      if (callIdx === 0) return queryResult([{ id: 'cnv_1' }])
      if (callIdx === 1) return queryResult(options.activeRun ? [options.activeRun] : [])
      if (callIdx === 2 && options.activeRun) {
        return queryResult([options.activeVersion ?? { id: 'ver_active', label: 'BA batch: 构想画面' }])
      }
      return queryResult(options.activeTasks ?? [])
    }),
    insert: vi.fn(() => ({
      values: vi.fn((values: any) => {
        if (Array.isArray(values)) insertedValues.push(...values)
        else insertedValues.push(values)
        return Promise.resolve()
      }),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
  }
  return {
    insertedValues,
    db: {
      select: vi.fn(() => queryResult(sourceNode ? [sourceNode] : [])),
      transaction: vi.fn(async (fn: any) => fn(txMock)),
      insert: vi.fn(() => ({
        values: vi.fn((values: any) => {
          if (Array.isArray(values)) insertedValues.push(...values)
          else insertedValues.push(values)
          return Promise.resolve()
        }),
      })),
    } as any,
  }
}

function createOrchestratorMock() {
  return {
    startRun: vi.fn(() => Promise.resolve()),
    enqueueAddedTask: vi.fn(() => Promise.resolve()),
  }
}

describe('BusinessActionService', () => {
  // ═══════════════════════════════════════════════
  // 已知业务动作（快速验证）
  // ═══════════════════════════════════════════════

  const KNOWN_ACTIONS = [
    '生成形象', '生成场景', '构想画面', '改画面', '换装', '换表情', '换时段', '换天气',
    '生成镜头视频', '配音', '生成', '生成视频', '生成音频', '生成分镜',
    '整理脚本', '合成', '执行技能',
  ]

  for (const actionLabel of KNOWN_ACTIONS) {
    it(`已知业务动作: "${actionLabel}"`, async () => {
      const mockDb = createDbMock({
        id: 'node_src', canvasId: 'cnv_1', nodeDefId: 'storyboard',
        label: '分镜1', dataJson: '{}',
        positionX: 100, positionY: 200,
      })
      const service = new BusinessActionService(mockDb as any, createOrchestratorMock() as any)

      const result = await service.triggerAction('cnv_1', 1, {
        sourceNodeId: 'node_src',
        actionLabel,
        userInput: 'test',
        renderedPrompt: 'test prompt',
      })

      expect(result.hidden_node_id).toMatch(/^node_/)
      expect(result.run_id).toMatch(/^run_/)
    })
  }

  // ═══════════════════════════════════════════════
  // 错误处理
  // ═══════════════════════════════════════════════

  it('未知业务动作抛错', async () => {
    const mockDb = createDbMock()
    const service = new BusinessActionService(mockDb as any, createOrchestratorMock() as any)

    await expect(service.triggerAction('cnv_1', 1, {
      sourceNodeId: 'node_1',
      actionLabel: '不存在的动作',
      userInput: '',
      renderedPrompt: '',
    })).rejects.toThrow(/unknown business action/i)
  })

  it('源节点不存在时抛错', async () => {
    const mockDb = createDbMock(null) // null = 查不到
    const service = new BusinessActionService(mockDb as any, createOrchestratorMock() as any)

    await expect(service.triggerAction('cnv_1', 1, {
      sourceNodeId: 'node_nonexistent',
      actionLabel: '构想画面',
      userInput: 'test',
      renderedPrompt: 'test',
    })).rejects.toThrow(/source_node_not_found/i)
  })

  // ═══════════════════════════════════════════════
  // 返回格式
  // ═══════════════════════════════════════════════

  it('返回 hidden_node_id 和 run_id（匹配前端 MSW 期望）', async () => {
    const mockDb = createDbMock({
      id: 'node_src', canvasId: 'cnv_1', nodeDefId: 'storyboard',
      label: '', dataJson: '{}', positionX: 0, positionY: 0,
    })
    const service = new BusinessActionService(mockDb as any, createOrchestratorMock() as any)

    const result = await service.triggerAction('cnv_1', 1, {
      sourceNodeId: 'node_src',
      actionLabel: '构想画面',
      userInput: '城市天际线',
      renderedPrompt: '城市天际线',
    })

    expect(result.hidden_node_id).toMatch(/^node_/)
    expect(result.run_id).toMatch(/^run_/)
  })

  it('兼容 DramaClaw 视频节点动作和目标节点数据', async () => {
    const mockDb = createDbMock({
      id: 'node_src', canvasId: 'cnv_1', nodeDefId: 'imageNode',
      label: '参考图', dataJson: JSON.stringify({ imageUrl: '/static/source.png' }),
      positionX: 100, positionY: 200,
    })
    const service = new BusinessActionService(mockDb as any, createOrchestratorMock() as any)

    const result = await service.triggerAction('cnv_1', 1, {
      sourceNodeId: 'node_src',
      actionLabel: '生成视频',
      userInput: '镜头向前推进',
      renderedPrompt: '镜头向前推进',
      outputMode: 'insert_new_node',
      targetNodeType: 'videoNode',
    })

    expect(result.node?.type).toBe('videoNode')
    expect(result.node?.data).toMatchObject({
      displayName: '镜头向前推进',
      videoUrl: null,
      isGenerating: true,
      genMode: 'textToVideo',
    })

    const visibleNode = mockDb.insertedValues.find((value) => value.nodeDefId === 'videoNode')
    expect(JSON.parse(visibleNode.dataJson)).toMatchObject({ videoUrl: null, isGenerating: true })

    const hiddenNode = mockDb.insertedValues.find((value) => value.nodeDefId === 'image-to-video')
    expect(JSON.parse(hiddenNode.dataJson)).toMatchObject({
      actionLabel: '生成视频',
      references: ['/static/source.png'],
    })
  })

  it('活跃 run 存在时把新动作追加到同一批次并立即入队', async () => {
    const activeRun = { id: 'run_active', versionId: 'ver_active', status: 'running' }
    const mockDb = createDbMock({
      id: 'node_src', canvasId: 'cnv_1', nodeDefId: 'storyboard',
      label: '分镜1', dataJson: '{}', positionX: 100, positionY: 200,
    }, { activeRun })
    const orchestrator = createOrchestratorMock()
    const service = new BusinessActionService(mockDb as any, orchestrator as any)

    const result = await service.triggerAction('cnv_1', 1, {
      sourceNodeId: 'node_src',
      actionLabel: '构想画面',
      userInput: '夜景街道',
      renderedPrompt: '夜景街道',
    })

    expect(result.run_id).toBe('run_active')
    expect(result.queued).toBe(true)
    expect(result.deduplicated).toBe(false)
    expect(orchestrator.enqueueAddedTask).toHaveBeenCalledWith(result.task_id, 1)
    expect(orchestrator.startRun).not.toHaveBeenCalled()
    expect(mockDb.insertedValues.some((value) => value.id === 'run_active')).toBe(false)
  })

  it('同一批次内的相同非终态动作会复用原任务', async () => {
    const requestKey = JSON.stringify([
      'node_src', '构想画面', '夜景街道', false, 'image',
    ])
    const mockDb = createDbMock({
      id: 'node_src', canvasId: 'cnv_1', nodeDefId: 'storyboard',
      label: '分镜1', dataJson: '{}', positionX: 100, positionY: 200,
    }, {
      activeRun: { id: 'run_active', versionId: 'ver_active', status: 'running' },
      activeTasks: [{
        id: 'task_existing', nodeId: 'node_hidden', status: 'queued',
        paramsJson: JSON.stringify({ requestKey }),
      }],
    })
    const orchestrator = createOrchestratorMock()
    const service = new BusinessActionService(mockDb as any, orchestrator as any)

    const result = await service.triggerAction('cnv_1', 1, {
      sourceNodeId: 'node_src',
      actionLabel: '构想画面',
      userInput: '夜景街道',
      renderedPrompt: '夜景街道',
    })

    expect(result).toMatchObject({
      run_id: 'run_active',
      task_id: 'task_existing',
      hidden_node_id: 'node_hidden',
      queued: true,
      deduplicated: true,
      node: null,
    })
    expect(mockDb.insertedValues).toHaveLength(0)
    expect(orchestrator.startRun).not.toHaveBeenCalled()
    expect(orchestrator.enqueueAddedTask).not.toHaveBeenCalled()
  })

  it('不会把手动动作混入正在执行的成片流水线', async () => {
    const mockDb = createDbMock({
      id: 'node_src', canvasId: 'cnv_1', nodeDefId: 'storyboard',
      label: '分镜1', dataJson: '{}', positionX: 100, positionY: 200,
    }, {
      activeRun: { id: 'run_movie', versionId: 'ver_movie', status: 'running' },
      activeVersion: { id: 'ver_movie', label: '生成成片' },
    })
    const orchestrator = createOrchestratorMock()
    const service = new BusinessActionService(mockDb as any, orchestrator as any)

    await expect(service.triggerAction('cnv_1', 1, {
      sourceNodeId: 'node_src',
      actionLabel: '构想画面',
      userInput: '夜景街道',
      renderedPrompt: '夜景街道',
    })).rejects.toThrow(/a run is already in progress/i)

    expect(mockDb.insertedValues).toHaveLength(0)
    expect(orchestrator.startRun).not.toHaveBeenCalled()
    expect(orchestrator.enqueueAddedTask).not.toHaveBeenCalled()
  })
})
