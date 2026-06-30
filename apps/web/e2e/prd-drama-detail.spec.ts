import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * PRD §9.3 剧集详情
 */
test.describe('PRD drama detail', () => {
  test.describe.configure({ mode: 'serial' })

  async function createDramaForDetail(request: APIRequestContext) {
    const title = `e2e-drama-detail-${Date.now()}`
    const response = await request.post('/api/v1/dramas', {
      data: { title, total_episodes: 2, style: 'realistic' },
    })
    const json = await response.json().catch(() => ({}))
    expect(response.ok()).toBeTruthy()
    const dramaId = Number(json?.data?.id)
    expect(Number.isInteger(dramaId) && dramaId > 0).toBeTruthy()
    return { dramaId, title }
  }

  test('D1 返回首页', async ({ page, request }) => {
    const { dramaId } = await createDramaForDetail(request)

    await page.goto(`/drama/${dramaId}`)
    const backButton = page.getByRole('button', { name: '返回项目列表' })
    await expect(backButton).toBeVisible({ timeout: 45_000 })
    await backButton.click()
    await expect(page).toHaveURL('/')
  })

  test('D2 元信息区', async ({ page, request }) => {
    const { dramaId } = await createDramaForDetail(request)

    await page.goto(`/drama/${dramaId}`)
    await expect(page.getByRole('button', { name: /分集列表/ })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('button', { name: /角色/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /场景/ })).toBeVisible()
  })

  test('D3 添加集弹窗', async ({ page, request }) => {
    const { dramaId } = await createDramaForDetail(request)

    await page.goto(`/drama/${dramaId}`)
    await page.getByRole('button', { name: /新增一集/ }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByText('添加新集')).toBeVisible()
    await dlg.getByRole('button', { name: '取消' }).click()
    await expect(dlg).toBeHidden()
  })

  test('D5 进入单集工作台', async ({ page, request }) => {
    const { dramaId } = await createDramaForDetail(request)
    const splitResponse = await request.post(`/api/v1/dramas/${dramaId}/split-episodes`, {
      data: {
        content: '第1集\n第一集原始内容\n\n第2集\n第二集原始内容',
      },
    })
    expect(splitResponse.ok()).toBeTruthy()

    await page.goto(`/drama/${dramaId}`)
    await page.getByText('第1集').first().click()
    await expect(page).toHaveURL(new RegExp(`/drama/${dramaId}/episode/1`))
  })
})
