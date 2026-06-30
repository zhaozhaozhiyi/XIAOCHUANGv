import { expect, test, type Page } from '@playwright/test'

import { mockAgentChats } from './helpers/agent-mocks'
import { loginAsConsumer } from './helpers/auth'

/**
 * PRD §9.1 N8、§9.4 工作台、§9.5 剧本抽样、§9.6 制作/导出抽样
 */
async function createWorkbenchDrama(page: Page) {
  await loginAsConsumer(page)
  const title = `e2e-workbench-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const createResponse = await page.request.post('/api/v1/dramas', {
    data: { title, total_episodes: 1, style: 'realistic' },
  })
  const createJson = await createResponse.json().catch(() => ({}))
  expect(createResponse.ok(), `create drama: ${JSON.stringify(createJson).slice(0, 300)}`).toBeTruthy()

  const dramaId = Number(createJson?.data?.id ?? createJson?.id)
  expect(Number.isInteger(dramaId) && dramaId > 0).toBeTruthy()

  const splitResponse = await page.request.post(`/api/v1/dramas/${dramaId}/split-episodes`, {
    data: {
      content: '第1集\n测试原始内容。\n林砚走进旧物铺，雨声贴着窗沿落下。',
      replace_existing: true,
    },
  })
  const splitJson = await splitResponse.json().catch(() => ({}))
  expect(splitResponse.ok(), `split episodes: ${JSON.stringify(splitJson).slice(0, 300)}`).toBeTruthy()
  expect(splitJson?.data?.episodes?.length ?? splitJson?.episodes?.length ?? 0).toBeGreaterThan(0)

  return { dramaId, episodeNumber: 1 }
}

test.describe('PRD episode workbench', () => {
  test('N8 无 default 壳层 Header，存在 studio-topbar', async ({ page }) => {
    const { dramaId, episodeNumber } = await createWorkbenchDrama(page)
    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('link', { name: '返回首页' })).toHaveCount(0)
    await expect(page.locator('aside[aria-label="主导航"]')).toHaveCount(0)
  })

  test('W1 返回项目', async ({ page }) => {
    const { dramaId, episodeNumber } = await createWorkbenchDrama(page)
    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('link', { name: '返回项目' }).click()
    await expect(page).toHaveURL(new RegExp(`/drama/${dramaId}$`))
  })

  test('W2 / W3 侧栏与顶栏子步、进度文案', async ({ page }) => {
    const { dramaId, episodeNumber } = await createWorkbenchDrama(page)
    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    const pipe = page.locator('.pipeline')
    await expect(pipe.getByRole('button', { name: /角色形象/ })).toBeVisible()
    await pipe.getByRole('button', { name: /角色形象/ }).click()
    await expect(page.locator('.pipeline').getByRole('button', { name: '镜头图' })).toBeVisible()
    await expect(page.getByText(/\d+\/11/).first()).toBeVisible()
  })

  test('W4 主 CTA 存在', async ({ page }) => {
    const { dramaId, episodeNumber } = await createWorkbenchDrama(page)
    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    const cta = page.locator('.step-bubble').getByRole('button')
    await expect(cta).toBeVisible()
  })

  test('W5 刷新', async ({ page }) => {
    const { dramaId, episodeNumber } = await createWorkbenchDrama(page)
    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(page.locator('header.studio-topbar')).toBeVisible()
  })

  test('P1 制作门禁（无分镜时）', async ({ page }) => {
    const { dramaId, episodeNumber } = await createWorkbenchDrama(page)
    await mockAgentChats(page)
    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    await page.locator('.pipeline').getByRole('button', { name: /角色形象/ }).click()
    await expect(page.getByText('请先完成分镜拆解')).toBeVisible()
    await expect(page.locator('.step-bubble').getByRole('button', { name: '前往分镜' })).toBeVisible()
  })

  test('P4 导出页按条件显示主 CTA', async ({ page }) => {
    const { dramaId, episodeNumber } = await createWorkbenchDrama(page)
    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    await page.locator('.pipeline').getByRole('button', { name: /合并成片/ }).click()
    const bubble = page.locator('.step-bubble').getByRole('button')
    await expect(bubble).toBeVisible()
    await expect(bubble).toHaveText(/开始合并|前往分镜|前往视频合成/)
    await expect(page.locator('.step-empty').getByRole('button', { name: '开始合并' })).toHaveCount(0)
  })

  test('S1 原始内容自动保存（真实 API）', async ({ page }) => {
    const { dramaId, episodeNumber } = await createWorkbenchDrama(page)
    const marker = `e2e-raw-${Date.now()}`
    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    await page.locator('.pipeline').getByRole('button', { name: '原始内容' }).click()
    const ta = page.locator('textarea.fill-textarea')
    await ta.fill(marker)
    await expect(page.getByText('已自动保存')).toBeVisible({ timeout: 15_000 })
    await page.reload()
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    await page.locator('.pipeline').getByRole('button', { name: '原始内容' }).click()
    await expect(page.locator('textarea.fill-textarea')).toHaveValue(marker)
  })

  test('S2–S4 Agent 按钮链路（Mock API，断言 Toast）', async ({ page }) => {
    const { dramaId, episodeNumber } = await createWorkbenchDrama(page)
    await mockAgentChats(page)
    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })

    await page.locator('.pipeline').getByRole('button', { name: 'AI 改写' }).click()
    await page.locator('.step-bubble').getByRole('button', { name: 'AI转剧本' }).click()
    await expect(page.getByText('改写完成')).toBeVisible()

    await page.locator('.pipeline').getByRole('button', { name: /提取角色(与)?场景/ }).click()
    await page.locator('.step-bubble').getByRole('button', { name: '提取角色场景' }).click()
    await expect(page.getByText('提取完成')).toBeVisible()

    await page.locator('.pipeline').getByRole('button', { name: '分镜列表' }).click()
    await page.locator('.step-bubble').getByRole('button', { name: 'AI拆解分镜' }).click()
    await expect(page.getByText('分镜拆解完成')).toBeVisible()
  })
})
