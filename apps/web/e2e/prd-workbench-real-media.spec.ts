import { expect, test, type Page } from '@playwright/test'

import { loginAsConsumer } from './helpers/auth'

const REAL_MEDIA_TIMEOUT_MS = Number(process.env.E2E_REAL_MEDIA_TIMEOUT_MS || 30 * 60_000)
const POLL_INTERVAL_MS = Number(process.env.E2E_REAL_MEDIA_POLL_INTERVAL_MS || 5_000)

type DramaDetail = {
  id: number
  episodes?: Array<{ id: number; episode_number: number; script_content?: string | null }>
}

type CharacterRow = { id: number; image_url?: string | null; voice_style?: string | null }
type SceneRow = { id: number; image_url?: string | null }
type StoryboardRow = {
  id: number
  episode_id: number
  first_frame_image?: string | null
  last_frame_image?: string | null
  tts_audio_url?: string | null
  video_url?: string | null
  composed_video_url?: string | null
}

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

async function api<T>(page: Page, method: string, path: string, data?: Record<string, unknown>) {
  const response = await page.request.fetch(path, { method, data })
  const payload = await response.json().catch(() => ({}))
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(payload).slice(0, 300)}`).toBeTruthy()
  return unwrap<T>(payload)
}

async function poll<T>(label: string, fn: () => Promise<T | null>, timeoutMs = REAL_MEDIA_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let lastValue: T | null = null
  while (Date.now() < deadline) {
    lastValue = await fn()
    if (lastValue) return lastValue
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(lastValue).slice(0, 500)}`)
}

async function createWorkbenchDrama(page: Page) {
  await loginAsConsumer(page)
  const title = `e2e-real-media-${Date.now()}`
  const created = await api<{ id: number }>(page, 'POST', '/api/v1/dramas', {
    title,
    total_episodes: 1,
    style: 'realistic',
  })
  const dramaId = Number(created.id)
  expect(Number.isInteger(dramaId) && dramaId > 0).toBeTruthy()

  await api(page, 'POST', `/api/v1/dramas/${dramaId}/split-episodes`, {
    content: [
      '第1集',
      '林砚在雨夜走进旧物铺，发现一枚会发光的铜钥匙。',
      '老板娘低声提醒他，钥匙只会打开最想逃避的那扇门。',
    ].join('\n'),
    replace_existing: true,
  })

  const drama = await api<DramaDetail>(page, 'GET', `/api/v1/dramas/${dramaId}`)
  const episode = drama.episodes?.find((item) => item.episode_number === 1)
  expect(episode?.id, 'episode id').toBeTruthy()
  return { dramaId, episodeId: Number(episode?.id), episodeNumber: 1 }
}

async function runScriptSteps(page: Page, dramaId: number, episodeId: number, episodeNumber: number) {
  await page.goto(`/drama/${dramaId}/episode/${episodeNumber}`)
  await expect(page.locator('header.studio-topbar')).toBeVisible({ timeout: 60_000 })

  await page.locator('.pipeline').getByRole('button', { name: 'AI 改写' }).click()
  await page.locator('.step-bubble').getByRole('button', { name: 'AI转剧本' }).click()
  await poll('script rewrite', async () => {
    const episode = await api<{ script_content?: string | null }>(page, 'GET', `/api/v1/episodes/${episodeId}`)
    return episode.script_content?.trim() ? episode : null
  })

  await page.locator('.pipeline').getByRole('button', { name: /提取角色(与)?场景/ }).click()
  await page.locator('.step-bubble').getByRole('button', { name: '提取角色场景' }).click()
  await poll('extract characters/scenes', async () => {
    const [characters, scenes] = await Promise.all([
      api<CharacterRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/characters`),
      api<SceneRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/scenes`),
    ])
    return characters.length > 0 && scenes.length > 0 ? { characters, scenes } : null
  })

  await page.locator('.pipeline').getByRole('button', { name: '分配音色' }).click()
  await page.locator('.step-bubble').getByRole('button', { name: '分配音色' }).click()
  await poll('voice assignment', async () => {
    const characters = await api<CharacterRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/characters`)
    return characters.length > 0 && characters.every((item) => !!item.voice_style) ? characters : null
  })

  await page.locator('.pipeline').getByRole('button', { name: '分镜列表' }).click()
  await page.locator('.step-bubble').getByRole('button', { name: 'AI拆解分镜' }).click()
  await poll('storyboard breakdown', async () => {
    const storyboards = await api<StoryboardRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/storyboards`)
    return storyboards.length > 0 ? storyboards : null
  })
}

test.describe('PRD episode workbench real media gate', () => {
  test.skip(process.env.E2E_REAL_MEDIA !== '1', 'Set E2E_REAL_MEDIA=1 to run real provider/media regression')
  test.describe.configure({ mode: 'serial' })

  test('runs script, media, compose, and merge with real providers', async ({ page }) => {
    test.setTimeout(REAL_MEDIA_TIMEOUT_MS)
    const { dramaId, episodeId, episodeNumber } = await createWorkbenchDrama(page)
    await runScriptSteps(page, dramaId, episodeId, episodeNumber)

    const characters = await api<CharacterRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/characters`)
    const scenes = await api<SceneRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/scenes`)
    let storyboards = await api<StoryboardRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/storyboards`)

    const characterIds = characters.filter((item) => !item.image_url).map((item) => item.id)
    if (characterIds.length) {
      await api(page, 'POST', '/api/v1/characters/batch-generate-images', {
        character_ids: characterIds,
        episode_id: episodeId,
      })
      await poll('character images', async () => {
        const rows = await api<CharacterRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/characters`)
        return rows.every((item) => !!item.image_url) ? rows : null
      })
    }

    await Promise.all(scenes.filter((item) => !item.image_url).map((scene) =>
      api(page, 'POST', '/api/v1/images', { scene_id: scene.id, episode_id: episodeId }),
    ))
    await poll('scene images', async () => {
      const rows = await api<SceneRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/scenes`)
      return rows.every((item) => !!item.image_url) ? rows : null
    })

    await Promise.all(storyboards.filter((item) => !item.tts_audio_url).map((storyboard) =>
      api(page, 'POST', `/api/v1/storyboards/${storyboard.id}/generate-tts`),
    ))
    await poll('storyboard tts', async () => {
      const rows = await api<StoryboardRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/storyboards`)
      return rows.every((item) => !!item.tts_audio_url) ? rows : null
    })

    storyboards = await api<StoryboardRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/storyboards`)
    await Promise.all(storyboards.flatMap((storyboard) => [
      !storyboard.first_frame_image
        ? api(page, 'POST', '/api/v1/images', {
            storyboard_id: storyboard.id,
            drama_id: dramaId,
            frame_type: 'first_frame',
            prompt: 'cinematic establishing frame for a vertical short drama',
          })
        : Promise.resolve(null),
      !storyboard.last_frame_image
        ? api(page, 'POST', '/api/v1/images', {
            storyboard_id: storyboard.id,
            drama_id: dramaId,
            frame_type: 'last_frame',
            prompt: 'cinematic ending frame for a vertical short drama',
          })
        : Promise.resolve(null),
    ]))
    await poll('storyboard frames', async () => {
      const rows = await api<StoryboardRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/storyboards`)
      return rows.every((item) => !!item.first_frame_image && !!item.last_frame_image) ? rows : null
    })

    storyboards = await api<StoryboardRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/storyboards`)
    await Promise.all(storyboards.filter((item) => !item.video_url).map((storyboard) =>
      api(page, 'POST', '/api/v1/videos', {
        storyboard_id: storyboard.id,
        drama_id: dramaId,
        prompt: 'short vertical drama shot, natural motion, cinematic lighting',
        duration: 5,
      }),
    ))
    await poll('storyboard videos', async () => {
      const rows = await api<StoryboardRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/storyboards`)
      return rows.every((item) => !!item.video_url) ? rows : null
    })

    await api(page, 'POST', `/api/v1/compose/episodes/${episodeId}/compose-all`)
    await poll('storyboard compose', async () => {
      const rows = await api<StoryboardRow[]>(page, 'GET', `/api/v1/episodes/${episodeId}/storyboards`)
      return rows.every((item) => !!item.composed_video_url) ? rows : null
    })

    await api(page, 'POST', `/api/v1/merge/episodes/${episodeId}/merge`)
    await poll('episode merge', async () => {
      const merge = await api<{ status?: string; merged_url?: string | null }>(page, 'GET', `/api/v1/merge/episodes/${episodeId}/merge`)
      return merge.status === 'completed' && merge.merged_url ? merge : null
    })
  })
})
