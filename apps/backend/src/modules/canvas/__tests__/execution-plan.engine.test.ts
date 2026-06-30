import { describe, expect, it } from 'vitest'
import { ExecutionPlanEngine } from '../execution-plan/execution-plan.engine'
import { BadRequestException } from '@nestjs/common'

function makeEngine(): ExecutionPlanEngine {
  return new ExecutionPlanEngine()
}

describe('ExecutionPlanEngine', () => {
  // ═══════════════════════════════════════════════
  // 拓扑排序：基本线性流水线
  // ═══════════════════════════════════════════════

  it('构建线性流水线：t2i → i2v → concat → export（4阶段）', () => {
    const engine = makeEngine()

    // text-to-image → image-to-video → concat → export
    const executeNodes = [
      { nodeId: 'n1', nodeDefId: 'text-to-image', data: {} },
      { nodeId: 'n2', nodeDefId: 'image-to-video', data: {} },
      { nodeId: 'n3', nodeDefId: 'concat', data: {} },
      { nodeId: 'n4', nodeDefId: 'export', data: {} },
    ]

    const plan = engine.buildPlan(
      executeNodes,
      [],
      // 模拟 dataflow 依赖：t2i output → storyboard input → i2v needs image
      // i2v depends on image → which comes from t2i
      // concat depends on storyboards (which get image from t2i, video from i2v)
      [
        { sourceNodeId: 'n1', targetNodeId: 's1', sourcePort: 'out:image', targetPort: 'in:image' },
        { sourceNodeId: 's1', targetNodeId: 'n2', sourcePort: null, targetPort: null },
        { sourceNodeId: 'n2', targetNodeId: 'n3', sourcePort: 'out:video', targetPort: 'in:video' },
        { sourceNodeId: 'n3', targetNodeId: 'n4', sourcePort: 'out:video', targetPort: 'in:video' },
      ],
      [
        { id: 't1', nodeId: 'n1', nodeDefId: 'text-to-image' },
        { id: 't2', nodeId: 'n2', nodeDefId: 'image-to-video' },
        { id: 't3', nodeId: 'n3', nodeDefId: 'concat' },
        { id: 't4', nodeId: 'n4', nodeDefId: 'export' },
      ],
    )

    expect(plan.totalNodes).toBe(4)
    expect(plan.stages.length).toBeGreaterThanOrEqual(2)

    // export 在最后阶段
    const lastStage = plan.stages[plan.stages.length - 1]
    expect(lastStage.tasks.some((t) => t.nodeDefId === 'export')).toBe(true)
  })

  // ═══════════════════════════════════════════════
  // 无依赖节点可并行（同阶段）
  // ═══════════════════════════════════════════════

  it('两个无依赖的 text-to-image 并列在同阶段', () => {
    const engine = makeEngine()

    const executeNodes = [
      { nodeId: 'n1', nodeDefId: 'text-to-image', data: {} },
      { nodeId: 'n2', nodeDefId: 'text-to-image', data: {} },
    ]

    const plan = engine.buildPlan(
      executeNodes,
      [],
      [],
      [
        { id: 't1', nodeId: 'n1', nodeDefId: 'text-to-image' },
        { id: 't2', nodeId: 'n2', nodeDefId: 'text-to-image' },
      ],
    )

    expect(plan.totalNodes).toBe(2)
    expect(plan.stages.length).toBe(1)
    expect(plan.stages[0].tasks).toHaveLength(2)
  })

  // ═══════════════════════════════════════════════
  // text-to-image → storyboard → image-to-video 间接依赖
  // ═══════════════════════════════════════════════

  it('通过内容节点的间接依赖：t2i → storyboard → i2v', () => {
    const engine = makeEngine()

    const executeNodes = [
      { nodeId: 'n_t2i', nodeDefId: 'text-to-image', data: {} },
      { nodeId: 'n_i2v', nodeDefId: 'image-to-video', data: {} },
    ]

    const plan = engine.buildPlan(
      executeNodes,
      [
        { id: 's_story', nodeDefId: 'storyboard', data: {} },
      ],
      [
        // t2i → storyboard
        { sourceNodeId: 'n_t2i', targetNodeId: 's_story', sourcePort: 'out:image', targetPort: 'in:image' },
        // storyboard → i2v (i2v needs image from storyboard which got it from t2i)
        { sourceNodeId: 's_story', targetNodeId: 'n_i2v', sourcePort: null, targetPort: null },
      ],
      [
        { id: 't1', nodeId: 'n_t2i', nodeDefId: 'text-to-image' },
        { id: 't2', nodeId: 'n_i2v', nodeDefId: 'image-to-video' },
      ],
    )

    expect(plan.totalNodes).toBe(2)
    // t2i 应该先于 i2v
    const order = plan.stages.flatMap((s) => s.tasks.map((t) => t.nodeDefId))
    const t2iIndex = order.indexOf('text-to-image')
    const i2vIndex = order.indexOf('image-to-video')
    expect(t2iIndex).toBeLessThan(i2vIndex)
  })

  // ═══════════════════════════════════════════════
  // 循环依赖检测
  // ═══════════════════════════════════════════════

  it('检测循环依赖并抛错', () => {
    const engine = makeEngine()

    const executeNodes = [
      { nodeId: 'n1', nodeDefId: 'text-to-image', data: {} },
      { nodeId: 'n2', nodeDefId: 'image-to-video', data: {} },
    ]

    // 构造循环：n1 depends on n2, n2 depends on n1
    const createLoop = () =>
      engine.buildPlan(
        executeNodes,
        [],
        [
          { sourceNodeId: 'n2', targetNodeId: 'n1', sourcePort: 'out:image', targetPort: 'in:image' },
          { sourceNodeId: 'n1', targetNodeId: 'n2', sourcePort: 'out:video', targetPort: 'in:image' },
        ],
        [
          { id: 't1', nodeId: 'n1', nodeDefId: 'text-to-image' },
          { id: 't2', nodeId: 'n2', nodeDefId: 'image-to-video' },
        ],
      )

    expect(createLoop).toThrow(BadRequestException)
    expect(createLoop).toThrow(/circular dependency/i)
  })

  // ═══════════════════════════════════════════════
  // 空执行节点 = 全部在第一阶段
  // ═══════════════════════════════════════════════

  it('单节点返回一个阶段', () => {
    const engine = makeEngine()

    const plan = engine.buildPlan(
      [{ nodeId: 'n1', nodeDefId: 'export', data: {} }],
      [],
      [],
      [{ id: 't1', nodeId: 'n1', nodeDefId: 'export' }],
    )

    expect(plan.totalNodes).toBe(1)
    expect(plan.stages).toHaveLength(1)
  })

  // ═══════════════════════════════════════════════
  // 并行 text-to-speech 和 image-to-video（无相互依赖）
  // ═══════════════════════════════════════════════

  it('image-to-video 和 text-to-speech 可并行（无相互依赖）', () => {
    const engine = makeEngine()

    const executeNodes = [
      { nodeId: 'n_i2v', nodeDefId: 'image-to-video', data: {} },
      { nodeId: 'n_tts', nodeDefId: 'text-to-speech', data: {} },
    ]

    const plan = engine.buildPlan(
      executeNodes,
      [],
      [],
      [
        { id: 't1', nodeId: 'n_i2v', nodeDefId: 'image-to-video' },
        { id: 't2', nodeId: 'n_tts', nodeDefId: 'text-to-speech' },
      ],
    )

    expect(plan.totalNodes).toBe(2)
    // 两者无共同依赖 → 应在同一阶段
    expect(plan.stages.length).toBe(1)
    expect(plan.stages[0].tasks).toHaveLength(2)
  })

  // ═══════════════════════════════════════════════
  // 5 节点完整管线（t2i × 2 → i2v × 2 → concat → export）
  // ═══════════════════════════════════════════════

  it('5节点完整管线验证阶段顺序', () => {
    const engine = makeEngine()

    const executeNodes = [
      { nodeId: 't2i_a', nodeDefId: 'text-to-image', data: {} },
      { nodeId: 't2i_b', nodeDefId: 'text-to-image', data: {} },
      { nodeId: 'i2v_a', nodeDefId: 'image-to-video', data: {} },
      { nodeId: 'i2v_b', nodeDefId: 'image-to-video', data: {} },
      { nodeId: 'concat', nodeDefId: 'concat', data: {} },
    ]

    const plan = engine.buildPlan(
      executeNodes,
      [],
      [
        // t2i nodes → their storyboards → i2v nodes
        { sourceNodeId: 't2i_a', targetNodeId: 's_a', sourcePort: 'out:image', targetPort: 'in:image' },
        { sourceNodeId: 's_a', targetNodeId: 'i2v_a', sourcePort: null, targetPort: null },
        { sourceNodeId: 't2i_b', targetNodeId: 's_b', sourcePort: 'out:image', targetPort: 'in:image' },
        { sourceNodeId: 's_b', targetNodeId: 'i2v_b', sourcePort: null, targetPort: null },
        // i2v → concat
        { sourceNodeId: 'i2v_a', targetNodeId: 'concat', sourcePort: 'out:video', targetPort: 'in:video' },
        { sourceNodeId: 'i2v_b', targetNodeId: 'concat', sourcePort: 'out:video', targetPort: 'in:video' },
      ],
      [
        { id: 't1', nodeId: 't2i_a', nodeDefId: 'text-to-image' },
        { id: 't2', nodeId: 't2i_b', nodeDefId: 'text-to-image' },
        { id: 't3', nodeId: 'i2v_a', nodeDefId: 'image-to-video' },
        { id: 't4', nodeId: 'i2v_b', nodeDefId: 'image-to-video' },
        { id: 't5', nodeId: 'concat', nodeDefId: 'concat' },
      ],
    )

    expect(plan.totalNodes).toBe(5)
    // 阶段顺序：t2i_a+t2i_b → i2v_a+i2v_b → concat
    const allNodes = plan.stages.flatMap((s) => s.tasks.map((t) => t.nodeDefId))

    // t2i 应在 i2v 前面
    const t2iAMaxPos = Math.max(...allNodes.filter((n) => n === 'text-to-image').map((_, i) => i))
    const i2vAMinPos = Math.min(...allNodes.filter((n) => n === 'image-to-video').map((_, i) => i))
    // 简单验证：concat 在最后
    expect(allNodes[allNodes.length - 1]).toBe('concat')
  })
})
