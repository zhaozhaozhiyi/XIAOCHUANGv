'use client'

import { useEffect } from 'react'

export function LogoutClient() {
  useEffect(() => {
    let active = true

    async function run() {
      try {
        await fetch('/api/v1/auth/logout', { method: 'POST' })
      } finally {
        if (active) window.location.href = '/login'
      }
    }

    void run()
    return () => {
      active = false
    }
  }, [])

  return <p className="text-sm text-text-2">正在退出登录…</p>
}
