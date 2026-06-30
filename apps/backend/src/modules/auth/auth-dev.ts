export function isLocalAuthMockEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (process.env.E2E_AUTH_MOCK === '1') return true
  return process.env.DEV_AUTH_BYPASS !== '0'
}

export function getDevAuthCode(): string {
  const code = process.env.DEV_AUTH_CODE?.trim()
  return /^\d{6}$/.test(code || '') ? code! : '123456'
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
