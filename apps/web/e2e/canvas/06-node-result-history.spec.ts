/**
 * E2E #6 — 节点生成历史（v0.23.2 P3 验收）
 *
 * 覆盖：
 *   - 历史面板可见多条结果
 *   - 可切换当前结果并刷新保持
 *   - 历史结果可下载、可保存资产
 *   - 资产库可从历史资产打开来源画布并定位节点
 */

import { expect, test } from '@playwright/test'
import { gotoCanvasList, resetCanvasMock } from './_helpers'

async function openDemoCanvas(page: import('@playwright/test').Page) {
  await page.goto('/canvas')
  await resetCanvasMock(page)
  await gotoCanvasList(page)
  await page.getByText(/演示画布/).first().click()
  await page.waitForURL(/\/canvas\/cnv_demo_drama/, { timeout: 15_000 })
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })
}

async function openShotHistory(page: import('@playwright/test').Page) {
  const node = page.getByTestId('rf__node-node_shot_1')
  await node.click({ button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '查看生成历史' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('生成历史')).toBeVisible({ timeout: 10_000 })
  return dialog
}

test.describe('node result history', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoCanvas(page)
  })

  test('历史可切换、刷新保持，并可下载', async ({ page }) => {
    const dialog = await openShotHistory(page)

    await expect(dialog.getByText('当前结果')).toBeVisible()
    await expect(dialog.getByText('晨景历史结果')).toBeVisible()
    await expect(dialog.getByLabel('下载历史结果').first()).toBeVisible()

    await dialog.getByTestId('node-result-select-res_seed_shot1_old').click()
    await expect(page.getByTestId('rf__node-node_shot_1').locator('img')).toHaveAttribute('src', /shot1-old/)

    await page.waitForTimeout(300)
    await page.reload()
    await page.waitForFunction(
      () =>
        typeof window !== 'undefined' &&
        (window as unknown as { __mswWorker?: unknown }).__mswWorker !== undefined,
      null,
      { timeout: 20_000 },
    )
    await expect(page.getByTestId('rf__node-node_shot_1').locator('img')).toHaveAttribute('src', /shot1-old/, { timeout: 30_000 })
  })

  test('历史结果保存资产后可在资产库回源定位', async ({ page }) => {
    const dialog = await openShotHistory(page)
    await dialog.getByTestId('node-result-save-asset-res_seed_shot1_old').click()
    await expect(page.getByText('已保存到资产库')).toBeVisible({ timeout: 10_000 })

    await page.goto('/assets')
    await expect(page.getByRole('heading', { name: '资产库' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('tab', { name: /画布资产/ }).click()
    await expect(page.getByText('晨景历史结果')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('画布历史')).toBeVisible()

    const assetCard = page.locator('article').filter({ hasText: '晨景历史结果' }).first()
    await assetCard.getByRole('link', { name: /打开画布/ }).click()
    await page.waitForURL(/\/canvas\/cnv_demo_drama\?node=node_shot_1&result=res_seed_shot1_old/, { timeout: 15_000 })
    await expect(page.getByTestId('rf__node-node_shot_1')).toBeVisible({ timeout: 30_000 })
  })
})
