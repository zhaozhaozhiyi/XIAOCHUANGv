import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { SessionAuthGuard } from '../auth/session-auth.guard'
import { SkillsService } from './skills.service'

@ApiTags('skills')
@Controller('skills')
@UseGuards(SessionAuthGuard)
export class SkillsController {
  constructor(@Inject(SkillsService) private readonly skillsService: SkillsService) {}

  @Get()
  listSkills() {
    return this.skillsService.listSkills()
  }

  @Post()
  createSkill(@Body() body: Record<string, unknown>) {
    return this.skillsService.createSkill(body)
  }

  @Get(':agent/:skill')
  getSkill(
    @Param('agent') agent: string,
    @Param('skill') skill: string,
  ) {
    return { content: this.skillsService.getSkillContent([agent, skill]) }
  }

  @Put(':agent/:skill')
  updateSkill(
    @Param('agent') agent: string,
    @Param('skill') skill: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.skillsService.updateSkillContent([agent, skill], String(body.content || ''))
    return { success: true }
  }

  @Delete(':agent/:skill')
  deleteSkill(
    @Param('agent') agent: string,
    @Param('skill') skill: string,
  ) {
    this.skillsService.deleteSkill([agent, skill])
    return { success: true }
  }
}
