import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BusinessActionService } from '../business-action/business-action.service'

function thenable(result: any) {
  const obj: any = { then: (resolve: any) => resolve(result) }
  obj.select = vi.fn(() => obj)
  obj.from = vi.fn(() => obj)
  obj.where = vi.fn(() => obj)
  obj.insert = vi.fn(() => obj)
  obj.values = vi.fn(() => obj)
  obj.returning = vi.fn(() => Promise.resolve(result))
  return obj
}

function createDbMock(sourceNode: any | null = null) {
  // 第一次 select 返回 sourceNode（triggerAction 先查源节点），后续 select 返回 []（活跃 run 检查等）。
  let selectCallCount = 0
  const insertedValues: any[] = []
  const txMock = {
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
      select: vi.fn(() => {
        const callIdx = selectCallCount++
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve(callIdx === 0 ? (sourceNode ? [sourceNode] : []) : [])),
          })),
        }
      }),
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
  return { startRun: vi.fn(() => Promise.resolve()) }
}

describe('BusinessActionService', () => {
  // ═══════════════════════════════════════════════
  // 已知业务动作（快速验证）
  // ═══════════════════════════════════════════════

  const KNOWN_ACTIONS = [
    '构想画面', '改画面', '换装', '换表情', '换时段', '换天气',
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
})
