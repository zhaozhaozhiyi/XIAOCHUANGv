import { expect, test } from '@playwright/test'

import { loginAsConsumer } from './helpers/auth'

/**
 * 路由可访问与品牌文案抽检
 */
test.describe('PRD routes & brand copy', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsConsumer(page, { next: '/' })
  })

  test('任务中心 /tasks 可打开', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: '任务中心' })).toBeVisible()
  })

  test('帮助入口从「我的」页下拉菜单链入', async ({ page }) => {
    await page.goto('/my')
    await page.getByRole('button', { name: '帮助与支持' }).click()
    await expect(page.getByRole('link', { name: '帮助文档' })).toBeVisible()
    await expect(page.getByRole('link', { name: '常见问题' })).toBeVisible()
  })

  test('首页保留友好语气与创作意象', async ({ page }) => {
    const main = page.locator('main')
    await expect(main.getByRole('heading').first()).toBeVisible()
    await expect(main.getByText(/灵感|创作|故事|短剧/).first()).toBeVisible()
    await expect(main.getByRole('button', { name: /新建短剧/ })).toBeVisible()
  })
})
