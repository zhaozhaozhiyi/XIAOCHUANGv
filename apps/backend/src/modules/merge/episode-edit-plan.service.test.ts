import { describe, expect, it, vi } from 'vitest'

import {
  dramas,
  episodeDialogueTakes,
  episodeDialogueTakeAttempts,
  episodeDialogueCues,
  episodeEditRevisions,
  episodeMediaProductionRuns,
  episodeMediaRunItems,
  episodes,
  storyboardBoundaries,
  storyboards,
  videoGenerations,
} from '../../db/schema'
import { EpisodeEditPlanService } from './episode-edit-plan.service'

type Row = Record<string, unknown>

function createReadChain(rows: Row[]) {
  const chain: {
    where: ReturnType<typeof vi.fn>
    orderBy: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    then: Promise<Row[]>['then']
  } = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  }
  chain.where.mockReturnValue(chain)
  chain.orderBy.mockReturnValue(chain)
  chain.limit.mockReturnValue(chain)
  return chain
}

function createSequencedDatabase(sequences: Map<unknown, Row[][]>) {
  const takeRows = (table: unknown) => sequences.get(table)?.shift() ?? []
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => createReadChain(takeRows(table))),
      })),
    },
  }
}

function createPreviewDatabase(transitionType: string) {
  return createSequencedDatabase(
    new Map<unknown, Row[][]>([
      [
        episodes,
        [[{ id: 41, dramaId: 23, userId: 7, deletedAt: null }]],
      ],
      [
        dramas,
        [[{ id: 23, userId: 7, deletedAt: null }]],
      ],
      [
        storyboards,
        [[
          {
            id: 101,
            storyboardNumber: 1,
            episodeId: 41,
            userId: 7,
            dialogue: null,
            deletedAt: null,
          },
          {
            id: 102,
            storyboardNumber: 2,
            episodeId: 41,
            userId: 7,
            dialogue: null,
            deletedAt: null,
          },
        ]],
      ],
      [
        storyboardBoundaries,
        [[{
          id: 801,
          fromStoryboardId: 101,
          toStoryboardId: 102,
          status: 'approved',
          transitionType,
          reviewJson: JSON.stringify({ reviewed_production_run_id: 71 }),
          deletedAt: null,
        }]],
      ],
      [
        episodeMediaProductionRuns,
        [[{
          id: 71,
          episodeId: 41,
          userId: 7,
          status: 'completed',
        }]],
      ],
      [
        episodeMediaRunItems,
        [[
          {
            id: 901,
            productionRunId: 71,
            storyboardId: 101,
            videoGenerationId: 501,
            status: 'completed',
          },
          {
            id: 902,
            productionRunId: 71,
            storyboardId: 102,
            videoGenerationId: 502,
            status: 'completed',
          },
        ]],
      ],
      [
        videoGenerations,
        [[
          { id: 501, videoUrl: 'https://media.example/shot-1.mp4' },
          { id: 502, videoUrl: 'https://media.example/shot-2.mp4' },
        ]],
      ],
      [episodeDialogueTakes, [[]]],
    ]),
  )
}

function createRevisionApprovalDatabase(revision: Row) {
  const updates: Row[] = []
  return {
    updates,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([revision])),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Row) => {
          updates.push(values)
          return {
            where: vi.fn(() => Promise.resolve()),
          }
        }),
      })),
    },
  }
}

function createDialoguePreviewDatabase(attemptStatus = 'succeeded') {
  return createSequencedDatabase(
    new Map<unknown, Row[][]>([
      [
        episodes,
        [[{ id: 41, dramaId: 23, userId: 7, deletedAt: null }]],
      ],
      [
        dramas,
        [[{ id: 23, userId: 7, deletedAt: null }]],
      ],
      [
        storyboards,
        [[
          {
            id: 101,
            storyboardNumber: 1,
            episodeId: 41,
            userId: 7,
            dialogue: '老王：你少跟我讲这些。',
            deletedAt: null,
          },
        ]],
      ],
      [storyboardBoundaries, [[]]],
      [
        episodeMediaProductionRuns,
        [[{
          id: 71,
          episodeId: 41,
          userId: 7,
          status: 'completed',
        }]],
      ],
      [
        episodeMediaRunItems,
        [[
          {
            id: 901,
            productionRunId: 71,
            storyboardId: 101,
            videoGenerationId: 501,
            status: 'completed',
          },
        ]],
      ],
      [
        videoGenerations,
        [[{ id: 501, videoUrl: 'https://media.example/shot-1.mp4' }]],
      ],
      [
        episodeDialogueTakes,
        [[{
          id: 31,
          episodeId: 41,
          userId: 7,
          speakerName: '老王',
          status: 'approved_for_mix',
          approvedAttemptId: 61,
          audioUrl: 'https://media.example/take-31.mp3',
          durationMs: 1800,
          deletedAt: null,
        }]],
      ],
      [
        episodeDialogueTakeAttempts,
        [[{
          id: 61,
          takeId: 31,
          status: attemptStatus,
          audioUrl: 'https://media.example/take-31.mp3',
          audioSha256: 'a'.repeat(64),
          deletedAt: null,
        }]],
      ],
      [
        episodeDialogueCues,
        [[{
          id: 81,
          dialogueTakeId: 31,
          storyboardId: 101,
          takeInMs: 0,
          takeOutMs: 1800,
          timelineInMs: 0,
          takeSampleIn: 0,
          takeSampleOut: 43200,
          cueMode: 'within_shot',
          syncPolicy: 'not_required',
          subtitleSegmentsJson: '[]',
          status: 'approved',
          deletedAt: null,
        }]],
      ],
    ]),
  )
}

describe('EpisodeEditPlanService', () => {
  it('blocks a transition that the current timeline renderer cannot faithfully render', async () => {
    const service = new EpisodeEditPlanService(
      createPreviewDatabase('dissolve') as any,
    )

    const preview = await service.previewEditRevision(41, 7)

    expect(preview.ready).toBe(false)
    expect(preview.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'timeline_transition_not_renderable',
          boundary_id: 801,
        }),
      ]),
    )
  })

  it('mutes raw video audio by default while preserving approved timeline clips', async () => {
    const service = new EpisodeEditPlanService(
      createPreviewDatabase('hard_cut') as any,
    )

    const preview = await service.previewEditRevision(41, 7)
    const timeline = preview.timeline as { clips: Array<Record<string, unknown>> }

    expect(preview.ready).toBe(true)
    expect(timeline.clips).toEqual([
      expect.objectContaining({
        storyboard_id: 101,
        audio_policy: 'mute',
      }),
      expect.objectContaining({
        storyboard_id: 102,
        audio_policy: 'mute',
        transition: expect.objectContaining({ type: 'hard_cut' }),
      }),
    ])
  })

  it('uses only an approved, immutable dialogue attempt in the edit timeline', async () => {
    const service = new EpisodeEditPlanService(
      createDialoguePreviewDatabase() as any,
    )

    const preview = await service.previewEditRevision(41, 7)
    const timeline = preview.timeline as {
      dialogue_cues: Array<Record<string, unknown>>
    }

    expect(preview.ready).toBe(true)
    expect(timeline.dialogue_cues).toEqual([
      expect.objectContaining({
        dialogue_take_id: 31,
        dialogue_attempt_id: 61,
        take_sample_in: 0,
        take_sample_out: 43200,
      }),
    ])
  })

  it('blocks an edit timeline when a take does not point to a successful attempt', async () => {
    const service = new EpisodeEditPlanService(
      createDialoguePreviewDatabase('failed') as any,
    )

    const preview = await service.previewEditRevision(41, 7)

    expect(preview.ready).toBe(false)
    expect(preview.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'dialogue_take_review_required',
          take_id: 31,
        }),
      ]),
    )
  })

  it('marks a draft stale instead of approving it when the preview source changes', async () => {
    const timeline = {
      version: 1,
      clips: [
        {
          storyboard_id: 101,
          video_generation_id: 501,
          video_url: 'https://media.example/shot-1.mp4',
          audio_policy: 'mute',
        },
      ],
      dialogue_cues: [],
    }
    const sourceSnapshot = {
      production_run_id: 71,
      video_generation_ids: [501],
      dialogue_take_ids: [],
      dialogue_cue_ids: [],
    }
    const database = createRevisionApprovalDatabase({
      id: 91,
      episodeId: 41,
      userId: 7,
      status: 'draft',
      timelineJson: JSON.stringify(timeline),
      sourceSnapshotJson: JSON.stringify(sourceSnapshot),
      deletedAt: null,
    })
    const service = new EpisodeEditPlanService(database as any)
    vi.spyOn(service as any, 'buildPreview').mockResolvedValue({
      ready: true,
      blocks: [],
      timeline: {
        ...timeline,
        clips: [
          {
            ...timeline.clips[0],
            video_generation_id: 777,
            video_url: 'https://media.example/shot-1-rebuilt.mp4',
          },
        ],
      },
      source_snapshot: {
        ...sourceSnapshot,
        video_generation_ids: [777],
      },
    })

    await expect(service.approveEditRevision(41, 91, 7)).rejects.toMatchObject({
      status: 409,
    })
    expect(database.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'stale',
          failureCode: 'episode_edit_revision_stale',
        }),
      ]),
    )
  })
})
