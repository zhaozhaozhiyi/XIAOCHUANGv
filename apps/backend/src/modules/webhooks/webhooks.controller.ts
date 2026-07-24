import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { VideosService } from '../videos/videos.service'
import { isValidViduWebhookSecret, readViduWebhookSecret } from '../videos/videos.webhook'

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly videosService: VideosService) {}

  @Post(':provider')
  async handleWebhook(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
    @Query('token') token?: string,
    @Headers('x-webhook-secret') webhookSecret?: string,
    @Headers('x-vidu-webhook-secret') viduWebhookSecret?: string,
    @Headers('authorization') authorization?: string,
  ) {
    if (provider !== 'vidu') {
      throw new NotFoundException(`Webhook route not found: /webhooks/${provider}`)
    }

    if (!readViduWebhookSecret()) {
      throw new ServiceUnavailableException('VIDU_WEBHOOK_SECRET is not configured')
    }

    const bearerToken = String(authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]
    const providedSecret = token || webhookSecret || viduWebhookSecret || bearerToken

    if (!isValidViduWebhookSecret(providedSecret)) {
      throw new ForbiddenException('Invalid webhook token')
    }

    return this.videosService.handleViduWebhook(body)
  }
}
