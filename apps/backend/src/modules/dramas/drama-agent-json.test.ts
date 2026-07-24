import { describe, expect, it } from 'vitest'

import { parseJsonWithRepair } from '../ai/skill-handlers/_shared'
import { DramaAgentSchemaValidator } from './drama-agent.service'

describe('parseJsonWithRepair', () => {
  it('repairs missing commas between array objects', () => {
    const malformed = `{
  "episode_blueprints": [
    { "episode_number": 1, "title": "第一集" }
    { "episode_number": 2, "title": "第二集" }
  ]
}`
    const parsed = parseJsonWithRepair(malformed) as { episode_blueprints: Array<{ episode_number: number }> }
    expect(parsed.episode_blueprints).toHaveLength(2)
    expect(parsed.episode_blueprints[1]?.episode_number).toBe(2)
  })

  it('removes trailing commas before closing brackets', () => {
    const malformed = '{"items":[{"id":1},{"id":2},]}'
    const parsed = parseJsonWithRepair(malformed) as { items: Array<{ id: number }> }
    expect(parsed.items).toHaveLength(2)
  })
})

describe('DramaAgentSchemaValidator source analysis', () => {
  it('preserves drawable relationship edges from source analysis', () => {
    const validator = new DramaAgentSchemaValidator()
    const analysis = validator.validateSourceAnalysis({
      source_analysis: {
        theme: '复仇与信任',
        core_conflict: '林夏要证明遗嘱被篡改，顾沉掌握关键证据。',
        protagonist: '林夏',
        antagonist: '顾沉',
        protagonist_goal: '拿回继承权',
        relationship_map: [{
          subject: '林夏',
          object: '顾沉',
          predicate: '互相利用',
          description: '两人因遗嘱证据暂时结盟。',
          source_trace: [{ chapter_no: 1, excerpt: '顾沉递出录音证据。' }],
        }],
      },
    })

    expect(analysis.relationship_map).toEqual([
      expect.objectContaining({
        subject: '林夏',
        object: '顾沉',
        predicate: '互相利用',
      }),
    ])
  })
})
