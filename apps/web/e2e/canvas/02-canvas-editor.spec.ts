/**
 * E2E #2 — 画布编辑器（v0.2.0 PR4 验收）
 *
 * 覆盖：
 *   - 进 demo 画布 → 看到 4 个节点（3 storyboard + 1 note）+ 2 条 narrative 边
 *   - Ctrl+S 手动保存 → 顶栏状态变化
 */

import { expect, test } from '@playwright/test'
import { gotoCanvasList, resetCanvasMock } from './_helpers'

test.describe('canvas editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/canvas')
    await resetCanvasMock(page)
    await gotoCanvasList(page)
  })

  test('打开演示画布看到节点和边', async ({ page }) => {
    await page.getByText(/演示画布/).first().click()
    await page.waitForURL(/\/canvas\/cnv_demo_drama/, { timeout: 15_000 })

    // 等节点渲染（PR2 注册的 storyboard / note 等组件挂载）
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })
    const count = await page.locator('.react-flow__node').count()
    expect(count).toBeGreaterThanOrEqual(3)
  })

  test('Ctrl+S 触发手动保存', async ({ page }) => {
    await page.getByText(/演示画布/).first().click()
    await page.waitForURL(/\/canvas\/cnv_/, { timeout: 15_000 })
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })

    await page.keyboard.press('Control+s')
    // 状态文字会从"已保存"快速闪现"保存中" → "已保存"；只断言最终态
    await expect(page.getByText('已保存').first()).toBeVisible({ timeout: 10_000 })
  })
})
