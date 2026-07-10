import { expect, test, type Page } from '@playwright/test'

import { loginAsConsumer } from './helpers/auth'

type ApiEnvelope<T> = { code?: number; message?: string; data?: T }
type AiFirstPayload = {
  adaptation_briefs: Array<{ id: string; name: string }>
  episodes: Array<{
    id: number
    episode_number: number
    has_blueprint: boolean
    has_script: boolean
    status: string | null
    script_ai_run_id: string | null
    script_remote_run_id: string | null
    generation_mode: string | null
    failure_reason: string | null
  }>
  brief_task?: {
    status: string
    error_message: string | null
  } | null
  blueprint_task?: {
    status: string
    error_message: string | null
  } | null
  pilot_script_task?: {
    status: string
    error_message: string | null
  } | null
  selected_brief_id: string
  source_analysis: unknown | null
}
type DramaDetailPayload = {
  episodes?: Array<{ id: number }>
}

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

async function api<T>(page: Page, method: string, path: string, data?: Record<string, unknown>) {
  const response = await page.request.fetch(path, { method, data })
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T> | T
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(payload).slice(0, 400)}`).toBeTruthy()
  if (payload && typeof payload === 'object' && 'code' in payload && typeof (payload as ApiEnvelope<T>).code === 'number') {
    const envelope = payload as ApiEnvelope<T>
    expect(envelope.code, `API error ${path}: ${envelope.message}`).toBeLessThan(400)
    if (envelope.data !== undefined) return envelope.data
  }
  return unwrap<T>(payload)
}

async function maybeAiFirst<T>(page: Page, method: string, path: string, data?: Record<string, unknown>) {
  const response = await page.request.fetch(path, { method, data })
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T> | T
  const message = typeof (payload as ApiEnvelope<T>)?.message === 'string' ? (payload as ApiEnvelope<T>).message || '' : ''
  if (!response.ok() && message.includes('drama_ai_first_agent_required')) {
    test.skip(true, 'AI-first runtime is not configured; set remote agent or DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK=1 for this smoke')
  }
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(payload).slice(0, 400)}`).toBeTruthy()
  return unwrap<T>((payload as ApiEnvelope<T>).data !== undefined ? (payload as ApiEnvelope<T>).data : payload)
}

async function pollAiFirst(page: Page, dramaId: number, predicate: (payload: AiFirstPayload) => boolean) {
  const timeoutMs = Number(process.env.E2E_AI_FIRST_POLL_TIMEOUT_MS || 180_000)
  const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180_000)
  let latest: AiFirstPayload | null = null
  while (Date.now() < deadline) {
    latest = await api<AiFirstPayload>(page, 'GET', `/api/v1/dramas/${dramaId}/ai-first`)
    const briefTask = latest.brief_task
    if (briefTask && ['failed', 'dead_letter', 'canceled'].includes(briefTask.status)) {
      throw new Error(`adaptation brief task failed: ${briefTask.error_message || briefTask.status}`)
    }
    const blueprintTask = latest.blueprint_task
    if (blueprintTask && ['failed', 'dead_letter', 'canceled'].includes(blueprintTask.status)) {
      throw new Error(`blueprint task failed: ${blueprintTask.error_message || blueprintTask.status}`)
    }
    const pilotTask = latest.pilot_script_task
    if (pilotTask && ['failed', 'dead_letter', 'canceled'].includes(pilotTask.status)) {
      throw new Error(`pilot script task failed: ${pilotTask.error_message || pilotTask.status}`)
    }
    if (predicate(latest)) return latest
    await page.waitForTimeout(2500)
  }
  throw new Error(`AI-first poll timed out: ${JSON.stringify(latest).slice(0, 600)}`)
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

function buildLegacyMetadata() {
  const sourceContent = [
    '第一章 旧宅风暴',
    '林夏在旧宅发现遗嘱被替换，顾沉把录音笔交给她，所有亲戚都开始逼她让步。',
    '第二章 医院对峙',
    '顾沉被困在医院走廊，林夏必须用手里的证据换他的安全，同时守住真正继承人的秘密。',
  ].join('\n')

  return {
    novel_source: {
      type: 'paste',
      title: '旧方案兼容源稿',
      content: sourceContent,
      word_count: sourceContent.replace(/\s/g, '').length,
      chapter_count: 2,
      imported_at: new Date().toISOString(),
      summary: '林夏围绕遗嘱和继承权反击旧宅家族。',
      chapter_index: [
        { chapter_no: 1, title: '旧宅风暴', word_count: 38, brief: '遗嘱被替换，林夏拿到录音证据。' },
        { chapter_no: 2, title: '医院对峙', word_count: 42, brief: '林夏保护顾沉并守住继承人秘密。' },
      ],
    },
    adaptation_plan: {
      status: 'draft',
      target_episode_count: 3,
      episode_duration: '60-90 秒',
      logline: '女主用遗嘱证据反击豪门围剿。',
      tone: '都市反转爽剧',
      main_plot: '林夏从被迫让步到掌握遗嘱真相，逐步夺回继承权。',
      visual_style: '冷静都市质感',
      aspect_rhythm: '16:9 · 高密度钩子',
      character_bible: [
        { name: '林夏', role: '女主', description: '隐忍但果断的继承人。' },
        { name: '顾沉', role: '盟友', description: '掌握关键证据的医生。' },
      ],
      scene_bible: [
        { name: '旧宅客厅', location: '林家旧宅', reuse_level: 'core' },
      ],
      episode_outlines: [
        {
          episode_number: 1,
          title: '遗嘱被换',
          source_range: '第 1 章',
          hook: '林夏发现遗嘱不对劲。',
          key_beats: ['亲戚逼宫', '顾沉递出录音笔'],
          ending_hook: '录音里出现真正继承人的名字。',
          characters: ['林夏', '顾沉'],
          scenes: ['旧宅客厅'],
        },
      ],
      generated_at: new Date().toISOString(),
    },
  }
}

test.describe('0.23.1 drama AI-first flow', () => {
  test.skip(process.env.E2E_DRAMA_AI_FIRST !== '1', 'Set E2E_DRAMA_AI_FIRST=1 to run the AI-first flow smoke')

  test('runs source to pilot and opens workbench with blueprint scope evidence', async ({ page }) => {
    await loginAsConsumer(page, { next: '/drama' })
    const title = `e2e-ai-first-${Date.now()}`
    const drama = await api<{ id: number }>(page, 'POST', '/api/v1/dramas', {
      title,
      total_episodes: 3,
      style: 'realistic',
    })
    const dramaId = Number(drama.id)
    expect(Number.isInteger(dramaId) && dramaId > 0).toBeTruthy()

    await api(page, 'POST', `/api/v1/dramas/${dramaId}/source`, {
      title: '遗嘱风暴源稿',
      source_type: 'paste',
      content: buildSource(),
    })
    const analysis = await maybeAiFirst<AiFirstPayload>(page, 'POST', `/api/v1/dramas/${dramaId}/source/analyze`)
    expect(analysis.source_analysis).toBeTruthy()

    const briefStart = await maybeAiFirst<AiFirstPayload>(page, 'POST', `/api/v1/dramas/${dramaId}/adaptation-briefs`, {
      count: 2,
      target_episode_count: 3,
      episode_duration: '60-90 秒',
      style_direction: '都市爽剧',
    })
    if (briefStart.adaptation_briefs.length < 2) {
      expect(briefStart.brief_task?.status).toMatch(/queued|running|completed/)
    }
    const briefs = briefStart.adaptation_briefs.length >= 2
      ? briefStart
      : await pollAiFirst(page, dramaId, (payload) => payload.adaptation_briefs.length >= 2)
    expect(briefs.adaptation_briefs.length).toBeGreaterThanOrEqual(2)

    const selected = await api<AiFirstPayload>(
      page,
      'POST',
      `/api/v1/dramas/${dramaId}/adaptation-briefs/${encodeURIComponent(briefs.adaptation_briefs[0].id)}/select`,
    )
    expect(selected.selected_brief_id).toBe(briefs.adaptation_briefs[0].id)

    const blueprintStart = await maybeAiFirst<AiFirstPayload>(page, 'POST', `/api/v1/dramas/${dramaId}/episode-blueprints`)
    if (!blueprintStart.episodes.some((episode) => episode.has_blueprint)) {
      expect(blueprintStart.blueprint_task?.status).toMatch(/queued|running|completed/)
    }
    const blueprints = blueprintStart.episodes.some((episode) => episode.has_blueprint)
      ? blueprintStart
      : await pollAiFirst(page, dramaId, (payload) => payload.episodes.some((episode) => episode.has_blueprint))
    expect(blueprints.episodes.some((episode) => episode.has_blueprint)).toBeTruthy()

    await maybeAiFirst<AiFirstPayload>(page, 'POST', `/api/v1/dramas/${dramaId}/pilot-scripts`, { limit: 1 })
    const ready = await pollAiFirst(page, dramaId, (payload) => payload.episodes.some((episode) => episode.has_script))
    const firstReady = ready.episodes.find((episode) => episode.has_script)
    expect(firstReady?.episode_number).toBeTruthy()
    expect(firstReady?.script_ai_run_id).toBeTruthy()
    expect(firstReady?.generation_mode).toMatch(/_script$/)

    await page.goto(`/drama/${dramaId}`)
    await expect(page.getByText('试播正文', { exact: true })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(/已生成/).first()).toBeVisible()

    await page.goto(`/drama/${dramaId}/episode/${firstReady!.episode_number}`)
    await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByLabel('分集蓝图输入')).toContainText('分集蓝图')
    await expect(page.getByLabel('资产作用域边界')).toContainText('公共主档')
    await expect(page.getByLabel('资产作用域边界')).toContainText('单集引用')
    await expect(page.getByLabel('资产作用域边界')).toContainText('镜头私有')
  })
})

test.describe('0.23.1 legacy adaptation plan compatibility', () => {
  test('opens old adaptationPlan projects as legacy drafts without creating episodes', async ({ page }) => {
    await loginAsConsumer(page, { next: '/drama' })
    const title = `e2e-legacy-plan-${Date.now()}`
    const drama = await api<{ id: number }>(page, 'POST', '/api/v1/dramas', {
      title,
      total_episodes: 3,
      style: 'realistic',
      metadata: buildLegacyMetadata(),
    })
    const dramaId = Number(drama.id)
    expect(Number.isInteger(dramaId) && dramaId > 0).toBeTruthy()

    await page.goto(`/drama/${dramaId}`)
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText('旧方案草稿')).toBeVisible()
    await expect(page.getByText('旧数据待迁移')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新生成策略' })).toBeVisible()
    await expect(page.getByRole('button', { name: '生成分集蓝图' })).toHaveCount(0)
    await expect(page.getByText('策略已选择，可以生成分集蓝图')).toHaveCount(0)

    const detail = await api<DramaDetailPayload>(page, 'GET', `/api/v1/dramas/${dramaId}`)
    expect(detail.episodes || []).toHaveLength(0)
  })
})
