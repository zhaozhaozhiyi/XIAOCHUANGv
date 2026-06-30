import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { AdminModule } from './modules/admin/admin.module'
import { CanvasModule } from './modules/canvas/canvas.module'
import { AgentConfigsModule } from './modules/agent-configs/agent-configs.module'
import { AiModule } from './modules/ai/ai.module'
import { AiConfigsModule } from './modules/ai-configs/ai-configs.module'
import { AssetsModule } from './modules/assets/assets.module'
import { AudioModule } from './modules/audio/audio.module'
import { AuthModule } from './modules/auth/auth.module'
import { CharactersModule } from './modules/characters/characters.module'
import { ComposeModule } from './modules/compose/compose.module'
import { envSchema } from './config/env'
import { DatabaseModule } from './db/database.module'
import { DramasModule } from './modules/dramas/dramas.module'
import { EpisodesModule } from './modules/episodes/episodes.module'
import { GridModule } from './modules/grid/grid.module'
import { HealthModule } from './modules/health/health.module'
import { ImagesModule } from './modules/images/images.module'
import { MergeModule } from './modules/merge/merge.module'
import { QueueModule } from './modules/queue/queue.module'
import { QuickVideoSessionsModule } from './modules/quick-video-sessions/quick-video-sessions.module'
import { ScenesModule } from './modules/scenes/scenes.module'
import { SkillsModule } from './modules/skills/skills.module'
import { StoryboardsModule } from './modules/storyboards/storyboards.module'
import { StorageModule } from './modules/storage/storage.module'
import { TasksModule } from './modules/tasks/tasks.module'
import { UploadsModule } from './modules/uploads/uploads.module'
import { VideosModule } from './modules/videos/videos.module'
import { WebhooksModule } from './modules/webhooks/webhooks.module'
import { WritingsModule } from './modules/writings/writings.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (config) => envSchema.parse(config),
    }),
    QueueModule,
    QuickVideoSessionsModule,
    DatabaseModule,
    StorageModule,
    HealthModule,
    GridModule,
    ImagesModule,
    ComposeModule,
    MergeModule,
    AuthModule,
    CharactersModule,
    DramasModule,
    EpisodesModule,
    ScenesModule,
    SkillsModule,
    StoryboardsModule,
    TasksModule,
    VideosModule,
    WebhooksModule,
    WritingsModule,
    AdminModule,
    AgentConfigsModule,
    AiModule,
    AiConfigsModule,
    AssetsModule,
    AudioModule,
    CanvasModule,
    UploadsModule,
  ],
})
export class AppModule {}
