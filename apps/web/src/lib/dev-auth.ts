function isStrictEnabledFlag(value: string | undefined) {
  return value?.trim() === '1'
}

export function isLocalAuthBypassEnabled(env = process.env): boolean {
  if (env.NODE_ENV === 'production') return false
  return isStrictEnabledFlag(env.E2E_AUTH_MOCK) || isStrictEnabledFlag(env.DEV_AUTH_BYPASS)
}

export function readDevAuthCode(env = process.env): string {
  const code = String(env.DEV_AUTH_CODE || '').trim()
  return /^\d{6}$/.test(code) ? code : ''
}

export function readDevAuthPhone(env = process.env): string {
  const phone = String(env.DEV_AUTH_PHONE || '').trim()
  return /^1\d{10}$/.test(phone) ? phone : ''
}

export function isLocalAuthCodeMockEnabled(env = process.env): boolean {
  if (env.NODE_ENV === 'production') return false
  return Boolean(readDevAuthCode(env)) || isLocalAuthBypassEnabled(env)
}

export function buildDevAuthHint(env = process.env): string {
  if (!isLocalAuthCodeMockEnabled(env)) return ''

  const code = readDevAuthCode(env)
  const phone = readDevAuthPhone(env)

  if (!code) {
    return '本地开发模式已开启，请在环境变量中配置 6 位 DEV_AUTH_CODE。'
  }

  if (phone) {
    return `本地开发模式：测试手机号 ${phone} 可使用验证码 ${code} 登录（无需短信）`
  }

  return `本地开发模式：可使用验证码 ${code} 登录（无需短信）`
}

export function getDevAuthPublicConfig(env = process.env) {
  return {
    enabled: isLocalAuthCodeMockEnabled(env),
    phone: readDevAuthPhone(env),
    code: readDevAuthCode(env),
    hint: buildDevAuthHint(env),
  }
}
