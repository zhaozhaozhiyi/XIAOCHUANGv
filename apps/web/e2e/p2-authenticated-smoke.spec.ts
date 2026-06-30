import { expect, test } from '@playwright/test'

import { registerAndLoginFreshConsumer } from './helpers/auth'

test.describe('P2 authenticated smoke', () => {
  test('login with new phone auto-registers and enters writing', async ({ page }) => {
    await registerAndLoginFreshConsumer(page, { next: '/writing' })
    await expect(page).toHaveURL(/\/writing$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: '小说剧本' })).toBeVisible({ timeout: 30_000 })
  })

  test('register -> login -> create writing -> save -> export -> import drama', async ({ page }) => {
    await registerAndLoginFreshConsumer(page, { next: '/writing' })

    await expect(page.getByRole('heading', { name: '小说剧本' })).toBeVisible({ timeout: 30_000 })

    const title = `e2e-writing-${Date.now()}`
    await page.getByRole('button', { name: '新建作品' }).click()
    await page.getByLabel('标题').fill(title)
    await page.getByRole('button', { name: '创建' }).click()

    await expect(page).toHaveURL(/\/writing\/\d+$/, { timeout: 30_000 })

    const workspaceHeading = page.getByText(title).first()
    await expect(workspaceHeading).toBeVisible()

    await page.getByRole('button', { name: /章节写作/ }).click()
    const editor = page.getByPlaceholder('开始写作，或通过右侧 AI 助手续写、润色。')
    const saveResponsePromise = page.waitForResponse((response) =>
      /\/api\/v1\/writings\/\d+\/documents\/\d+$/.test(new URL(response.url()).pathname)
        && response.request().method() === 'PATCH',
    )
    await editor.fill(`# ${title}\n\n这是自动化冒烟创建的正文。\n\n第一段：验证保存。\n第二段：验证导入短剧工程。`)
    const saveResponse = await saveResponsePromise
    expect(saveResponse.ok()).toBeTruthy()

    await page.getByRole('button', { name: /导出/ }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载 Markdown' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toContain('.md')

    const importResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/v1/dramas/from-writing') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '导入短剧工程' }).click()
    const importResponse = await importResponsePromise
    expect(importResponse.ok()).toBeTruthy()
    const importJson = await importResponse.json().catch(() => ({}))
    const dramaId = Number(importJson?.data?.drama_id)
    if (Number.isInteger(dramaId) && dramaId > 0) {
      await page.goto(`/drama/${dramaId}`)
    }
    await expect(page).toHaveURL(/\/drama\/\d+$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
