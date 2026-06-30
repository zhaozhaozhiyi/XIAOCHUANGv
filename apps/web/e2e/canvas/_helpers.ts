/**
 * 画布 e2e 通用 helpers（v0.2.0 PR4）
 */

import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * 进入画布列表，并等 MSW worker 起来。
 *
 * dev_auth_bypass 在 .env DEV_AUTH_BYPASS=1 时生效，
 * 不需要走真实登录；MSW 通过 __mswWorker 暴露到 window 检查。
 */
export async function gotoCanvasList(page: Page) {
  await page.goto('/canvas')
  // MSW worker 启动后才往画布发请求
  await page.waitForFunction(
    () =>
      typeof window !== 'undefined' &&
      (window as unknown as { __mswWorker?: unknown }).__mswWorker !== undefined,
    null,
    { timeout: 20_000 },
  )
}

/**
 * 重置 mock localStorage，让画布回到 seed 初始态。
 */
export async function resetCanvasMock(page: Page) {
  await page.evaluate(() => {
    window.localStorage.removeItem('xc-canvas-mock-v4')
  })
}

/** 等待编辑器内 ReactFlow 渲染（至少出现 1 个节点） */
export async function waitEditorReady(page: Page) {
  await expect(page.locator('.react-flow__node')).toHaveCount(3, { timeout: 30_000 })
}
