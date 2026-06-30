'use client'

import { FormEvent, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { friendlyFetchErrorMessage } from '@/lib/client-fetch-error'

export type DevAuthConfig = {
  enabled: boolean
  phone: string
  code: string
  hint: string
}

type LoginFormProps = {
  loginError: string
  next: string
  initialPhone?: string
  devAuth?: DevAuthConfig
}

export function LoginForm({ loginError, next, initialPhone = '', devAuth }: LoginFormProps) {
  const devEnabled = devAuth?.enabled === true
  const defaultPhone = devEnabled ? devAuth.phone : initialPhone
  const [activeTab, setActiveTab] = useState<'sms' | 'password'>('sms')

  // 短信验证码登录状态
  const [phone, setPhone] = useState(defaultPhone.replace(/\D/g, '').slice(0, 11))
  const [smsCode, setSmsCode] = useState(devEnabled ? devAuth.code : '')
  const [smsError, setSmsError] = useState(loginError)
  const [smsSuccessMessage, setSmsSuccessMessage] = useState('')
  const [isSendingSmsCode, setIsSendingSmsCode] = useState(false)
  const [isSmsSubmitting, setIsSmsSubmitting] = useState(false)
  const [smsCooldown, setSmsCooldown] = useState(0)

  // 密码登录状态
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [pwdError, setPwdError] = useState('')
  const [isPwdSubmitting, setIsPwdSubmitting] = useState(false)

  useEffect(() => {
    if (smsCooldown <= 0) return
    const timer = window.setTimeout(() => {
      setSmsCooldown((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [smsCooldown])

  // 发送验证码
  async function handleSendCode() {
    const normalizedPhone = phone.trim()
    setSmsError('')
    setSmsSuccessMessage('')

    if (!/^1\d{10}$/.test(normalizedPhone)) {
      setSmsError('请输入有效的中国大陆手机号')
      return
    }

    setIsSendingSmsCode(true)
    try {
      const response = await fetch('/api/v1/auth/login/phone-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizedPhone }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(json?.message || '验证码发送失败，请稍后重试')
      }
      // 如果是开发模式，从响应中获取 mock code
      const resendIn = Number(json?.data?.data?.resendInSeconds) || 60
      const mockCode = typeof json?.data?.data?.mockCode === 'string' ? json.data.data.mockCode : ''
      setSmsCooldown(resendIn)
      if (mockCode) setSmsCode(mockCode)
      setSmsSuccessMessage(json?.data?.message || '验证码已发送，请查收短信')
    } catch (sendError) {
      setSmsError(friendlyFetchErrorMessage(sendError, '验证码发送失败，请稍后重试'))
    } finally {
      setIsSendingSmsCode(false)
    }
  }

  // 短信验证码登录
  async function handleSmsLogin() {
    const normalizedPhone = phone.trim()
    const normalizedCode = smsCode.trim()
    setSmsError('')
    setSmsSuccessMessage('')

    if (!/^1\d{10}$/.test(normalizedPhone)) {
      setSmsError('请输入有效的中国大陆手机号')
      return
    }
    if (!/^\d{6}$/.test(normalizedCode)) {
      setSmsError('请输入 6 位验证码')
      return
    }

    setIsSmsSubmitting(true)
    try {
      const response = await fetch('/api/v1/auth/login/phone-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizedPhone, smsCode: normalizedCode, next }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(json?.message || '登录失败，请稍后重试')
      }
      const redirectTo = typeof json?.data?.redirectTo === 'string' ? json.data.redirectTo : '/'
      window.location.href = redirectTo
    } catch (submitError) {
      setSmsError(friendlyFetchErrorMessage(submitError, '登录失败，请稍后重试'))
    } finally {
      setIsSmsSubmitting(false)
    }
  }

  // 密码登录
  async function handlePasswordLogin() {
    const normalizedIdentifier = identifier.trim()
    const normalizedPassword = password
    setPwdError('')

    if (!normalizedIdentifier) {
      setPwdError('请输入手机号或邮箱')
      return
    }
    if (!normalizedPassword) {
      setPwdError('请输入密码')
      return
    }

    setIsPwdSubmitting(true)
    try {
      const response = await fetch('/api/v1/auth/login/password-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: normalizedIdentifier, password: normalizedPassword, next }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(json?.message || '登录失败，请稍后重试')
      }
      const redirectTo = typeof json?.data?.redirectTo === 'string' ? json.data.redirectTo : '/'
      window.location.href = redirectTo
    } catch (submitError) {
      setPwdError(friendlyFetchErrorMessage(submitError, '登录失败，请稍后重试'))
    } finally {
      setIsPwdSubmitting(false)
    }
  }

  function handleSmsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSmsSubmitting) return
    void handleSmsLogin()
  }

  function handlePwdSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPwdSubmitting) return
    void handlePasswordLogin()
  }

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'sms' | 'password')}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="sms">验证码登录</TabsTrigger>
        <TabsTrigger value="password">密码登录</TabsTrigger>
      </TabsList>

      {/* 短信验证码登录 */}
      <TabsContent value="sms" className="mt-4">
        <form onSubmit={handleSmsSubmit}>
          <div className="flex flex-col gap-6">
            <div className="space-y-2">
              <label htmlFor="phone" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-text-1/90">
                手机号
              </label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                placeholder="请输入手机号，如 13812345678"
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
                className="h-12 rounded-2xl text-[15px]"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="smsCode" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-text-1/90">
                验证码
              </label>
              <div className="flex gap-3">
                <Input
                  id="smsCode"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="请输入 6 位验证码"
                  value={smsCode}
                  onChange={(event) => setSmsCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="h-12 flex-1 rounded-2xl text-[15px] tracking-[0.2em]"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={isSendingSmsCode || smsCooldown > 0}
                  className="h-12 min-w-[126px] rounded-2xl border-border/75 bg-bg-0/70 transition duration-200 hover:bg-bg-0"
                >
                  {isSendingSmsCode ? '发送中...' : smsCooldown > 0 ? `${smsCooldown}s` : '发送验证码'}
                </Button>
              </div>
            </div>
          </div>

          {smsSuccessMessage || smsError ? (
            <div className="mt-4 space-y-2">
              {smsSuccessMessage ? (
                <p className="rounded-xl border border-success/30 bg-success-bg px-4 py-3 text-sm leading-6 text-success">
                  {smsSuccessMessage}
                </p>
              ) : null}
              {smsError ? (
                <p className="rounded-xl border border-error/30 bg-error-bg px-4 py-2.5 text-sm text-error">{smsError}</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3">
            <Button
              type="submit"
              variant="premium"
              disabled={isSmsSubmitting}
              className="h-11 w-full rounded-2xl"
            >
              {isSmsSubmitting ? '登录中...' : '登录'}
            </Button>
          </div>
          {devEnabled && devAuth.hint ? (
            <p className="mt-3 rounded-xl border border-accent/25 bg-accent-bg/60 px-3 py-2 text-center text-xs leading-5 text-text-2">
              {devAuth.hint}
            </p>
          ) : null}
          <p className="mt-3 text-center text-xs text-text-3">手机号验证码用于已注册用户登录，首次使用请先完成注册。</p>
        </form>
      </TabsContent>

      {/* 密码登录 */}
      <TabsContent value="password" className="mt-4">
        <form onSubmit={handlePwdSubmit}>
          <div className="flex flex-col gap-6">
            <div className="space-y-2">
              <label htmlFor="identifier" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-text-1/90">
                手机号 / 邮箱
              </label>
              <Input
                id="identifier"
                type="text"
                autoComplete="username"
                placeholder="请输入手机号或邮箱"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                className="h-12 rounded-2xl text-[15px]"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-text-1/90">
                密码
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 rounded-2xl text-[15px]"
              />
            </div>
          </div>

          {pwdError ? (
            <div className="mt-4">
              <p className="rounded-xl border border-error/30 bg-error-bg px-4 py-2.5 text-sm text-error">{pwdError}</p>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3">
            <Button
              type="submit"
              variant="premium"
              disabled={isPwdSubmitting}
              className="h-11 w-full rounded-2xl"
            >
              {isPwdSubmitting ? '登录中...' : '登录'}
            </Button>
          </div>
          <p className="mt-3 text-center text-xs text-text-3">
            <a href="/register" className="text-accent hover:underline">
              还没有账号？立即注册
            </a>
          </p>
        </form>
      </TabsContent>
    </Tabs>
  )
}
