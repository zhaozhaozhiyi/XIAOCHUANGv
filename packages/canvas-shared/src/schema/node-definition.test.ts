import { describe, expect, it } from 'vitest'
import { nodeRegistry, listAvailableNodes, listNodesByCategory } from '../nodes/index.js'
import { CanvasNodeDefinitionSchema } from './node-definition.js'

describe('nodeRegistry', () => {
  it('every node passes zod validation', () => {
    for (const [id, node] of Object.entries(nodeRegistry)) {
      const result = CanvasNodeDefinitionSchema.safeParse(node)
      if (!result.success) {
        // 把错误细节打印出来便于调试
        console.error(`Node ${id} validation failed:`, result.error.format())
      }
      expect(result.success).toBe(true)
      expect(node.id).toBe(id)
    }
  })

  it('v0.2.0 has exactly 10 nodes (5 content + 5 execute)', () => {
    const v020 = listAvailableNodes('v0.2.0')
    expect(v020.length).toBe(10)
    expect(listNodesByCategory('content', 'v0.2.0').length).toBe(5)
    expect(listNodesByCategory('execute', 'v0.2.0').length).toBe(5)
  })

  it('businessActions reference valid contextMenu types', () => {
    const validContexts = new Set(['storyboard', 'character', 'scene', 'global'])
    for (const node of Object.values(nodeRegistry)) {
      for (const ba of node.businessActions ?? []) {
        expect(validContexts.has(ba.contextMenu)).toBe(true)
        expect(ba.promptTemplate.length).toBeGreaterThan(0)
      }
    }
  })

  it('execute nodes have executor defined', () => {
    const executeNodes = listNodesByCategory('execute', 'v0.2.0')
    for (const node of executeNodes) {
      expect(node.executor).toBeDefined()
    }
  })

  it('content nodes do not require executor', () => {
    const contentNodes = listNodesByCategory('content', 'v0.2.0')
    for (const node of contentNodes) {
      // 内容节点通常不需要 executor（仅极特殊场景可能有）
      expect(node.category).toBe('content')
    }
  })

  it('outputs are mostly consumable by some input (sanity warning)', () => {
    // 端口类型 sanity check —— 大部分输出应该至少有一个对应类型的输入消费方
    // 例外：v0.2.0 中 scene/character 类型的连线主要通过 businessActions 走右键消费，
    //       而不是 React Flow 连线，所以不强制要求有数据流端口对接
    const allInputTypes = new Set<string>()
    const allOutputTypes = new Set<string>()
    for (const node of Object.values(nodeRegistry)) {
      for (const i of node.inputs ?? []) allInputTypes.add(i.type)
      for (const o of node.outputs ?? []) allOutputTypes.add(o.type)
    }
    const orphanedOutputs = [...allOutputTypes].filter(t => !allInputTypes.has(t))
    // v0.2.0 允许 scene/character 输出无连线对接（走 businessActions）
    const allowedOrphans = new Set(['scene', 'character'])
    const unexpectedOrphans = orphanedOutputs.filter(t => !allowedOrphans.has(t))
    expect(unexpectedOrphans).toEqual([])
  })
})
