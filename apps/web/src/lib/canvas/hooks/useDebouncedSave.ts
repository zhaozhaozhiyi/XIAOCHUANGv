/**
 * useDebouncedSave — 画布草稿自动保存（PRD §10.7）
 *
 * 触发条件：
 * - canvasStore.saveStatus 转为 'editing'
 * - 防抖 delay 毫秒后调 onSave
 * - onSave 期间状态转 'saving'，成功后 'saved' + 记录 savedAt
 * - 失败 'error'，sonner toast 提示
 */

import { useCallback, useEffect, useRef } from 'react'
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
  const enabledRef = useRef(enabled)
  const savePromiseRef = useRef<Promise<void> | null>(null)
  const saveNowRef = useRef<() => Promise<void>>(async () => undefined)

  // 把最新的 onSave 引用同步到 ref（在 effect 中而不是 render 期间）
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const saveNow = useCallback(async () => {
    if (!enabledRef.current) return
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (savePromiseRef.current) return savePromiseRef.current

    const revision = useCanvasStore.getState().editRevision
    let needsResave = false
    setSaveStatus('saving')
    const request = onSaveRef.current()
      .then(() => {
        const current = useCanvasStore.getState()
        if (current.editRevision === revision) {
          setSaveStatus('saved', new Date().toISOString())
        } else {
          needsResave = true
          setSaveStatus('editing')
        }
      })
      .catch((err) => {
        setSaveStatus('error')
        toast.error('画布保存失败', { description: (err as Error)?.message })
        throw err
      })
      .finally(() => {
        savePromiseRef.current = null
        if (needsResave && enabledRef.current) {
          if (timerRef.current !== null) window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => {
            void saveNowRef.current().catch(() => undefined)
          }, delay)
        }
      })
    savePromiseRef.current = request
    return request
  }, [delay, setSaveStatus])

  useEffect(() => {
    saveNowRef.current = saveNow
  }, [saveNow])

  const flush = useCallback(async () => {
    if (!enabledRef.current) return
    if (savePromiseRef.current) await savePromiseRef.current
    if (useCanvasStore.getState().saveStatus === 'editing') await saveNow()
  }, [saveNow])

  useEffect(() => {
    if (!enabled) return
    if (saveStatus !== 'editing') return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      void saveNow().catch(() => undefined)
    }, delay)

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [saveStatus, enabled, delay, saveNow])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    if (enabledRef.current && useCanvasStore.getState().saveStatus === 'editing') {
      void saveNow().catch(() => undefined)
    }
  }, [saveNow])

  return { flush }
}
