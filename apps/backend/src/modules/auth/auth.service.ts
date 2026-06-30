import crypto from 'node:crypto'

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'

import { DatabaseService } from '../../db/database.service'
import { authSessions, users } from '../../db/schema'
import { generateSessionToken } from './password'
import type { AuthSession, AuthenticatedRequest, CurrentUser } from './auth.types'
import { AuthRegistrationService } from './auth-registration.service'

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(AuthRegistrationService) private readonly authRegistrationService: AuthRegistrationService,
  ) {}

  get sessionCookieName() {
    return this.configService.get<string>('SESSION_COOKIE_NAME', 'xiaochuang_session')
  }

  get sessionDurationMs() {
    const days = this.configService.get<number>('SESSION_DURATION_DAYS', 7)
    return days * 24 * 60 * 60 * 1000
  }

  async loginWithPassword(identifier: string, password: string) {
    const result = await this.authRegistrationService
      .loginWithEmailPassword(identifier, password)
      .catch((error) => {
        throw new UnauthorizedException(error instanceof Error ? error.message : '用户名或密码错误')
      })

    const token = generateSessionToken()
    const tokenHash = this.hashToken(token)
    const now = new Date()
    const expiresAt = new Date(Date.now() + this.sessionDurationMs)

    await this.databaseService.db.insert(authSessions).values({
      userId: result.user.id,
      sessionTokenHash: tokenHash,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    })

    return {
      token,
      expiresAt,
      user: this.toCurrentUser(result.user),
    }
  }

  async createSessionForUser(userId: number) {
    const token = generateSessionToken()
    const tokenHash = this.hashToken(token)
    const now = new Date()
    const expiresAt = new Date(Date.now() + this.sessionDurationMs)

    await this.databaseService.db.insert(authSessions).values({
      userId,
      sessionTokenHash: tokenHash,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    })

    return { token, expiresAt }
  }

  async getSession(request: AuthenticatedRequest): Promise<AuthSession | null> {
    const token = request.cookies?.[this.sessionCookieName]
    if (!token) {
      return null
    }

    const tokenHash = this.hashToken(token)
    const [row] = await this.databaseService.db
      .select({
        sessionId: authSessions.id,
        userId: users.id,
        adminUserId: users.adminUserId,
        accountType: users.accountType,
        role: users.role,
        displayName: users.displayName,
        email: users.email,
        phone: users.phone,
        status: users.status,
        lastSeenAt: authSessions.lastSeenAt,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(and(eq(authSessions.sessionTokenHash, tokenHash), isNull(authSessions.revokedAt)))

    if (!row) {
      return null
    }

    const lastSeenAt = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0
    if (Date.now() - lastSeenAt > 60_000) {
      const now = new Date()
      await this.databaseService.db
        .update(authSessions)
        .set({
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(authSessions.id, row.sessionId))
    }

    return {
      id: row.sessionId,
      userId: row.userId,
      user: {
        id: row.userId,
        adminUserId: row.adminUserId,
        accountType: row.accountType,
        role: row.role,
        displayName: row.displayName,
        email: row.email,
        phone: row.phone,
        status: row.status,
      },
    }
  }

  async logout(request: AuthenticatedRequest) {
    const token = request.cookies?.[this.sessionCookieName]
    if (!token) return

    const now = new Date()
    await this.databaseService.db
      .update(authSessions)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(eq(authSessions.sessionTokenHash, this.hashToken(token)))
  }

  setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
    reply.setCookie(this.sessionCookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.configService.get('NODE_ENV') === 'production',
      path: '/',
      expires: expiresAt,
    })
  }

  clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie(this.sessionCookieName, {
      path: '/',
    })
  }

  private hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex')
  }

  private toCurrentUser(row: typeof users.$inferSelect): CurrentUser {
    return {
      id: row.id,
      adminUserId: row.adminUserId,
      accountType: row.accountType,
      role: row.role,
      displayName: row.displayName,
      email: row.email ?? null,
      phone: row.phone ?? null,
      status: row.status,
    }
  }
}
