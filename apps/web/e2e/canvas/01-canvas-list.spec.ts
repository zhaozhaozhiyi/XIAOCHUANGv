/**
 * E2E #1 — 画布列表（v0.2.0 PR4 验收）
 *
 * 覆盖：
 *   - /canvas 能进，看到种子卡片（🌟 灵感板 / 演示画布）
 *   - 点新建画布按钮 → 跳转到 /canvas/[new_id]
 */

import { expect, test } from '@playwright/test'
import { gotoCanvasList, resetCanvasMock } from './_helpers'

test.describe('canvas list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/canvas')
    await resetCanvasMock(page)
    await gotoCanvasList(page)
  })

  test('显示种子画布卡片', async ({ page }) => {
    await expect(page.getByText('🌟 全局灵感板')).toBeVisible()
    await expect(page.getByText(/演示画布/)).toBeVisible()
  })

  test('新建画布跳转到编辑器', async ({ page }) => {
    await page.getByRole('button', { name: /新建画布/ }).click()
    await page.waitForURL(/\/canvas\/cnv_/, { timeout: 15_000 })
    // 编辑器顶栏出现"未命名画布"标题
    await expect(page.getByText('未命名画布').first()).toBeVisible()
  })
})
