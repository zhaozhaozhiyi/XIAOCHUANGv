import { expect, test } from '@playwright/test'

import { loginAsConsumer } from './helpers/auth'

/**
 * 壳层与导航
 */
test.describe('PRD shell & sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsConsumer(page, { next: '/' })
  })

  test('N1 左侧主导航七项顺序', async ({ page }) => {
    const aside = page.locator('aside[aria-label="主导航"]')
    await expect(aside).toBeVisible()

    const nav = page.getByRole('navigation', { name: '页面' })
    const links = nav.getByRole('link')
    await expect(links).toHaveCount(7)

    const order = ['主页', '短剧', '画布', '小说', '素材', '设置', '我的']
    for (let i = 0; i < order.length; i++) {
      await expect(links.nth(i)).toHaveAccessibleName(order[i])
    }

    await expect(page.getByRole('link', { name: '添加', exact: true })).toHaveCount(0)
  })

  test('N2 顶栏品牌区且无与侧栏重复的主设置入口', async ({ page }) => {
    const top = page.locator('header').first()
    await expect(top).toBeVisible()
    await expect(page.getByText('小窗').first()).toBeVisible()
    await expect(page.getByText('透过小窗，看见生活的美')).toBeVisible()
    await expect(top.getByRole('link', { name: '设置' })).toHaveCount(0)
  })

  test('N3 主页高亮 @ /', async ({ page }) => {
    await expect(page.getByRole('link', { name: '主页' })).toHaveAttribute('aria-current', 'page')
  })

  test('N4 设置高亮 @ /settings', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('link', { name: '设置' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  })

  test('N5 素材高亮 @ /assets', async ({ page }) => {
    await page.goto('/assets')
    await expect(page.getByRole('link', { name: '素材' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: '素材库' })).toBeVisible()
  })

  test('N6 我的高亮 @ /my', async ({ page }) => {
    await page.goto('/my')
    await expect(page.getByRole('link', { name: '我的' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: '个人中心' })).toBeVisible()
  })

  test('N7 小说高亮与入口可用', async ({ page }) => {
    await page.goto('/writing')
    await expect(page.getByRole('link', { name: '小说' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: '小说剧本', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '新建作品' })).toBeVisible()
  })
})
