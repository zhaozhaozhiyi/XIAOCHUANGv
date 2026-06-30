import { expect, test } from '@playwright/test'

import { ensureAdminUser } from './helpers/admin'

const ADMIN_BASE_URL = process.env.E2E_ADMIN_BASE_URL || 'http://127.0.0.1:5175'

test.describe('Admin smoke', () => {
  test('admin login and dashboard pages are served through backend-backed session/API chain', async ({ browser }) => {
    const admin = await ensureAdminUser()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await page.goto(`${ADMIN_BASE_URL}/`)
      await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 })

      await page.getByPlaceholder('admin@example.com').fill(admin.email)
      await page.getByPlaceholder('••••••••').fill(admin.password)

      const loginResponsePromise = page.waitForResponse((response) =>
        response.url().includes('/api/admin/login') && response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: '登录' }).click()
      const loginResponse = await loginResponsePromise
      expect(loginResponse.ok()).toBeTruthy()

      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 })
      await expect(page.getByText('活跃用户')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('最近注册用户')).toBeVisible()

      await page.goto(`${ADMIN_BASE_URL}/dashboard/users`)
      await expect(page).toHaveURL(/\/dashboard\/users$/, { timeout: 30_000 })
      await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('管理平台所有用户')).toBeVisible()

      await page.goto(`${ADMIN_BASE_URL}/dashboard/dramas`)
      await expect(page).toHaveURL(/\/dashboard\/dramas$/, { timeout: 30_000 })
      await expect(page.getByRole('heading', { name: '内容管理' })).toBeVisible({ timeout: 30_000 })
    } finally {
      await context.close()
    }
  })
})
