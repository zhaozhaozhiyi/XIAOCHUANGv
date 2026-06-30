/**
 * useDebouncedSave — 画布草稿自动保存（PRD §10.7）
 *
 * 触发条件：
 * - canvasStore.saveStatus 转为 'editing'
 * - 防抖 delay 毫秒后调 onSave
 * - onSave 期间状态转 'saving'，成功后 'saved' + 记录 savedAt
 * - 失败 'error'，sonner toast 提示
 */

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useCanvasStore } from '@/lib/canvas/store/canvasStore'

interface Options {
  delay?: number
  enabled?: boolean
  onSave: () => Promise<void>
}

export function useDebouncedSave({ delay = 3000, enabled = true, onSave }: Options) {
  const saveStatus = useCanvasStore((s) => s.saveStatus)
  const setSaveStatus = useCanvasStore((s) => s.setSaveStatus)
  const timerRef = useRef<number | null>(null)
  const onSaveRef = useRef(onSave)

  // 把最新的 onSave 引用同步到 ref（在 effect 中而不是 render 期间）
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    if (!enabled) return
    if (saveStatus !== 'editing') return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      void (async () => {
        setSaveStatus('saving')
        try {
          await onSaveRef.current()
          setSaveStatus('saved', new Date().toISOString())
        } catch (err) {
          setSaveStatus('error')
          toast.error('画布保存失败', { description: (err as Error)?.message })
        }
      })()
    }, delay)

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [saveStatus, enabled, delay, setSaveStatus])
}
