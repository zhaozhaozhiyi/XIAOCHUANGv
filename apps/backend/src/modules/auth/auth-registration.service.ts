import { randomBytes } from 'node:crypto'

import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { Inject, Injectable } from '@nestjs/common'

import { DatabaseService } from '../../db/database.service'
import {
  organizationMembers,
  organizations,
  phoneVerificationCodes,
  subscriptionPlans,
  subscriptions,
  users,
} from '../../db/schema'
import { generateRandomCode, hashPassword, verifyPassword } from './password'
import { sendVerificationSms, type SmsPurpose } from './auth-sms'

const VERIFICATION_CODE_TTL_MS = 5 * 60 * 1000
const DEFAULT_SUBSCRIPTION_PLAN = 'free'

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function normalizePhone(phone: string) {
  return phone.trim()
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function buildWorkspaceSlug(userId: number, userName?: string | null) {
  const normalized = (userName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const namePart = normalized || 'user'
  const uniqueSuffix = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  return `${namePart}-${userId}-${uniqueSuffix}`
}

@Injectable()
export class AuthRegistrationService {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  async issueMockVerificationCode(phone: string, purpose: SmsPurpose, code: string) {
    const normalizedPhone = normalizePhone(phone)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + VERIFICATION_CODE_TTL_MS)

    await this.databaseService.db.insert(phoneVerificationCodes).values({
      phone: normalizedPhone,
      purpose,
      code,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })

    return { code, expiresAt }
  }

  async sendRegisterCode(phone: string) {
    const normalizedPhone = normalizePhone(phone)
    const [existing] = await this.databaseService.db
      .select()
      .from(users)
      .where(and(eq(users.phone, normalizedPhone), isNull(users.deletedAt)))
      .limit(1)

    if (existing) {
      throw new Error('该手机号已被注册')
    }

    await this.sendCodeForPurpose(normalizedPhone, 'register')
  }

  async sendLoginCode(phone: string) {
    const normalizedPhone = normalizePhone(phone)
    const [existing] = await this.databaseService.db
      .select()
      .from(users)
      .where(and(eq(users.phone, normalizedPhone), isNull(users.deletedAt)))
      .limit(1)

    if (!existing) {
      throw new Error('该手机号未注册，请先注册')
    }

    await this.sendCodeForPurpose(normalizedPhone, 'login')
  }

  async registerUser(options: {
    displayName?: string
    phone?: string
    email?: string
    password?: string
  }, code?: string) {
    const displayName = options.displayName?.trim() || ''
    const phone = options.phone ? normalizePhone(options.phone) : ''
    const email = options.email ? normalizeEmail(options.email) : ''
    const password = options.password || ''

    if (!phone) throw new Error('手机号不能为空')
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error('请输入有效的中国大陆手机号')
    if (!code || !/^\d{6}$/.test(code)) throw new Error('请输入 6 位短信验证码')
    if (!password || password.trim().length < 8) throw new Error('密码至少需要 8 位')
    if (email && !isValidEmail(email)) throw new Error('邮箱格式不正确')

    await this.validateSmsCode(phone, code, 'register')

    const [existingPhone] = await this.databaseService.db
      .select()
      .from(users)
      .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
      .limit(1)

    if (existingPhone) {
      throw new Error('该手机号已被注册')
    }

    if (email) {
      const [existingEmail] = await this.databaseService.db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)))
        .limit(1)
      if (existingEmail) throw new Error('该邮箱已被注册')
    }

    const resolvedDisplayName = displayName || (email ? email.split('@')[0] : `用户${phone.slice(-4)}`)
    const passwordHash = hashPassword(password)

    const [newUser] = await this.databaseService.db
      .insert(users)
      .values({
        adminUserId: null,
        accountType: email ? 'phone+email' : 'phone',
        displayName: resolvedDisplayName,
        phone,
        email: email || null,
        passwordHash,
        role: 'user',
        status: 'active',
      })
      .returning()

    if (!newUser) {
      throw new Error('创建用户失败')
    }

    const verification = await this.loadValidVerificationCode(phone, 'register', code)
    if (verification) {
      await this.markVerificationCodeUsed(verification.id)
    }

    const organization = await this.createPersonalOrganization(newUser.id, resolvedDisplayName)

    return {
      user: newUser,
      organization,
    }
  }

  async loginWithEmailPassword(identifier: string, password: string) {
    const normalized = identifier.trim()
    const isPhone = /^1[3-9]\d{9}$/.test(normalized)
    const isEmail = isValidEmail(normalized)

    if (!isPhone && !isEmail) {
      throw new Error('请输入正确的手机号或邮箱')
    }

    const [user] = await this.databaseService.db
      .select()
      .from(users)
      .where(
        and(
          isPhone ? eq(users.phone, normalized) : eq(users.email, normalizeEmail(normalized)),
          isNull(users.deletedAt),
        ),
      )
      .limit(1)

    if (!user) throw new Error('用户不存在')
    if (!user.passwordHash) throw new Error('该账户未设置密码，请使用其他方式登录')
    if (!verifyPassword(password, user.passwordHash)) throw new Error('密码错误')

    await this.ensureUserOrganization(user.id)
    return {
      user,
      organization: await this.getPrimaryOrganization(user.id),
    }
  }

  async loginWithPhoneCode(phone: string, code: string, options?: { autoCreateIfMissing?: boolean }) {
    const normalizedPhone = normalizePhone(phone)
    const verification = await this.loadValidVerificationCode(normalizedPhone, 'login', code)
    if (!verification) {
      throw new Error('验证码无效或已过期')
    }

    let [user] = await this.databaseService.db
      .select()
      .from(users)
      .where(and(eq(users.phone, normalizedPhone), isNull(users.deletedAt)))
      .limit(1)

    if (!user) {
      if (!options?.autoCreateIfMissing) {
        throw new Error('用户不存在，请先注册')
      }
      user = await this.createPhoneOnlyUser(normalizedPhone)
    }

    await this.markVerificationCodeUsed(verification.id)
    await this.ensureUserOrganization(user.id)

    return {
      user,
      organization: await this.getPrimaryOrganization(user.id),
    }
  }

  private async createPhoneOnlyUser(phone: string) {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      throw new Error('请输入有效的中国大陆手机号')
    }

    const displayName = `用户${phone.slice(-4)}`
    const [newUser] = await this.databaseService.db
      .insert(users)
      .values({
        adminUserId: null,
        accountType: 'phone',
        displayName,
        phone,
        email: null,
        passwordHash: null,
        role: 'user',
        status: 'active',
      })
      .returning()

    if (!newUser) {
      throw new Error('创建用户失败')
    }

    await this.createPersonalOrganization(newUser.id, displayName)
    return newUser
  }

  private async sendCodeForPurpose(phone: string, purpose: SmsPurpose) {
    const code = generateRandomCode()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + VERIFICATION_CODE_TTL_MS)

    await this.databaseService.db.insert(phoneVerificationCodes).values({
      phone,
      purpose,
      code,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })

    await sendVerificationSms({
      phone,
      code,
      purpose,
    })
  }

  private async loadValidVerificationCode(phone: string, purpose: SmsPurpose, code: string) {
    const now = new Date()
    const [record] = await this.databaseService.db
      .select()
      .from(phoneVerificationCodes)
      .where(
        and(
          eq(phoneVerificationCodes.phone, normalizePhone(phone)),
          eq(phoneVerificationCodes.purpose, purpose),
          eq(phoneVerificationCodes.code, code),
          isNull(phoneVerificationCodes.usedAt),
          gt(phoneVerificationCodes.expiresAt, now),
        ),
      )
      .orderBy(desc(phoneVerificationCodes.id))
      .limit(1)

    return record || null
  }

  private async validateSmsCode(phone: string, code: string, purpose: SmsPurpose) {
    const record = await this.loadValidVerificationCode(phone, purpose, code)
    if (!record) {
      throw new Error('验证码无效或已过期')
    }
  }

  private async markVerificationCodeUsed(id: number) {
    const now = new Date()
    await this.databaseService.db
      .update(phoneVerificationCodes)
      .set({
        usedAt: now,
        updatedAt: now,
      })
      .where(eq(phoneVerificationCodes.id, id))
  }

  private async ensureDefaultSubscriptionPlan() {
    const [existingPlan] = await this.databaseService.db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.name, DEFAULT_SUBSCRIPTION_PLAN))
      .limit(1)

    if (existingPlan) return existingPlan

    await this.databaseService.db
      .insert(subscriptionPlans)
      .values({
        name: DEFAULT_SUBSCRIPTION_PLAN,
        displayName: '免费版',
        description: '默认个人工作室方案',
        price: 0,
        priceUnit: 'month',
        videoQuotaMonthly: 3000,
        imageQuotaMonthly: 15000,
        storageQuotaMb: 10240,
        aiTokensQuotaMonthly: 3000000,
        features: JSON.stringify(['workspace', 'basic-auth', 'default-quota']),
        isActive: true,
        sortOrder: 0,
      })

    const [plan] = await this.databaseService.db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.name, DEFAULT_SUBSCRIPTION_PLAN))
      .limit(1)

    if (!plan) throw new Error('默认订阅方案初始化失败')
    return plan
  }

  private async ensureWorkspaceSubscription(userId: number, organizationId: number) {
    await this.ensureDefaultSubscriptionPlan()

    const [existingSubscription] = await this.databaseService.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1)

    if (existingSubscription) return existingSubscription

    await this.databaseService.db.insert(subscriptions).values({
      userId,
      organizationId,
      planName: DEFAULT_SUBSCRIPTION_PLAN,
      status: 'active',
      startedAt: new Date(),
    })

    const [subscription] = await this.databaseService.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1)

    if (!subscription) throw new Error('默认订阅创建失败')
    return subscription
  }

  private async createPersonalOrganization(userId: number, userName?: string | null) {
    await this.ensureDefaultSubscriptionPlan()

    const orgName = userName?.trim() ? `${userName.trim()}的工作室` : '我的工作室'
    const slug = buildWorkspaceSlug(userId, userName)

    const [organization] = await this.databaseService.db
      .insert(organizations)
      .values({
        name: orgName,
        slug,
        plan: DEFAULT_SUBSCRIPTION_PLAN,
        settings: JSON.stringify({}),
      })
      .returning()

    if (!organization) throw new Error('创建工作室失败')

    await this.databaseService.db.insert(organizationMembers).values({
      organizationId: organization.id,
      userId,
      role: 'owner',
    })

    await this.ensureWorkspaceSubscription(userId, organization.id)
    return organization
  }

  async ensureUserOrganization(userId: number) {
    const [user] = await this.databaseService.db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!user) return null

    const [membership] = await this.databaseService.db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .limit(1)

    if (!membership) {
      return this.createPersonalOrganization(userId, user.displayName)
    }

    await this.ensureWorkspaceSubscription(userId, membership.organizationId)

    const [organization] = await this.databaseService.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, membership.organizationId))
      .limit(1)

    return organization || null
  }

  private async getPrimaryOrganization(userId: number) {
    const [member] = await this.databaseService.db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .limit(1)

    if (!member) return null

    const [organization] = await this.databaseService.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, member.organizationId))
      .limit(1)

    return organization || null
  }
}
