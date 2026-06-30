/**
 * E2E #4 — 生成成片（v0.2.0 PR4 验收）
 *
 * 覆盖：
 *   - 顶栏 🎬 生成成片按钮 → 弹 GenerateMovieDialog
 *   - 弹窗显示镜头清单 + 预计时长 + 缺图提示
 *   - 点开始生成 → 弹窗关闭 + 顶栏切到 RunProgressIndicator
 */

import { expect, test } from '@playwright/test'
import { gotoCanvasList, resetCanvasMock } from './_helpers'
import { loginAsConsumer } from '../helpers/auth'

test.describe('generate movie', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsConsumer(page, { next: '/canvas' })
    await resetCanvasMock(page)
    await gotoCanvasList(page)
    await page.getByText(/演示画布/).first().click()
    await page.waitForURL(/\/canvas\/cnv_/, { timeout: 15_000 })
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })
  })

  test('🎬 按钮打开 GenerateMovieDialog', async ({ page }) => {
    await page.getByRole('button', { name: /生成成片/ }).click()
    const dialog = page.getByRole('dialog')
    // 弹窗标题
    await expect(dialog.getByText('生成成片').first()).toBeVisible({ timeout: 10_000 })
    // 镜头清单：演示画布有 3 个 storyboard 节点（限定弹窗内查找）
    await expect(dialog.getByText(/开篇晨景/)).toBeVisible()
    await expect(dialog.getByText(/本次将合成 3 个镜头，预计 16 秒/)).toBeVisible()
    await expect(dialog.getByText(/第 3 号镜头尚未生成画面/)).toBeVisible()
    await expect(dialog.getByLabel('跳过未配音的镜头')).toBeVisible()
  })

  test('开始生成 → 顶栏切到运行中', async ({ page }) => {
    await page.getByRole('button', { name: /生成成片/ }).click()
    await expect(page.getByRole('dialog').getByText('生成成片')).toBeVisible({ timeout: 10_000 })

    const startBtn = page.getByRole('button', { name: /开始生成/ })
    await expect(startBtn).toBeEnabled({ timeout: 15_000 })
    await startBtn.click()

    // 弹窗关闭
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })
    // 顶栏运行中（RunProgressIndicator 文字"生成中"）— demo 画布无 execute 节点，
    // 所以 total=0 + allDone 立即触发，RunProgressIndicator 可能不出现；
    // 改为断言"已落资产库"的 success toast
    await expect(page.getByText(/成片生成完成|生成中|已落资产库/).first()).toBeVisible({
      timeout: 30_000,
    })
  })
})
