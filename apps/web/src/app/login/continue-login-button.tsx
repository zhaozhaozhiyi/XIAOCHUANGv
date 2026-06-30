'use client'

import { useState } from 'react'

import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'

/** Full document navigation so App Router does not treat the OAuth kickoff like a soft client transition. */
export function ContinueLoginButton({ href, className }: { href: string; className?: string }) {
  const [busy, setBusy] = useState(false)

  return (
    <Button
      type="button"
      className={cn('w-full', className)}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        window.location.assign(href)
      }}
    >
      {busy ? '正在登录…' : '登录'}
    </Button>
  )
}
