import { Body, Controller, NotFoundException, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { VideosService } from '../videos/videos.service'

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly videosService: VideosService) {}

  @Post(':provider')
  async handleWebhook(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (provider !== 'vidu') {
      throw new NotFoundException(`Webhook route not found: /webhooks/${provider}`)
    }

    return this.videosService.handleViduWebhook(body)
  }
}
