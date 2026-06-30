import { CanActivate, ExecutionContext, Injectable, Inject, UnauthorizedException } from '@nestjs/common'

import { AuthService } from './auth.service'
import type { AuthenticatedRequest } from './auth.types'

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const session = await this.authService.getSession(request)

    if (!session) {
      throw new UnauthorizedException('未登录或会话已失效')
    }

    request.currentUser = session.user
    return true
  }
}
