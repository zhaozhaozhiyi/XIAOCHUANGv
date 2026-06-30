'use client'

/**
 * MSWProvider — 在客户端启动 MSW worker
 *
 * 仅当 NEXT_PUBLIC_API_MOCKING === 'enabled' 时拉起；
 * 启动前不渲染 children（避免页面在 worker ready 前发出未被拦截的真实请求）。
 */

import { useEffect, useState } from 'react'

const MOCKING_ENABLED = process.env.NEXT_PUBLIC_API_MOCKING === 'enabled'

export function MSWProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!MOCKING_ENABLED)

  useEffect(() => {
    if (!MOCKING_ENABLED) return
    let cancelled = false

    // 动态 import 避免把 MSW 打到生产构建里
    void (async () => {
      try {
        const { worker } = await import('../../../mocks/browser')
        await worker.start({
          onUnhandledRequest: 'bypass', // 仅拦截画布 handlers 范围内的请求，其他放行
          serviceWorker: { url: '/mockServiceWorker.js' },
        })
        if (!cancelled) {
          console.info('[MSW] canvas mock worker started')
          setReady(true)
        }
      } catch (err) {
        console.error('[MSW] start failed:', err)
        if (!cancelled) setReady(true) // 即使 mock 起不来，也放行渲染（用户能看到真实接口的 404）
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) return null
  return <>{children}</>
}
