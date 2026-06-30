import fs from 'node:fs'
import { randomInt } from 'node:crypto'

import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const ADMIN_LOG_PATH = '/private/tmp/admin.log'
export const DEFAULT_CONSUMER_PHONE = process.env.E2E_CONSUMER_PHONE || '18811103664'
const DEFAULT_DEV_AUTH_CODE = process.env.DEV_AUTH_CODE || '123456'
const DEFAULT_NEXT_PATH = '/writing'
const E2E_PORT = process.env.E2E_PORT || '3001'

type SmsRecord = {
  scene: string
  phone: string
  code: string
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  const local = digits.startsWith('86') && digits.length === 13 ? digits.slice(2) : digits
  if (local.length < 7) return phone
  return `+86${local.slice(0, 3)}****${local.slice(-4)}`
}

function readAdminLog() {
  try {
    return fs.readFileSync(ADMIN_LOG_PATH, 'utf8')
  } catch {
    return ''
  }
}

function getAdminLogMtimeMs() {
  try {
    return fs.statSync(ADMIN_LOG_PATH).mtimeMs
  } catch {
    return 0
  }
}

function getLatestSmsRecord(phone: string, scene = 'login'): SmsRecord | null {
  const maskedPhone = maskPhone(phone)
  const content = readAdminLog()
  const pattern =
    /\[sms:mock\] verification code generated \{\s+scene: '([^']+)',\s+phone: '([^']+)',\s+code: '(\d+)',\s+minutes: \d+\s+\}/gms

  let match: RegExpExecArray | null = null
  let latest: SmsRecord | null = null
  while ((match = pattern.exec(content))) {
    const [, recordScene, recordPhone, code] = match
    if (recordScene === scene && recordPhone === maskedPhone) {
      latest = { scene: recordScene, phone: recordPhone, code }
    }
  }
  return latest
}

async function waitForSmsCode(phone: string, previousCode?: string | null, timeoutMs = 30_000, scene = 'login') {
  const start = Date.now()
  const previousMtimeMs = getAdminLogMtimeMs()
  while (Date.now() - start < timeoutMs) {
    // 优先等待日志刷新；若刷新延迟，也允许继续解析当前日志，减少偶发超时。
    const currentMtimeMs = getAdminLogMtimeMs()
    const latest = getLatestSmsRecord(phone, scene)
    if (latest && latest.code && latest.code !== previousCode) {
      return latest.code
    }
    if (currentMtimeMs <= previousMtimeMs && latest?.code) {
      return latest.code
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  const fallback = getLatestSmsRecord(phone, scene)
  if (fallback?.code) return fallback.code

  throw new Error(`未能在 ${timeoutMs}ms 内从 admin 日志读取短信验证码`)
}

function extractCodeFromPhoneCodeResponse(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as { data?: Record<string, unknown> }).data
  if (!data || typeof data !== 'object') return null
  const candidates = [data.code, data.smsCode, data.mockCode]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^\d{4,8}$/.test(candidate)) return candidate
  }
  return null
}

async function requestLoginSmsCode(page: Page, phone: string, previousCode?: string | null) {
  const response = await page.request.post('/api/v1/auth/login/phone-code', {
    data: { phone },
  })
  const payload = await response.json().catch(() => null)
  expect(response.ok(), `POST /api/v1/auth/login/phone-code -> ${response.status()}`).toBeTruthy()
  const codeFromResponse = extractCodeFromPhoneCodeResponse(payload)
  if (codeFromResponse) return codeFromResponse
  if (DEFAULT_DEV_AUTH_CODE) return DEFAULT_DEV_AUTH_CODE
  return waitForSmsCode(phone, previousCode, 30_000, 'login')
}

async function requestRegisterSmsCode(page: Page, phone: string, previousCode?: string | null) {
  const response = await page.request.post('/api/v1/auth/register/phone-code', {
    data: { phone },
  })
  const payload = await response.json().catch(() => null)
  expect(response.ok(), `POST /api/v1/auth/register/phone-code -> ${response.status()}`).toBeTruthy()
  const codeFromResponse = extractCodeFromPhoneCodeResponse(payload)
  if (codeFromResponse) return codeFromResponse
  if (DEFAULT_DEV_AUTH_CODE) return DEFAULT_DEV_AUTH_CODE
  return waitForSmsCode(phone, previousCode, 30_000, 'register')
}

async function loginWithSmsSession(page: Page, payload: { phone: string; smsCode: string; next: string }) {
  const response = await page.request.post('/api/v1/auth/login/phone-session', {
    data: payload,
  })
  const json = await response.json().catch(() => null)
  if (!response.ok()) {
    return {
      ok: false,
      redirectTo: payload.next,
      status: response.status(),
      error: typeof json?.error === 'string' ? json.error : '登录失败',
    }
  }
  const redirectTo = typeof json?.data?.redirectTo === 'string' ? json.data.redirectTo : payload.next
  return { ok: true, redirectTo, status: response.status(), error: null }
}

async function registerWithSmsSession(page: Page, payload: {
  name: string
  phone: string
  smsCode: string
  email: string
  password: string
  next: string
}) {
  const response = await page.request.post('/api/v1/auth/register', {
    data: payload,
  })
  const json = await response.json().catch(() => null)
  if (!response.ok()) {
    return {
      ok: false,
      redirectTo: payload.next,
      status: response.status(),
      error: typeof json?.message === 'string'
        ? json.message
        : typeof json?.error === 'string'
          ? json.error
          : '注册失败',
    }
  }

  const redirectTo = typeof json?.data?.redirectTo === 'string' ? json.data.redirectTo : payload.next
  return { ok: true, redirectTo, status: response.status(), error: null }
}

function buildUniqueConsumerProfile() {
  const timePart = String(Date.now() % 10_000_000).padStart(7, '0')
  const randomPart = String(randomInt(10))
  const suffix = `${timePart}${randomPart}`
  const emailSuffix = `${suffix}-${randomInt(1000, 10_000)}`
  return {
    name: `e2e用户${suffix.slice(-4)}`,
    phone: `139${suffix}`,
    email: `e2e-${emailSuffix}@example.com`,
    password: `E2ePass!${suffix}`,
  }
}

export async function registerAndLoginFreshConsumer(page: Page, options?: { next?: string }) {
  const next = options?.next || DEFAULT_NEXT_PATH
  const profile = buildUniqueConsumerProfile()
  await completePhoneRegistration(page, profile, next)

  return profile
}

export async function loginAsConsumer(page: Page, options?: { phone?: string; next?: string }) {
  const phone = options?.phone || DEFAULT_CONSUMER_PHONE
  const next = options?.next || DEFAULT_NEXT_PATH
  await completePhoneLogin(page, phone, next)
}

async function completePhoneLogin(page: Page, phone: string, next: string) {
  const previousCode = getLatestSmsRecord(phone, 'login')?.code || null
  const firstCode = await requestLoginSmsCode(page, phone, previousCode)
  let loginResult = await loginWithSmsSession(page, { phone, smsCode: firstCode, next })

  if (!loginResult.ok) {
    const secondCode = await requestLoginSmsCode(page, phone, firstCode)
    loginResult = await loginWithSmsSession(page, { phone, smsCode: secondCode, next })
  }

  expect(
    loginResult.ok,
    `POST /api/v1/auth/login/phone-session -> ${loginResult.status}: ${loginResult.error || 'unknown error'}`,
  ).toBeTruthy()

  await expect
    .poll(async () => {
      const response = await page.request.get('/api/v1/auth/session')
      const payload = await response.json().catch(() => null)
      return Boolean(payload?.data?.authenticated)
    }, { timeout: 15_000 })
    .toBeTruthy()

  await page.goto(loginResult.redirectTo)
  await expect(page).toHaveURL(new RegExp(`127\\.0\\.0\\.1:${E2E_PORT}${next}|localhost:${E2E_PORT}${next}`), {
    timeout: 45_000,
  })
}

async function completePhoneRegistration(
  page: Page,
  profile: { name: string; phone: string; email: string; password: string },
  next: string,
) {
  const previousCode = getLatestSmsRecord(profile.phone, 'register')?.code || null
  const firstCode = await requestRegisterSmsCode(page, profile.phone, previousCode)
  let registerResult = await registerWithSmsSession(page, {
    ...profile,
    smsCode: firstCode,
    next,
  })

  if (!registerResult.ok) {
    const secondCode = await requestRegisterSmsCode(page, profile.phone, firstCode)
    registerResult = await registerWithSmsSession(page, {
      ...profile,
      smsCode: secondCode,
      next,
    })
  }

  expect(
    registerResult.ok,
    `POST /api/v1/auth/register -> ${registerResult.status}: ${registerResult.error || 'unknown error'}`,
  ).toBeTruthy()

  await expect
    .poll(async () => {
      const response = await page.request.get('/api/v1/auth/session')
      const payload = await response.json().catch(() => null)
      return Boolean(payload?.data?.authenticated)
    }, { timeout: 15_000 })
    .toBeTruthy()

  await page.goto(registerResult.redirectTo)
  await expect(page).toHaveURL(new RegExp(`127\\.0\\.0\\.1:${E2E_PORT}${next}|localhost:${E2E_PORT}${next}`), {
    timeout: 45_000,
  })
}
