import { expect, test, type Page } from '@playwright/test'

import { loginAsConsumer } from './helpers/auth'

async function createWorkspaceDrama(page: Page) {
  await loginAsConsumer(page, { next: '/drama' })
  const title = `e2e-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const createResponse = await page.request.post('/api/v1/dramas', {
    data: { title, total_episodes: 2, style: 'realistic' },
  })
  const createJson = await createResponse.json().catch(() => ({}))
  expect(createResponse.ok(), `create drama: ${JSON.stringify(createJson).slice(0, 300)}`).toBeTruthy()
  const dramaId = Number(createJson?.data?.id ?? createJson?.id)
  expect(Number.isInteger(dramaId) && dramaId > 0).toBeTruthy()

  const splitResponse = await page.request.post(`/api/v1/dramas/${dramaId}/split-episodes`, {
    data: {
      content: '第1集\n林夏在旧宅发现遗嘱被替换，顾沉递出录音证据。\n\n第2集\n林夏公开反击，真正继承人出现在门口。',
      replace_existing: true,
    },
  })
  const splitJson = await splitResponse.json().catch(() => ({}))
  expect(splitResponse.ok(), `split episodes: ${JSON.stringify(splitJson).slice(0, 300)}`).toBeTruthy()

  return { dramaId, title }
}

test.describe('0.24 drama workspace smoke', () => {
  test('opens project shell, episodes guide, and episode workbench', async ({ page }) => {
    const { dramaId, title } = await createWorkspaceDrama(page)

    await page.goto(`/drama/${dramaId}`)
    await expect(page.locator('.drama-workspace-sidebar')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('navigation', { name: '短剧项目导航' })).toBeVisible()
    await expect(page.locator('.drama-workspace-title-row h1')).toHaveText(title)
    await expect(page.locator('aside[aria-label="主导航"]')).toHaveCount(0)
    const projectNav = page.getByRole('navigation', { name: '短剧项目导航' })
    const episodesNavLink = projectNav.getByRole('link', { name: '剧集' })
    await expect(episodesNavLink).toBeVisible()
    await expect(episodesNavLink).toHaveAttribute('href', `/drama/${dramaId}/episodes`)
    await expect(projectNav.getByRole('link', { name: '总览' })).toBeVisible()
    await expect(projectNav.getByRole('link', { name: '画布' })).toBeVisible()
    await expect(projectNav.getByRole('link', { name: '素材' })).toBeVisible()
    await expect(projectNav.getByRole('link', { name: '成片' })).toBeVisible()
    await expect(projectNav.getByRole('link')).toHaveCount(5)
    await expect(page.getByRole('button', { name: /任务中心/ })).toBeVisible()

    await page.waitForLoadState('networkidle')
    await Promise.all([
      page.waitForURL(new RegExp(`/drama/${dramaId}/episodes$`)),
      episodesNavLink.click(),
    ])
    await expect(page.locator('.drama-episodes-command h2')).toBeVisible()
    await expect(page.getByText('剧集', { exact: true }).first()).toBeVisible()
    const stageStepper = page.getByRole('navigation', { name: '制作步骤' })
    await expect(stageStepper).toBeVisible()
    await expect(stageStepper.locator('.drama-episodes-stepper-item')).toHaveCount(5)
    await expect(stageStepper.getByText('分集规划', { exact: true })).toBeVisible()
    await expect(stageStepper.getByText('故事地图', { exact: true })).toBeVisible()
    await expect(page.locator('.drama-stage-board')).toBeVisible()

    await page.getByRole('link', { name: /源稿理解/ }).click()
    await expect(page).toHaveURL(new RegExp(`/drama/${dramaId}/episodes\\?stage=source$`))
    await expect(page.locator('.drama-source-form')).toBeVisible()

    await page.locator('.drama-episode-rail-row').first().click()
    await expect(page).toHaveURL(new RegExp(`/drama/${dramaId}/episodes/1\\?stage=script$`))
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
  })

  test('normalizes the retained episode route without losing its tool context', async ({ page }) => {
    const { dramaId } = await createWorkspaceDrama(page)

    await page.goto(`/drama/${dramaId}/episode/1?step=script-raw&origin=task`)

    await expect(page).toHaveURL(
      new RegExp(`/drama/${dramaId}/episodes/1\\?stage=script&origin=task&tool=script-raw$`),
    )
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
  })
})
