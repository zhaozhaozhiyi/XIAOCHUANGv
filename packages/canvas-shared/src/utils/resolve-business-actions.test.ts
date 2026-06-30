import { describe, expect, it } from 'vitest'
import { nodeRegistry } from '../nodes/index.js'
import { resolveBusinessActions } from './resolve-business-actions.js'

describe('resolveBusinessActions', () => {
  it('character context menu includes text-to-image actions (换装/换表情)', () => {
    const actions = resolveBusinessActions(nodeRegistry, 'character')
    const labels = actions.map(a => a.label)
    expect(labels).toContain('换装')
    expect(labels).toContain('换表情')
    // 这些动作的 sourceNodeDefId 应都指向 text-to-image
    expect(actions.find(a => a.label === '换装')?.sourceNodeDefId).toBe('text-to-image')
  })

  it('scene context menu includes text-to-image actions (换时段/换天气)', () => {
    const actions = resolveBusinessActions(nodeRegistry, 'scene')
    const labels = actions.map(a => a.label)
    expect(labels).toContain('换时段')
    expect(labels).toContain('换天气')
  })

  it('storyboard context menu includes image-to-video (生成镜头视频) and text-to-speech (配音)', () => {
    const actions = resolveBusinessActions(nodeRegistry, 'storyboard')
    const labels = actions.map(a => a.label)
    expect(labels).toContain('生成镜头视频')
    expect(labels).toContain('配音')
  })

  it('returns empty array for nodes without businessActions', () => {
    const actions = resolveBusinessActions(nodeRegistry, 'global')
    expect(actions).toEqual([])
  })
})
