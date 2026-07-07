/**
 * E2E #5 — 画布上传（v0.23.2 P1 验收）
 *
 * 覆盖：
 *   - 画布空白处右键打开上传弹窗
 *   - 上传图片后新增 image 节点
 *   - 刷新后节点仍从 mock localStorage 恢复
 *   - 上传失败文案与保存资产闭环
 */

import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { gotoCanvasList, resetCanvasMock } from './_helpers'

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

test.describe('canvas upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/canvas')
    await resetCanvasMock(page)
    await gotoCanvasList(page)
    await page.getByText(/演示画布/).first().click()
    await page.waitForURL(/\/canvas\/cnv_demo_drama/, { timeout: 15_000 })
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })
  })

  test('右键上传图片生成节点，刷新后仍保留', async ({ page }) => {
    const title = 'P1 上传验收图'
    const beforeCount = await page.locator('.react-flow__node').count()

    const surface = page.getByTestId('canvas-context-menu-surface')
    await surface.dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 640,
      clientY: 360,
    })
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('menuitem', { name: /^上传$/ }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('上传到画布')).toBeVisible({ timeout: 10_000 })
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'p1-upload.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_1X1, 'base64'),
    })
    await dialog.getByPlaceholder('标题').fill(title)
    await dialog.getByRole('button', { name: '上传' }).click()

    await expect(page.getByText('已上传到画布')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.react-flow__node')).toHaveCount(beforeCount + 1, { timeout: 10_000 })
    await expect(page.getByText(title)).toBeVisible()

    await page.reload()
    await page.waitForFunction(
      () =>
        typeof window !== 'undefined' &&
        (window as unknown as { __mswWorker?: unknown }).__mswWorker !== undefined,
      null,
      { timeout: 20_000 },
    )
    await expect(page.locator('.react-flow__node')).toHaveCount(beforeCount + 1, { timeout: 30_000 })
    await expect(page.getByText(title)).toBeVisible()
  })

  test('勾选保存资产后资产库可见画布上传资产', async ({ page }) => {
    const title = 'P2 上传入资产图'

    const surface = page.getByTestId('canvas-context-menu-surface')
    await surface.dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 680,
      clientY: 380,
    })
    await page.getByRole('menuitem', { name: /^上传$/ }).click()

    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'asset-upload.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_1X1, 'base64'),
    })
    await dialog.getByPlaceholder('标题').fill(title)
    await dialog.getByText('同步保存到资产库').click()
    await dialog.getByRole('button', { name: '上传' }).click()

    await expect(page.getByText('已上传并保存到资产')).toBeVisible({ timeout: 10_000 })

    await page.goto('/assets')
    await expect(page.getByRole('heading', { name: '资产库' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('tab', { name: /画布资产/ }).click()
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('画布上传')).toBeVisible()
  })

  test('非法类型和图片超限有解释性失败文案', async ({ page }) => {
    const surface = page.getByTestId('canvas-context-menu-surface')
    await surface.dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 640,
      clientY: 360,
    })
    await page.getByRole('menuitem', { name: /^上传$/ }).click()

    const dialog = page.getByRole('dialog')
    const input = dialog.locator('input[type="file"]')
    await input.setInputFiles({
      name: 'archive.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('zip'),
    })
    await expect(dialog.getByText(/仅支持 PNG、JPG、WEBP/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: '上传' })).toBeDisabled()

    await input.setInputFiles({
      name: 'too-large.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(30 * 1024 * 1024 + 1),
    })
    await expect(dialog.getByText('图片文件不能超过 30MB')).toBeVisible({ timeout: 10_000 })
    await expect(dialog.getByRole('button', { name: '上传' })).toBeDisabled()
  })
})
