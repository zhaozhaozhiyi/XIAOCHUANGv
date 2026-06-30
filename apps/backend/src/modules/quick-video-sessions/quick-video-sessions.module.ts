import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { AuthModule } from '../auth/auth.module'
import { QuickVideoSessionsController } from './quick-video-sessions.controller'

/**
 * 快速成片对话式工作台 · 后端模块（PRD docs/v2.2/快速成片-对话式工作台-PRD-v0.1.0.md §9）
 *
 * 三层模型：sessions / rounds / outputs。
 * 控制器内直接调 DatabaseService 与 drizzle schema；AI 自动命名（D1）通过统一
 * AI Runtime（AiService + skills/quick-video-session-title/SKILL.md）调用，
 * 不再使用模块内独立的 fetch helper。
 */
@Module({
  imports: [AuthModule, AiModule],
  controllers: [QuickVideoSessionsController],
})
export class QuickVideoSessionsModule {}
