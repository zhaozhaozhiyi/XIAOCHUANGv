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

  const detailResponse = await page.request.get(`/api/v1/dramas/${dramaId}`)
  const detailJson = await detailResponse.json().catch(() => ({}))
  expect(detailResponse.ok(), `drama detail: ${JSON.stringify(detailJson).slice(0, 300)}`).toBeTruthy()
  const detail = detailJson?.data ?? detailJson
  const episodeId = Number(detail?.episodes?.find((episode: { episode_number?: number }) => episode.episode_number === 1)?.id)
  expect(Number.isInteger(episodeId) && episodeId > 0).toBeTruthy()

  return { dramaId, episodeId, episodeNumber: 1 }
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

  test('P5 连续性：编辑动作交接时保留既有交接信息', async ({ page }) => {
    const { dramaId, episodeId, episodeNumber } = await createWorkbenchDrama(page)
    const boundaryId = 701
    const updatedActionHandoff = '林砚推门进屋，下一镜从同一推门动作承接。'
    const scriptUpdate = await page.request.put(`/api/v1/episodes/${episodeId}`, {
      data: {
        script_content: '# 第 1 集\n林砚在雨夜推开旧物铺的门。',
      },
    })
    expect(scriptUpdate.ok(), `save episode script: ${await scriptUpdate.text()}`).toBeTruthy()
    const continuity = {
      episode_id: episodeId,
      storyboard_set_id: 601,
      storyboard_count: 2,
      expected_boundary_count: 1,
      boundaries: [
        {
          id: boundaryId,
          episode_id: episodeId,
          from_storyboard_id: 301,
          to_storyboard_id: 302,
          from_storyboard_number: 1,
          to_storyboard_number: 2,
          from_title: '门外停步',
          to_title: '推门入屋',
          relation_type: 'continuous',
          transition_type: 'hard_cut',
          status: 'ready',
          handoff: {
            action_handoff: '林砚抬手推门，镜头跟随他的动作进入室内。',
            audio_bridge: '门轴声和雨声持续。',
            dialogue_handoff: {
              mode: 'continue_same_speaker',
              speaker: '林砚',
            },
          },
          asset_lock: { character_ids: [801], scene_ids: [901] },
          review: {},
        },
      ],
    }
    const failedRun = {
      id: 702,
      episode_id: episodeId,
      storyboard_set_id: 601,
      status: 'failed',
      current_storyboard_id: 302,
      started_at: '2026-07-12T00:00:00.000Z',
      completed_at: '2026-07-12T00:01:00.000Z',
      items: [
        {
          id: 801,
          storyboard_id: 301,
          boundary_id: null,
          sequence_index: 1,
          predecessor_item_id: null,
          status: 'completed',
          start_anchor_url: '/media/shot-1.png',
          planned_end_anchor_url: null,
          actual_first_frame_url: '/media/shot-1-first.png',
          actual_tail_frame_url: '/media/shot-1-tail.png',
          video_generation_id: 901,
          failure_code: null,
          failure_detail: null,
        },
        {
          id: 802,
          storyboard_id: 302,
          boundary_id: boundaryId,
          sequence_index: 2,
          predecessor_item_id: 801,
          status: 'failed',
          start_anchor_url: '/media/shot-1-tail.png',
          planned_end_anchor_url: null,
          actual_first_frame_url: null,
          actual_tail_frame_url: null,
          video_generation_id: 902,
          failure_code: 'continuity_video_generation_failed',
          failure_detail: '视频生成暂时失败',
        },
      ],
    }
    const storyboards = [
      {
        id: 301,
        episode_id: episodeId,
        storyboard_number: 1,
        title: '门外停步',
        description: '林砚站在雨夜门口。',
        action: '抬手推门。',
        duration: 5,
        scene_id: null,
        characters: [],
      },
      {
        id: 302,
        episode_id: episodeId,
        storyboard_number: 2,
        title: '推门入屋',
        description: '林砚推门进入旧屋。',
        action: '延续推门动作进入室内。',
        duration: 5,
        scene_id: null,
        characters: [],
      },
    ]

    await page.route(`**/api/v1/episodes/${episodeId}/storyboards`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ code: 200, data: storyboards }),
      })
    })
    await page.route(`**/api/v1/merge/episodes/${episodeId}/merge`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ code: 200, data: null }),
      })
    })
    await page.route(`**/api/v1/dramas/${dramaId}/story-graph`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 200,
          data: {
            graph: {
              id: 401,
              drama_id: dramaId,
              status: 'ready',
              version: 1,
              script_hash: 'a'.repeat(64),
              current_script_hash: 'a'.repeat(64),
              is_stale: false,
              build_mode: 'test',
              stats: {},
              summary: {},
              failure_reason: null,
              created_at: '2026-07-12T00:00:00.000Z',
              updated_at: '2026-07-12T00:00:00.000Z',
            },
            script_hash: 'a'.repeat(64),
            is_stale: false,
            scripted_episode_count: 1,
            planned_episode_count: 1,
            blueprint_episode_count: 1,
            missing_blueprint_episode_count: 0,
            current_scripted_episode_count: 1,
            stale_scripted_episode_count: 0,
            scripts_complete: true,
            story_graph_task: null,
            ai_first_stage: 'graph_ready',
          },
        }),
      })
    })
    await page.route(`**/api/v1/episodes/${episodeId}/continuity**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname
      const method = route.request().method()

      if (pathname.endsWith('/continuity') && method === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ code: 200, data: continuity }),
        })
        return
      }
      if (pathname.endsWith('/continuity/preflight') && method === 'POST') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            code: 200,
            data: {
              ready: true,
              episode_id: episodeId,
              storyboard_set_id: 601,
              boundaries: {
                total: 1,
                continuous: 1,
                intentional_cuts: 0,
                blocked: 0,
              },
              blocks: [],
            },
          }),
        })
        return
      }
      if (pathname.endsWith('/continuity/runs/latest') && method === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ code: 200, data: failedRun }),
        })
        return
      }
      if (pathname.endsWith('/continuity/dialogue-takes') && method === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ code: 200, data: { episode_id: episodeId, takes: [] } }),
        })
        return
      }
      if (pathname.endsWith('/continuity/edit-revisions') && method === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ code: 200, data: { episode_id: episodeId, revisions: [] } }),
        })
        return
      }
      if (
        pathname.endsWith(`/continuity/boundaries/${boundaryId}`) &&
        method === 'PATCH'
      ) {
        const body = route.request().postDataJSON() as {
          handoff?: Record<string, unknown>
        }
        expect(body.handoff).toMatchObject({
          action_handoff: updatedActionHandoff,
          audio_bridge: '门轴声和雨声持续。',
          dialogue_handoff: {
            mode: 'continue_same_speaker',
            speaker: '林砚',
          },
        })
        continuity.boundaries[0].handoff = body.handoff || {}
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ code: 200, data: continuity }),
        })
        return
      }

      await route.fallback()
    })

    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}?step=prod-continuity`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.continuity-workspace')).toBeVisible()
    await expect(
      page.getByRole('button', { name: '重试失败镜头', exact: true }),
    ).toBeVisible()
    const editButton = page.getByRole('button', { name: '编辑交接' })
    await expect(editButton).toHaveCount(1)
    await editButton.click()

    const actionInput = page.locator('#continuity-action-handoff')
    await expect(actionInput).toHaveCount(1)
    await actionInput.fill(updatedActionHandoff)
    const saveButton = page.getByRole('button', { name: '保存交接' })
    await expect(saveButton).toHaveCount(1)
    await saveButton.click()

    await expect(page.getByText(updatedActionHandoff, { exact: true })).toBeVisible()

    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}?step=prod-videos`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    await expect(
      page.getByText('当前分镜已包含镜头交接合同。请先检查连续性，再由“生成本集连续视频”按真实尾帧推进镜头。'),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '批量生成', exact: true }),
    ).toHaveCount(0)
    await page
      .getByRole('button', { name: '前往连续性生产', exact: true })
      .click()
    await expect(page.locator('.continuity-workspace')).toBeVisible()

    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}?step=prod-compose`)
    await expect(
      page.getByText('当前分镜的成片由已确认剪辑版本渲染。请完成边界审核、确认剪辑版本后再渲染。'),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '批量合成', exact: true }),
    ).toHaveCount(0)

    await page.goto(`/drama/${dramaId}/episode/${episodeNumber}?step=export-merge`)
    await expect(
      page.getByRole('button', { name: '开始合并', exact: true }),
    ).toHaveCount(0)
    await expect(
      page.locator('.step-bubble').getByRole('button', { name: '前往连续性', exact: true }),
    ).toBeVisible()
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
