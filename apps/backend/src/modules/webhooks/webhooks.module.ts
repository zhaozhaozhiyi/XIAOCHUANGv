import { Module } from '@nestjs/common'

import { VideosModule } from '../videos/videos.module'
import { WebhooksController } from './webhooks.controller'

@Module({
  imports: [VideosModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
