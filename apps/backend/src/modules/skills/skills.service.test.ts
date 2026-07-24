import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { SkillsService } from './skills.service'

describe('SkillsService', () => {
  it('loads the project adaptation skill from the backend workspace', () => {
    const service = new SkillsService()

    expect(service.getSkillContent(['drama_adaptation_copilot'])).toContain('drama_adaptation_copilot')
  })

  it('loads all pinned Hermes runtime phase skills from the backend workspace', () => {
    const service = new SkillsService()

    for (const skill of [
      'xiaochuang_runtime_policy',
      'drama_source_understanding',
      'drama_episode_planning',
      'drama_episode_script_writing',
      'drama_story_graph_build',
      'drama_storyboard_planning',
    ]) {
      expect(service.getSkillContent([skill])).toContain(skill)
    }
  })

  it('rejects non-English skill id segments before writing files', () => {
    const service = new SkillsService()

    expect(() => service.createSkill({ id: 'script_rewriter/中文 skill' })).toThrow(BadRequestException)
    expect(() => service.createSkill({ id: 'script_rewriter/../escape' })).toThrow(BadRequestException)
  })
})
