import type { ComposerSubmitPayload } from '@/components/create/input-composer-types'

// 首页输入框点击发送后，把待生成的参数暂存在这里，
// 由“快速成片”对话页在挂载后取出并发起生成（实现“点击即跳转、落地再创建”）。
export const QUICK_CREATE_PENDING_KEY = 'quick-create:pending'

export function takeQuickCreatePending(): ComposerSubmitPayload | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(QUICK_CREATE_PENDING_KEY)
    if (raw) window.sessionStorage.removeItem(QUICK_CREATE_PENDING_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    return JSON.parse(raw) as ComposerSubmitPayload
  } catch {
    return null
  }
}
