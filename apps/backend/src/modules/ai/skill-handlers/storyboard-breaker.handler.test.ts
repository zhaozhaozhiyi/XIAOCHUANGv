import { describe, expect, it } from 'vitest'

import { assertStoryboardGraphReady } from './storyboard-breaker.handler'

describe('assertStoryboardGraphReady', () => {
  it('requires a current ready story graph before AI storyboard breakdown', () => {
    expect(() => assertStoryboardGraphReady({ graph: null, is_stale: false }))
      .toThrow('story_graph_required')
    expect(() => assertStoryboardGraphReady({
      graph: { status: 'ready' },
      is_stale: true,
    })).toThrow('story_graph_stale')
    expect(() => assertStoryboardGraphReady({
      graph: { status: 'ready' },
      is_stale: false,
    })).not.toThrow()
  })
})
