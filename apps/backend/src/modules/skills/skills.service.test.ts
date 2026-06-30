import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { SkillsService } from './skills.service'

describe('SkillsService', () => {
  it('rejects non-English skill id segments before writing files', () => {
    const service = new SkillsService()

    expect(() => service.createSkill({ id: 'script_rewriter/中文 skill' })).toThrow(BadRequestException)
    expect(() => service.createSkill({ id: 'script_rewriter/../escape' })).toThrow(BadRequestException)
  })
})
