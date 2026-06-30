import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthService } from './auth.service'
import { ROLES_KEY } from './roles.decorator'
import type { AuthenticatedRequest } from './auth.types'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    let currentUser = request.currentUser

    if (!currentUser) {
      const session = await this.authService.getSession(request)
      if (session) {
        request.currentUser = session.user
        currentUser = session.user
      }
    }

    if (!currentUser) {
      throw new UnauthorizedException('未登录')
    }

    if (!requiredRoles.includes(currentUser.role)) {
      throw new ForbiddenException('无权限访问该资源')
    }

    return true
  }
}
