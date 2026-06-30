/**
 * E2E #3 — 业务动作（v0.2.0 PR4 验收）
 *
 * 覆盖：
 *   - 右键分镜节点弹菜单
 *   - 点"构想画面" → 底栏展开为业务动作模式（textarea placeholder 提示）
 */

import { expect, test } from '@playwright/test'
import { gotoCanvasList, resetCanvasMock } from './_helpers'

test.describe('business action', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/canvas')
    await resetCanvasMock(page)
    await gotoCanvasList(page)
    await page.getByText(/演示画布/).first().click()
    await page.waitForURL(/\/canvas\/cnv_/, { timeout: 15_000 })
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })
  })

  test('右键分镜节点弹出菜单', async ({ page }) => {
    // 第一个 storyboard 节点（demo 画布 shot_1）；用 testid 避开便签节点
    const node = page.getByTestId('rf__node-node_shot_1')
    await node.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible({ timeout: 10_000 })
    await expect(menu.getByRole('button', { name: '构想画面' })).toBeVisible()
    await expect(menu.getByRole('button', { name: '改画面' })).toBeVisible()
    await expect(menu.getByRole('button', { name: '删除' })).toBeVisible()
  })

  test('选择构想画面 → 底栏切到业务动作模式', async ({ page }) => {
    const node = page.getByTestId('rf__node-node_shot_1')
    await node.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible({ timeout: 10_000 })
    await menu.getByRole('button', { name: '构想画面' }).click()
    // 底栏 ExpandedEditor 切到业务动作模式 → 应有 placeholder 含"描述你想要的画面"的 textarea
    const textarea = page.locator('textarea[placeholder*="描述你想要的画面"]')
    await expect(textarea).toBeVisible({ timeout: 10_000 })
  })
})
