import { expect, test } from '@playwright/test'

import { loginAsConsumer } from './helpers/auth'

/**
 * 设置页
 */
test.describe('PRD settings', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await loginAsConsumer(page, { next: '/settings' })
  })

  test('ST1 默认落在偏好 Tab', async ({ page }) => {
    await expect(page.getByRole('button', { name: '偏好' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'AI 服务' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Agent 配置' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Skills' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '偏好设置' })).toBeVisible()
    await expect(page.getByText('主题', { exact: true })).toBeVisible()
    await expect(page.getByText('语言', { exact: true })).toBeVisible()
  })

  test('ST2 可切换到 Agent 与 Skills', async ({ page }) => {
    await page.getByRole('button', { name: 'Agent 配置' }).click()
    await expect(page.getByRole('heading', { name: 'Agent 配置' })).toBeVisible()
    await expect(page.getByRole('button', { name: '剧本改写' })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Skills' }).click()
    await expect(page.getByRole('button', { name: '新增 Skill' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: '剧本改写' })).toBeVisible()
  })

  test('ST3 AI 服务分区', async ({ page }) => {
    await page.getByRole('button', { name: 'AI 服务' }).click()
    await expect(page.getByRole('tab', { name: /文本/ })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('已配置').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '添加' }).first()).toBeVisible()
  })

  test('ST4 Agent 展开并保存', async ({ page }) => {
    await page.getByRole('button', { name: 'Agent 配置' }).click()
    await page.getByRole('button', { name: '剧本改写' }).click()

    const promptInput = page.locator('textarea').first()
    const currentPrompt = await promptInput.inputValue()
    await promptInput.fill(`${currentPrompt}\n`)
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('已保存').first()).toBeVisible()
  })

  test('ST5 Skills 新增后删除（confirm dialog）', async ({ page }) => {
    const id = `e2e${Date.now()}`
    const skillName = `E2E Skill ${id}`

    await page.getByRole('button', { name: 'Skills' }).click()
    await page.getByRole('button', { name: '新增 Skill' }).click()

    const dlg = page.getByRole('dialog')
    await dlg.getByPlaceholder('如 custom-extraction').fill(id)
    await dlg.getByPlaceholder('如 自定义提取规则').fill(skillName)
    await dlg.getByPlaceholder('简短描述此 Skill 的用途').press('Enter')

    await expect(page.getByText('已创建')).toBeVisible()
    await expect(page.getByText(skillName)).toBeVisible()

    await page.getByRole('button', { name: `删除 Skill「${skillName}」`, exact: true }).click()
    const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '删除 Skill' }) })
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(page.getByText('已删除')).toBeVisible()
  })

  test('ST6 Skill 目录名强校验', async ({ page }) => {
    await page.getByRole('button', { name: 'Skills' }).click()
    await page.getByRole('button', { name: '新增 Skill' }).click()

    const dlg = page.getByRole('dialog')
    await dlg.getByPlaceholder('如 custom-extraction').fill('中文 skill')

    await expect(dlg.getByText('目录名仅支持英文字母、数字、中划线和下划线')).toBeVisible()
    await expect(dlg.getByRole('button', { name: '创建' })).toBeDisabled()
  })
})
