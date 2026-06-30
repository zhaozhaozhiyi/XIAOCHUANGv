/**
 * MSW Service Worker 启动入口（v0.2.0 PR1）
 *
 * 仅在 NEXT_PUBLIC_API_MOCKING=enabled 时由 <MSWProvider> 调用。
 */

import { setupWorker } from 'msw/browser'
import { canvasHandlers } from './handlers/canvas'
import { aiHandlers } from './handlers/ai'

export const worker = setupWorker(...canvasHandlers, ...aiHandlers)

/** 提供给开发者控制台调试用 */
if (typeof window !== 'undefined') {
  ;(window as unknown as { __mswWorker?: typeof worker }).__mswWorker = worker
}
