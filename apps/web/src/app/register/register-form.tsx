'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { friendlyFetchErrorMessage } from '@/lib/client-fetch-error'

export function RegisterForm({ next }: { next: string }) {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '',
    phone: '',
    smsCode: '',
    email: '',
    password: '',
  })
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function sendCode() {
    if (!form.phone.trim()) {
      toast.error('请先输入手机号')
      return
    }
    try {
      setSending(true)
      const response = await fetch('/api/v1/auth/register/phone-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone.trim() }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.message || json.error || '验证码发送失败')
      toast.success('验证码已发送')
    } catch (error) {
      toast.error(friendlyFetchErrorMessage(error, '验证码发送失败'))
    } finally {
      setSending(false)
    }
  }

  async function submit() {
    try {
      setSubmitting(true)
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, next }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.message || json.error || '注册失败')
      toast.success('注册成功')
      const redirectTo = typeof json?.data?.redirectTo === 'string' ? json.data.redirectTo : next
      window.location.href = redirectTo
    } catch (error) {
      toast.error(friendlyFetchErrorMessage(error, '注册失败'))
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    void submit()
  }

  return (
    <form className="space-y-4.5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label htmlFor="name" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-text-1/90">
          昵称
        </label>
        <Input
          id="name"
          value={form.name}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          placeholder="请输入昵称"
          className="h-12 rounded-2xl border-border/75 bg-bg-input/88 px-4 text-[15px] focus-visible:ring-2"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="phone" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-text-1/90">
          手机号
        </label>
        <Input
          id="phone"
          value={form.phone}
          onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value.replace(/\D/g, '').slice(0, 11) }))}
          placeholder="请输入手机号"
          className="h-12 rounded-2xl border-border/75 bg-bg-input/88 px-4 text-[15px] focus-visible:ring-2"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="smsCode" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-text-1/90">
          验证码
        </label>
        <div className="flex gap-3">
          <Input
            id="smsCode"
            value={form.smsCode}
            onChange={(event) => setForm((prev) => ({ ...prev, smsCode: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
            placeholder="请输入短信验证码"
            className="h-12 rounded-2xl border-border/75 bg-bg-input/88 px-4 text-[15px] focus-visible:ring-2"
          />
          <Button
            type="button"
            variant="outline"
            onClick={sendCode}
            disabled={sending}
            className="h-12 min-w-[126px] rounded-2xl border-border/75 bg-bg-0/70 transition duration-200 hover:bg-bg-0"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : '发送验证码'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-text-1/90">
          邮箱
        </label>
        <Input
          id="email"
          value={form.email}
          onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
          placeholder="请输入邮箱（可选）"
          className="h-12 rounded-2xl border-border/75 bg-bg-input/88 px-4 text-[15px] focus-visible:ring-2"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-text-1/90">
          密码
        </label>
        <Input
          id="password"
          type="password"
          value={form.password}
          onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
          placeholder="请输入密码（至少 8 位）"
          className="h-12 rounded-2xl border-border/75 bg-bg-input/88 px-4 text-[15px] focus-visible:ring-2"
        />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <Button type="submit" variant="premium" className="h-11 w-full rounded-2xl" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : '完成注册并继续登录'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full rounded-2xl border-border/70 bg-bg-0/68 transition duration-200 hover:bg-bg-0/92"
          onClick={() => router.push(`/login?next=${encodeURIComponent(next)}`)}
        >
          返回登录
        </Button>
      </div>
      <p className="pt-1 text-center text-xs text-text-3">验证码用于校验手机号归属，注册成功后会直接进入你的工作台。</p>
    </form>
  )
}
