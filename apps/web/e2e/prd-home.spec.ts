import { expect, test } from '@playwright/test'

import { loginAsConsumer } from './helpers/auth'

/**
 * 首页工作台
 */
test.describe('PRD home /', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsConsumer(page, { next: '/' })
  })

  test('H1 登录后展示创作区与继续创作区', async ({ page }) => {
    await expect(page.locator('#workbench-create-heading')).toBeVisible()
    await expect(page.getByRole('heading', { name: '继续创作' })).toBeVisible()
    await expect(page.getByRole('button', { name: '查看全部' })).toBeVisible()
  })

  test('H8 工作台分区展示当前入口', async ({ page }) => {
    await expect(page.getByPlaceholder('上传参考图、输入文字，描述你想生成的图片。')).toBeVisible()
    await expect(page.getByRole('button', { name: /新建短剧/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /小说剧本/ })).toBeVisible()
  })

  test('H2 新建短剧弹窗与取消', async ({ page }) => {
    await page.getByRole('button', { name: /新建短剧/ }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByRole('heading', { name: '新建短剧项目' })).toBeVisible()
    await expect(dlg.getByPlaceholder('例如：都市情感短剧《时光邮局》')).toBeVisible()
    await dlg.getByRole('button', { name: '取消' }).click()
    await expect(dlg).toBeHidden()
  })

  test('H3 从首页创建项目并进入详情页', async ({ page }) => {
    const title = `e2e-home-${Date.now()}`

    await page.getByRole('button', { name: /新建短剧/ }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByPlaceholder('例如：都市情感短剧《时光邮局》').fill(title)
    await dlg.getByRole('button', { name: '创建项目' }).click()

    await expect(page).toHaveURL(/\/drama\/\d+$/, { timeout: 45_000 })
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 45_000 })
  })

  test('H4 查看全部进入短剧列表', async ({ page }) => {
    await page.getByRole('button', { name: '查看全部' }).click()
    await expect(page).toHaveURL(/\/drama$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: '短剧项目' })).toBeVisible()
  })

  test('H5 小说剧本入口跳转到写作页', async ({ page }) => {
    await page.getByRole('button', { name: /小说剧本/ }).click()
    await expect(page).toHaveURL(/\/writing$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: '小说剧本', exact: true })).toBeVisible()
  })
})
