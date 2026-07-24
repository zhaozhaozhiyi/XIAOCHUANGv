import { expect, test } from '@playwright/test'

test.describe('Admin auth guard', () => {
  test('redirects guests from protected admin routes to the login page', async ({ page }) => {
    await page.goto('/dashboard/users')

    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 })
    await expect(page.getByPlaceholder('admin@example.com')).toBeVisible()
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  })
})
