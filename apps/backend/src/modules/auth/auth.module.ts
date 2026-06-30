import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'

import { AuthController } from './auth.controller'
import { AuthRegistrationService } from './auth-registration.service'
import { AuthService } from './auth.service'
import { RolesGuard } from './roles.guard'
import { SessionAuthGuard } from './session-auth.guard'

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthRegistrationService,
    AuthService,
    SessionAuthGuard,
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [AuthService, SessionAuthGuard],
})
export class AuthModule {}
