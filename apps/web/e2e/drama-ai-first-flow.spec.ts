import { expect, test, type Page } from '@playwright/test'

import { loginAsConsumer } from './helpers/auth'

const AI_FIRST_TIMEOUT_MS = Number(process.env.E2E_AI_FIRST_POLL_TIMEOUT_MS || 8 * 60_000)
const AI_FIRST_POLL_INTERVAL_MS = Number(process.env.E2E_AI_FIRST_POLL_INTERVAL_MS || 2_500)
const AI_SKILL_TIMEOUT_MS = Number(process.env.E2E_AI_SKILL_TIMEOUT_MS || 4 * 60_000)
const SKIP_STORYBOARD_BREAKDOWN = process.env.E2E_SKIP_STORYBOARD_BREAKDOWN === '1'

type ApiEnvelope<T> = { code?: number; message?: string; data?: T }
type TaskSummary = {
  status: string
  error_message: string | null
}

type AiFirstPayload = {
  episodes: Array<{
    id: number
    episode_number: number
    has_blueprint: boolean
    has_script: boolean
    script_ai_run_id: string | null
    generation_mode: string | null
  }>
  source_analysis: unknown | null
  source_analysis_task?: TaskSummary | null
  blueprint_task?: TaskSummary | null
  pilot_script_task?: TaskSummary | null
  story_graph_task?: TaskSummary | null
}

type StoryGraphPayload = {
  graph: {
    id: number
    status: string
    is_stale: boolean
  } | null
  is_stale: boolean
  scripted_episode_count: number
  planned_episode_count: number
  current_scripted_episode_count: number
  scripts_complete: boolean
  story_graph_task: TaskSummary | null
}

type StoryGraphListPayload = {
  items: Array<{ id: number; entity_type?: string }>
}

type WorkspacePayload = {
  counts: {
    scripted_episodes: number
    storyboard_episodes: number
    storyboards: number
  }
  production: {
    gaps: Array<{ key: string }>
  }
}

type ProjectTaskPayload = {
  items: Array<{
    type: string
    status: string
    result_summary: {
      story_graph?: {
        graph_id?: number
        character_count?: number
        relation_count?: number
      } | null
    } | null
  }>
}

type AiRunPayload = Array<{
  references: Array<{
    kind?: string
    graph_id?: number
  }>
}>

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

async function api<T>(page: Page, method: string, path: string, data?: Record<string, unknown>) {
  const response = await page.request.fetch(path, {
    method,
    data,
    timeout: Math.min(AI_FIRST_TIMEOUT_MS, 90_000),
  })
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T> | T
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(payload).slice(0, 500)}`).toBeTruthy()
  if (payload && typeof payload === 'object' && 'code' in payload && typeof (payload as ApiEnvelope<T>).code === 'number') {
    const envelope = payload as ApiEnvelope<T>
    expect(envelope.code, `API error ${path}: ${envelope.message}`).toBeLessThan(400)
    if (envelope.data !== undefined) return envelope.data
  }
  return unwrap<T>(payload)
}

async function maybeAiFirst<T>(page: Page, method: string, path: string, data?: Record<string, unknown>) {
  const response = await page.request.fetch(path, {
    method,
    data,
    timeout: Math.min(AI_FIRST_TIMEOUT_MS, 90_000),
  })
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T> | T
  const message = typeof (payload as ApiEnvelope<T>)?.message === 'string' ? (payload as ApiEnvelope<T>).message || '' : ''
  if (!response.ok() && message.includes('drama_ai_first_agent_required')) {
    test.skip(true, 'AI-first runtime is not configured; configure a text provider before running this release smoke')
  }
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(payload).slice(0, 500)}`).toBeTruthy()
  return unwrap<T>((payload as ApiEnvelope<T>).data !== undefined ? (payload as ApiEnvelope<T>).data : payload)
}

function assertTaskDidNotFail(label: string, task: TaskSummary | null | undefined) {
  if (task && ['failed', 'dead_letter', 'canceled'].includes(task.status)) {
    throw new Error(`${label} task failed: ${task.error_message || task.status}`)
  }
}

async function pollAiFirst(page: Page, dramaId: number, predicate: (payload: AiFirstPayload) => boolean) {
  const deadline = Date.now() + AI_FIRST_TIMEOUT_MS
  let latest: AiFirstPayload | null = null
  while (Date.now() < deadline) {
    latest = await api<AiFirstPayload>(page, 'GET', `/api/v1/dramas/${dramaId}/ai-first`)
    assertTaskDidNotFail('source analysis', latest.source_analysis_task)
    assertTaskDidNotFail('blueprint', latest.blueprint_task)
    assertTaskDidNotFail('pilot script', latest.pilot_script_task)
    assertTaskDidNotFail('story graph', latest.story_graph_task)
    if (predicate(latest)) return latest
    await page.waitForTimeout(AI_FIRST_POLL_INTERVAL_MS)
  }
  throw new Error(`AI-first poll timed out: ${JSON.stringify(latest).slice(0, 700)}`)
}

async function pollStoryGraph(page: Page, dramaId: number) {
  const deadline = Date.now() + AI_FIRST_TIMEOUT_MS
  let latest: StoryGraphPayload | null = null
  while (Date.now() < deadline) {
    latest = await api<StoryGraphPayload>(page, 'GET', `/api/v1/dramas/${dramaId}/story-graph`)
    assertTaskDidNotFail('story graph', latest.story_graph_task)
    if (latest.graph?.status === 'ready' && !latest.is_stale) return latest
    await page.waitForTimeout(AI_FIRST_POLL_INTERVAL_MS)
  }
  throw new Error(`story graph poll timed out: ${JSON.stringify(latest).slice(0, 700)}`)
}

async function runStoryboardBreakdown(page: Page, dramaId: number, episodeId: number) {
  const response = await page.request.post('/api/v1/ai/runs?stream=1', {
    data: {
      skill_id: 'storyboard_breaker',
      mode: 'breakdown',
      scene: 'workspace-smoke',
      target: {
        type: 'episode',
        drama_id: dramaId,
        episode_id: episodeId,
      },
      input: {
        message: '根据故事地图拆解分镜',
      },
      options: {
        stream: true,
      },
    },
    timeout: AI_SKILL_TIMEOUT_MS,
  })
  const payload = await response.text()
  expect(response.ok(), `storyboard breakdown: ${payload.slice(0, 700)}`).toBeTruthy()
  expect(payload).toContain('"type":"done"')
}

async function pollStoryboards(page: Page, episodeId: number) {
  const deadline = Date.now() + AI_FIRST_TIMEOUT_MS
  let latest: Array<{ id: number }> = []
  while (Date.now() < deadline) {
    latest = await api<Array<{ id: number }>>(page, 'GET', `/api/v1/episodes/${episodeId}/storyboards`)
    if (latest.length) return latest
    await page.waitForTimeout(AI_FIRST_POLL_INTERVAL_MS)
  }
  throw new Error('storyboard breakdown timed out')
}

function buildSource() {
  const chapters = [
    ['第一章 遗嘱', '林夏发现遗嘱被调包，顾沉递出证据，旧宅客厅里的所有人都沉默了。'],
    ['第二章 逼近', '对手逼近医院，林夏必须在公开真相和保护顾沉之间做选择。'],
    ['第三章 反击', '林夏决定夺回继承权，真正继承人在门口出现。'],
  ]
  return chapters
    .map(([title, line]) => [title, Array.from({ length: 24 }, () => line).join('\n')].join('\n'))
    .join('\n\n')
}

test.describe('0.24 drama AI-first flow', () => {
  test.skip(process.env.E2E_DRAMA_AI_FIRST !== '1', 'Set E2E_DRAMA_AI_FIRST=1 to run the AI-first release smoke')

  test('runs the explicit five-step source, plan, script, graph, and storyboard flow', async ({ page }) => {
    test.setTimeout(AI_FIRST_TIMEOUT_MS + AI_SKILL_TIMEOUT_MS + 60_000)
    await loginAsConsumer(page, { next: '/drama' })

    const title = `e2e-ai-first-${Date.now()}`
    const drama = await api<{ id: number }>(page, 'POST', '/api/v1/dramas', {
      title,
      style: 'realistic',
    })
    const dramaId = Number(drama.id)
    expect(Number.isInteger(dramaId) && dramaId > 0).toBeTruthy()

    await page.goto(`/drama/${dramaId}/episodes?stage=source`)
    await page.getByLabel('原稿名称').fill('遗嘱风暴源稿')
    await page.getByLabel('小说正文').fill(buildSource())
    const analysisRequests: string[] = []
    page.on('request', (request) => {
      if (
        request.method() === 'POST'
        && request.url().includes(`/api/v1/dramas/${dramaId}/source/analyze`)
      ) {
        analysisRequests.push(request.url())
      }
    })
    const sourceSaveResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().includes(`/api/v1/dramas/${dramaId}/source`)
        && !response.url().includes('/source/analyze'),
    )
    await page.getByRole('button', { name: '保存源稿' }).click()
    const sourceSaveResponse = await sourceSaveResponsePromise
    expect(sourceSaveResponse.ok(), `save source: ${await sourceSaveResponse.text()}`).toBeTruthy()
    await expect(page.getByRole('button', { name: '开始理解源稿' })).toBeVisible()
    expect(analysisRequests).toHaveLength(0)

    const analysisResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST'
        && response.url().includes(`/api/v1/dramas/${dramaId}/source/analyze`),
    )
    await page.getByRole('button', { name: '开始理解源稿' }).click()
    const analysisResponse = await analysisResponsePromise
    const analysisStartPayload = await analysisResponse.json().catch(() => ({})) as ApiEnvelope<AiFirstPayload>
    if (
      !analysisResponse.ok()
      && String(analysisStartPayload.message || '').includes('drama_ai_first_agent_required')
    ) {
      test.skip(
        true,
        'AI-first runtime is not configured; configure a text provider before running this release smoke',
      )
    }
    expect(
      analysisResponse.ok(),
      `automatic source analysis: ${JSON.stringify(analysisStartPayload).slice(0, 500)}`,
    ).toBeTruthy()
    await expect(page).toHaveURL(
      new RegExp(`/drama/${dramaId}/episodes\\?stage=source`),
    )
    const analysis = await pollAiFirst(
      page,
      dramaId,
      (payload) => Boolean(payload.source_analysis),
    )
    expect(analysis.source_analysis).toBeTruthy()

    const blueprintStart = await maybeAiFirst<AiFirstPayload>(page, 'POST', `/api/v1/dramas/${dramaId}/episode-blueprints`)
    const blueprints = blueprintStart.episodes.some((episode) => episode.has_blueprint)
      ? blueprintStart
      : await pollAiFirst(page, dramaId, (payload) => payload.episodes.some((episode) => episode.has_blueprint))
    const plannedEpisodeIds = blueprints.episodes
      .filter((episode) => episode.has_blueprint)
      .map((episode) => episode.id)
    expect(plannedEpisodeIds.length).toBeGreaterThan(0)

    await maybeAiFirst<AiFirstPayload>(page, 'POST', `/api/v1/dramas/${dramaId}/pilot-scripts`, {
      episode_ids: plannedEpisodeIds,
    })
    const ready = await pollAiFirst(
      page,
      dramaId,
      (payload) =>
        plannedEpisodeIds.every((episodeId) =>
          payload.episodes.some(
            (episode) => episode.id === episodeId && episode.has_script,
          ),
        ),
    )
    const firstReady = ready.episodes.find((episode) => episode.has_script)
    expect(firstReady?.id).toBeTruthy()
    expect(firstReady?.script_ai_run_id).toBeTruthy()
    expect(firstReady?.generation_mode).toMatch(/_script$/)

    const beforeBuild = await api<StoryGraphPayload>(page, 'GET', `/api/v1/dramas/${dramaId}/story-graph`)
    expect(beforeBuild.graph).toBeNull()
    expect(beforeBuild.scripts_complete).toBe(true)
    expect(beforeBuild.current_scripted_episode_count).toBe(beforeBuild.planned_episode_count)

    await page.goto(`/drama/${dramaId}/episodes?stage=storyboard`)
    await expect(page).toHaveURL(new RegExp(`/drama/${dramaId}/episodes\\?stage=graph`))
    await expect(page.getByText('正式故事地图尚未就绪，已回到故事地图步骤。')).toBeVisible({ timeout: 45_000 })

    await page.goto(`/drama/${dramaId}/episodes/${firstReady!.episode_number}?step=script-storyboard`)
    await expect(page.getByText('故事地图尚未就绪', { exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('link', { name: '前往故事地图' }))
      .toHaveAttribute('href', `/drama/${dramaId}/episodes?stage=graph`)
    await expect(page.getByRole('button', { name: 'AI 拆解分镜' })).toHaveCount(0)

    await page.goto(`/drama/${dramaId}/episodes/${firstReady!.episode_number}?step=prod-shots`)
    await expect(page).toHaveURL(
      new RegExp(`/drama/${dramaId}/episodes/${firstReady!.episode_number}\\?step=script-storyboard`),
    )
    await expect(page.getByText('故事地图尚未就绪', { exact: true })).toBeVisible({ timeout: 45_000 })

    await maybeAiFirst<StoryGraphPayload>(page, 'POST', `/api/v1/dramas/${dramaId}/story-graph/build`)
    const storyGraph = await pollStoryGraph(page, dramaId)
    expect(storyGraph.graph?.id).toBeTruthy()
    expect(storyGraph.scripted_episode_count).toBeGreaterThan(0)
    expect(storyGraph.graph?.is_stale).toBe(false)

    const [entities, relations] = await Promise.all([
      api<StoryGraphListPayload>(page, 'GET', `/api/v1/dramas/${dramaId}/story-graph/entities`),
      api<StoryGraphListPayload>(page, 'GET', `/api/v1/dramas/${dramaId}/story-graph/relations`),
    ])
    expect(entities.items.some((item) => item.entity_type === 'character')).toBeTruthy()
    expect(relations.items.length).toBeGreaterThan(0)

    await page.goto(`/drama/${dramaId}/episodes?stage=source`)
    await expect(page.getByLabel('源稿关系概览')).toBeVisible({ timeout: 45_000 })
    await page.goto(`/drama/${dramaId}/episodes?stage=graph`)
    await expect(page.getByText('故事地图已就绪', { exact: true })).toBeVisible({ timeout: 45_000 })
    await page.goto(`/drama/${dramaId}/episodes?stage=storyboard`)
    await expect(page).toHaveURL(new RegExp(`/drama/${dramaId}/episodes\\?stage=storyboard`))
    await expect(page.getByText('步骤 5/5 · 分镜制作').first()).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('link', { name: /开始第 1 集分镜|继续第 1 集分镜/ })).toBeVisible()
    await page.goto(`/drama/${dramaId}/episodes/${firstReady!.episode_number}?step=script-storyboard`)
    await expect(page.getByRole('button', { name: 'AI 拆解分镜' })).toBeVisible({ timeout: 45_000 })

    if (!SKIP_STORYBOARD_BREAKDOWN) {
      await runStoryboardBreakdown(page, dramaId, firstReady!.id)
      const storyboards = await pollStoryboards(page, firstReady!.id)
      expect(storyboards.length).toBeGreaterThan(0)

      const workspace = await api<WorkspacePayload>(page, 'GET', `/api/v1/dramas/${dramaId}/workspace`)
      expect(workspace.counts.scripted_episodes).toBeGreaterThan(0)
      expect(workspace.counts.storyboard_episodes).toBeGreaterThan(0)
      expect(workspace.counts.storyboards).toBeGreaterThan(0)
      expect(workspace.production.gaps.some((gap) => gap.key === 'shots_without_first_frame')).toBeTruthy()

      const tasks = await api<ProjectTaskPayload>(page, 'GET', `/api/v1/dramas/${dramaId}/tasks?status=completed`)
      const storyboardTask = tasks.items.find((item) =>
        item.type === 'ai' && item.result_summary?.story_graph?.graph_id === storyGraph.graph?.id,
      )
      expect(storyboardTask?.result_summary?.story_graph?.character_count).toBeGreaterThan(0)

      const runs = await api<AiRunPayload>(
        page,
        'GET',
        `/api/v1/ai/runs?target_type=episode&target_id=${firstReady!.id}&mode=breakdown`,
      )
      expect(runs.some((run) => run.references.some((reference) =>
        reference.kind === 'story_graph' && reference.graph_id === storyGraph.graph?.id,
      ))).toBeTruthy()
    }
  })
})
