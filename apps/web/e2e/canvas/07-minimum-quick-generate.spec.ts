/**
 * E2E #7 — 最小快速生成（v0.23.2 P4 验收）
 *
 * 覆盖：
 *   - 空白右键快速生成插入可见结果节点
 *   - 单节点右键快速生成插入来源节点右侧
 *   - 新节点 results 进入历史，references 记录来源节点
 *   - 刷新后新节点和当前结果仍存在
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

test.describe('minimum quick generate', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoCanvas(page)
  })

  test('空白右键快速生成插入结果节点并刷新不丢', async ({ page }) => {
    const title = '空白快速生成图'
    const beforeCount = await page.locator('.react-flow__node').count()

    const surface = page.getByTestId('canvas-context-menu-surface')
    await surface.dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 720,
      clientY: 420,
    })
    await page.getByRole('menuitem', { name: /^快速生成$/ }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder(/描述要生成的画面/).fill(title)
    await dialog.getByRole('button', { name: '开始生成' }).click()

    await expect(page.getByText('已开始生成')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.react-flow__node')).toHaveCount(beforeCount + 1, { timeout: 10_000 })
    await expect(page.getByText(title)).toBeVisible()

    const generated = page.locator('.react-flow__node').filter({ hasText: title }).first()
    await generated.click({ button: 'right' })
    await page.getByRole('button', { name: '查看生成历史' }).click()
    await expect(page.getByRole('dialog').getByText('当前结果')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()

    await page.waitForTimeout(300)
    await page.reload()
    await page.waitForFunction(
      () =>
        typeof window !== 'undefined' &&
        (window as unknown as { __mswWorker?: unknown }).__mswWorker !== undefined,
      null,
      { timeout: 20_000 },
    )
    await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 })
  })

  test('单节点快速生成保留来源引用并插入来源节点右侧', async ({ page }) => {
    const title = '基于首镜快速生成图'
    const beforeCount = await page.locator('.react-flow__node').count()

    await page.getByTestId('rf__node-node_shot_1').click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: '基于此节点快速生成' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder(/描述要生成的画面/).fill(title)
    await dialog.getByRole('button', { name: '开始生成' }).click()

    await expect(page.locator('.react-flow__node')).toHaveCount(beforeCount + 1, { timeout: 10_000 })
    await expect(page.getByText(title)).toBeVisible()

    await page.waitForFunction((label) => {
      const raw = window.localStorage.getItem('xc-canvas-mock-v4')
      const parsed = raw ? JSON.parse(raw) : null
      const canvas = parsed?.canvases?.find((item: { id: string }) => item.id === 'cnv_demo_drama')
      return Boolean(canvas?.nodes?.some((item: { data?: { label?: string } }) => item.data?.label === label))
    }, title, { timeout: 10_000 })

    const generatedState = await page.evaluate((label) => {
      const raw = window.localStorage.getItem('xc-canvas-mock-v4')
      const parsed = raw ? JSON.parse(raw) : null
      const canvas = parsed?.canvases?.find((item: { id: string }) => item.id === 'cnv_demo_drama')
      const source = canvas?.nodes?.find((item: { id: string }) => item.id === 'node_shot_1')
      const generated = canvas?.nodes?.find((item: { data?: { label?: string } }) => item.data?.label === label)
      return { source, generated }
    }, title)

    expect(generatedState.generated?.data?.references?.[0]).toMatchObject({ node_id: 'node_shot_1' })
    expect(generatedState.generated?.data?.results?.[0]?.source_type).toBe('canvas_generation')
    expect(generatedState.generated?.position?.x).toBeGreaterThan(generatedState.source?.position?.x)

    await page.waitForTimeout(300)
    await page.reload()
    await page.waitForFunction(
      () =>
        typeof window !== 'undefined' &&
        (window as unknown as { __mswWorker?: unknown }).__mswWorker !== undefined,
      null,
      { timeout: 20_000 },
    )
    await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 })
  })
})
