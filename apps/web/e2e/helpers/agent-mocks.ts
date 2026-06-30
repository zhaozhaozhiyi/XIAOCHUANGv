import type { Page, Route } from '@playwright/test'

export async function mockAgentChats(page: Page) {
  const state = {
    script: '',
    extracted: false,
    storyboarded: false,
  }

  await page.route('**/api/v1/ai/runs?stream=1', async (route) => {
    const body = route.request().postDataJSON() as { skill_id?: string } | null
    const skillId = body?.skill_id || ''

    if (skillId === 'script_rewriter') {
      state.script = '## S01 | 内景 · 测试空间 | 夜\n测试剧本内容。\n'
      await fulfillSse(route, [
        { type: 'status', text: '正在流式写入剧本...' },
        { type: 'delta', text: state.script },
        { type: 'done', tools_called: ['direct_script_rewrite'] },
      ])
      return
    }

    if (skillId === 'extractor') {
      state.extracted = true
      await fulfillSse(route, [
        { type: 'status', text: '提取完成' },
        { type: 'done', tools_called: ['save_characters', 'save_scenes'] },
      ])
      return
    }

    if (skillId === 'storyboard_breaker') {
      state.storyboarded = true
      await fulfillSse(route, [
        { type: 'status', text: '分镜拆解完成' },
        { type: 'done', tools_called: ['save_storyboards'] },
      ])
      return
    }

    await fulfillSse(route, [{ type: 'done', tools_called: [] }])
  })

  await page.route('**/api/v1/episodes/**', async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname

    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }

    if (pathname.endsWith('/characters')) {
      await fulfillJson(route, state.extracted ? [
        { id: 9001, name: '林砚', role: '主角', description: '测试角色', voice_style: '' },
      ] : [])
      return
    }

    if (pathname.endsWith('/scenes')) {
      await fulfillJson(route, state.extracted ? [
        { id: 9101, location: '测试空间', time: '夜', prompt: '测试场景' },
      ] : [])
      return
    }

    if (pathname.endsWith('/storyboards')) {
      await fulfillJson(route, state.storyboarded ? [
        {
          id: 9201,
          storyboard_number: 1,
          title: '测试镜头',
          description: '测试镜头描述',
          duration: 10,
          scene_id: 9101,
          characters: [{ id: 9001, name: '林砚', role: '主角' }],
        },
      ] : [])
      return
    }

    const upstream = await route.fetch()
    const episode = await upstream.json()
    await route.fulfill({
      status: upstream.status(),
      contentType: 'application/json',
      body: JSON.stringify({
        ...episode,
        content: episode.content || '测试原始内容',
        script_content: state.script,
      }),
    })
  })
}

async function fulfillSse(route: Route, events: Array<Record<string, unknown>>) {
  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream; charset=utf-8',
    body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
  })
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
