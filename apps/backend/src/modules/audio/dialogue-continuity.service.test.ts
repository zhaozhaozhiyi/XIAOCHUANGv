import { describe, expect, it, vi } from 'vitest'

import {
  characters,
  dramas,
  episodes,
  storyboardBoundaries,
  storyboards,
} from '../../db/schema'
import { DialogueContinuityService } from './dialogue-continuity.service'

type Row = Record<string, unknown>

function query(rows: Row[]) {
  const value: any = {
    where: vi.fn(() => value),
    orderBy: vi.fn(() => value),
    limit: vi.fn(() => value),
    then: (
      resolve: (value: Row[]) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  }
  return value
}

function createDatabase(rows: Map<unknown, Row[]>) {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => query(rows.get(table) ?? [])),
      })),
    },
  }
}

function createPreviewService(
  languageTag = 'zh-CN',
  voiceCompatibilityError: string | null = null,
) {
  const database = createDatabase(
    new Map<unknown, Row[]>([
      [
        episodes,
        [{
          id: 41,
          dramaId: 23,
          userId: 7,
          audioConfigId: null,
          deletedAt: null,
        }],
      ],
      [
        dramas,
        [{
          id: 23,
          userId: 7,
          metadata: null,
          deletedAt: null,
        }],
      ],
      [
        storyboards,
        [
          {
            id: 101,
            episodeId: 41,
            userId: 7,
            storyboardSetId: 301,
            storyboardNumber: 1,
            dialogue: '老王：你少跟我讲这些。',
            description: null,
            deletedAt: null,
          },
          {
            id: 102,
            episodeId: 41,
            userId: 7,
            storyboardSetId: 301,
            storyboardNumber: 2,
            dialogue: '老王：今天我一定要说清楚。',
            description: null,
            deletedAt: null,
          },
        ],
      ],
      [
        storyboardBoundaries,
        [{
          id: 801,
          episodeId: 41,
          userId: 7,
          fromStoryboardId: 101,
          toStoryboardId: 102,
          handoffJson: JSON.stringify({
            dialogue_handoff: {
              mode: 'continue_same_speaker',
              take_policy: 'continue_current_take',
              language_tag: languageTag,
            },
          }),
          deletedAt: null,
        }],
      ],
      [
        characters,
        [{
          id: 51,
          dramaId: 23,
          userId: 7,
          name: '老王',
          voiceStyle: 'old_wang_voice',
          deletedAt: null,
        }],
      ],
    ]),
  )
  const audioService = {
    resolveDialogueVoiceSnapshot: vi.fn(async () => {
      if (voiceCompatibilityError) throw new Error(voiceCompatibilityError)
      return {
        provider: 'test',
        model: 'test-tts',
        voiceId: 'old_wang_voice',
      }
    }),
  }
  return new DialogueContinuityService(
    database as any,
    audioService as any,
    {} as any,
  )
}

describe('DialogueContinuityService', () => {
  it('keeps a same-speaker continuation in one take with a versioned language manifest', async () => {
    const service = createPreviewService()

    const preview = await service.previewDialogueTakes(41, 7)

    expect(preview.ready).toBe(true)
    expect(preview.takes).toHaveLength(1)
    expect(preview.takes[0]).toMatchObject({
      speaker_name: '老王',
      language_tag: 'zh-CN',
      source_storyboard_ids: [101, 102],
      pronunciation_manifest: {
        primary_language_tag: 'zh-CN',
        confirmed_by: 'script_revision',
      },
    })
    expect(preview.takes[0].text).toContain('你少跟我讲这些。')
    expect(preview.takes[0].text).toContain('今天我一定要说清楚。')
    expect(preview.takes[0].cues).toHaveLength(2)
  })

  it('blocks an invalid authored dialogue language tag before a TTS task is created', async () => {
    const service = createPreviewService('not a language tag')

    const preview = await service.previewDialogueTakes(41, 7)

    expect(preview.ready).toBe(false)
    expect(preview.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dialogue_language_invalid',
          storyboard_id: 102,
        }),
      ]),
    )
  })

  it('blocks a locked voice before TTS when its declared language support is incompatible', async () => {
    const service = createPreviewService('en-US', 'voice_language_unsupported')

    const preview = await service.previewDialogueTakes(41, 7)

    expect(preview.ready).toBe(false)
    expect(preview.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'voice_language_unsupported',
          storyboard_id: 102,
        }),
      ]),
    )
  })
})
