function hasValidDevAuthCode() {
  return /^\d{6}$/.test(process.env.DEV_AUTH_CODE?.trim() || '')
}

export function isLocalAuthBypassEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (process.env.E2E_AUTH_MOCK === '1') return true
  return process.env.DEV_AUTH_BYPASS === '1'
}

export function isLocalAuthCodeMockEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return hasValidDevAuthCode() || isLocalAuthBypassEnabled()
}

export function getDevAuthCode(): string {
  const code = process.env.DEV_AUTH_CODE?.trim()
  if (/^\d{6}$/.test(code || '')) return code!
  throw new Error('DEV_AUTH_CODE must be a 6-digit code when local auth mock is enabled')
}

export function buildDevPhoneCodeResponse() {
  const code = getDevAuthCode()
  return {
    message: `本地开发：验证码为 ${code}，无需真实短信`,
    data: {
      resendInSeconds: 60,
      mockCode: code,
    },
  }
}
