import { Body, Controller, Get, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import { z } from 'zod'

import { AuthService } from './auth.service'
import { buildDevPhoneCodeResponse, getDevAuthCode, isLocalAuthMockEnabled } from './auth-dev'
import { AuthRegistrationService } from './auth-registration.service'
import { CurrentUser } from './current-user.decorator'
import { SessionAuthGuard } from './session-auth.guard'
import type { AuthenticatedRequest, CurrentUser as CurrentUserType } from './auth.types'

const passwordSessionSchema = z
  .object({
    identifier: z.string().trim().optional(),
    email: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    password: z.string().min(1, 'password is required'),
    next: z.string().trim().optional(),
  })
  .refine((value) => Boolean(value.identifier || value.email || value.phone), {
    message: 'identifier, email, or phone is required',
  })

const phoneCodeSchema = z.object({
  phone: z.string().trim(),
})

const registerSchema = z.object({
  name: z.string().trim(),
  phone: z.string().trim(),
  smsCode: z.string().trim(),
  email: z.string().trim().optional(),
  password: z.string(),
  next: z.string().trim().optional(),
})

const phoneSessionSchema = z.object({
  phone: z.string().trim(),
  smsCode: z.string().trim(),
  next: z.string().trim().optional(),
})

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(AuthRegistrationService) private readonly authRegistrationService: AuthRegistrationService,
  ) {}

  @Post('login/password-session')
  async loginWithPassword(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const payload = passwordSessionSchema.parse(body)
    const identifier = payload.identifier ?? payload.email ?? payload.phone
    const result = await this.authService.loginWithPassword(identifier!, payload.password)

    this.authService.setSessionCookie(reply, result.token, result.expiresAt)

    return {
      user: result.user,
      expiresAt: result.expiresAt.toISOString(),
      redirectTo:
        payload.next && payload.next.startsWith('/') ? payload.next : '/',
    }
  }

  @Post('register/phone-code')
  async sendRegisterCode(@Body() body: unknown) {
    const payload = phoneCodeSchema.parse(body)
    if (!payload.phone) {
      throw new UnauthorizedException('手机号不能为空')
    }

    if (isLocalAuthMockEnabled()) {
      await this.authRegistrationService.issueMockVerificationCode(payload.phone, 'register', getDevAuthCode())
      return buildDevPhoneCodeResponse()
    }

    await this.authRegistrationService.sendRegisterCode(payload.phone)
    return {
      message: '验证码已发送',
      data: {
        resendInSeconds: 60,
      },
    }
  }

  @Post('login/phone-code')
  async sendLoginCode(@Body() body: unknown) {
    const payload = phoneCodeSchema.parse(body)
    if (!payload.phone) {
      throw new UnauthorizedException('手机号不能为空')
    }

    if (isLocalAuthMockEnabled()) {
      await this.authRegistrationService.issueMockVerificationCode(payload.phone, 'login', getDevAuthCode())
      return buildDevPhoneCodeResponse()
    }

    await this.authRegistrationService.sendLoginCode(payload.phone)
    return {
      message: '验证码已发送',
      data: {
        resendInSeconds: 60,
      },
    }
  }

  @Post('register')
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const payload = registerSchema.parse(body)
    const result = await this.authRegistrationService.registerUser(
      {
        displayName: payload.name,
        phone: payload.phone,
        email: payload.email,
        password: payload.password,
      },
      payload.smsCode,
    )

    const session = await this.authService.createSessionForUser(result.user.id)
    this.authService.setSessionCookie(reply, session.token, session.expiresAt)

    return {
      redirectTo: payload.next && payload.next.startsWith('/') ? payload.next : '/',
      registered: true,
      user: {
        id: result.user.id,
        displayName: result.user.displayName,
        phone: result.user.phone,
        email: result.user.email,
      },
      organization: result.organization
        ? {
            id: result.organization.id,
            name: result.organization.name,
          }
        : null,
    }
  }

  @Post('login/phone-session')
  async loginWithPhoneSession(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const payload = phoneSessionSchema.parse(body)
    if (!payload.phone) {
      throw new UnauthorizedException('请输入手机号')
    }
    if (!/^\d{6}$/.test(payload.smsCode)) {
      throw new UnauthorizedException('请输入 6 位验证码')
    }

    const result = await this.authRegistrationService
      .loginWithPhoneCode(payload.phone, payload.smsCode, {
        autoCreateIfMissing: isLocalAuthMockEnabled(),
      })
      .catch((error) => {
        throw new UnauthorizedException(error instanceof Error ? error.message : '登录失败')
      })

    const session = await this.authService.createSessionForUser(result.user.id)
    this.authService.setSessionCookie(reply, session.token, session.expiresAt)

    return {
      redirectTo: payload.next && payload.next.startsWith('/') ? payload.next : '/',
    }
  }

  @Get('session')
  @UseGuards(SessionAuthGuard)
  async getCurrentSession(
    @Req() request: AuthenticatedRequest,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const session = await this.authService.getSession(request)
    return {
      authenticated: true,
      session: session ?? {
        id: 0,
        userId: currentUser.id,
        user: currentUser,
      },
    }
  }

  @Post('logout')
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.authService.logout(request)
    this.authService.clearSessionCookie(reply)
    return { success: true }
  }
}
