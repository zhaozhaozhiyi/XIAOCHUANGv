import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { AiConfigResolverService } from './ai-configs.resolver'
import { AiConfigsController, AiProvidersController, AiVoicesController } from './ai-configs.controller'

@Module({
  imports: [AuthModule],
  providers: [AiConfigResolverService],
  controllers: [AiConfigsController, AiProvidersController, AiVoicesController],
  exports: [AiConfigResolverService],
})
export class AiConfigsModule {}
