'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { QUICK_CREATE_PENDING_KEY } from '@/components/create/quick-create-pending'
import type { ComposerSubmitPayload, ModelSelectOption } from '@/components/create/input-composer-types'

const HOME_COMPOSER_FALLBACK = (
  <div className="h-24 animate-pulse rounded-[var(--radius-lg)] bg-bg-2" />
)

function loadInputComposer() {
  return import('@/components/create/input-composer').then((mod) => ({
    default: mod.InputComposer,
  }))
}

const InputComposer = dynamic(
  loadInputComposer,
  {
    ssr: false,
    loading: () => HOME_COMPOSER_FALLBACK,
  },
)

export function HomeInputComposer({
  initialImageModelOptions = [],
}: {
  initialImageModelOptions?: ModelSelectOption[]
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [composerReady, setComposerReady] = useState(false)

  useEffect(() => {
    router.prefetch('/create/video')
  }, [router])

  useEffect(() => {
    if (composerReady) return

    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    let timeoutId: number | null = null
    let idleId: number | null = null

    const mountComposer = () => {
      void loadInputComposer()
      setComposerReady(true)
    }

    if (typeof win.requestIdleCallback === 'function') {
      idleId = win.requestIdleCallback(() => {
        mountComposer()
      }, { timeout: 1200 })
    } else {
      timeoutId = window.setTimeout(() => {
        mountComposer()
      }, 120)
    }

    return () => {
      if (idleId != null && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleId)
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [composerReady])

  const primeComposer = useCallback(() => {
    if (composerReady) return
    void loadInputComposer()
  }, [composerReady])

  function handleComposerSubmit(payload: ComposerSubmitPayload) {
    // 不在首页等待创建接口返回，立刻把参数交接给“快速成片”对话页，
    // 由对话页在落地后发起生成，确保点击发送即刻跳转、不等待。
    try {
      sessionStorage.setItem(QUICK_CREATE_PENDING_KEY, JSON.stringify(payload))
    } catch {}
    setSubmitting(true)
    router.push('/create/video')
    return true
  }

  return (
    <div onPointerEnter={primeComposer} onFocusCapture={primeComposer}>
      {composerReady ? (
        <InputComposer
          submitting={submitting}
          initialImageModelOptions={initialImageModelOptions}
          onSubmit={handleComposerSubmit}
        />
      ) : (
        HOME_COMPOSER_FALLBACK
      )}
    </div>
  )
}
