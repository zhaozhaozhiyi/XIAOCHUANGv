import { describe, expect, it, vi } from "vitest";

import {
  dramas,
  episodes,
  storyboardBoundaries,
  storyboards,
} from "../../db/schema";
import { DramaEpisodeContinuityService } from "./drama-episode-continuity.service";

type Row = Record<string, unknown>;

function query(rows: Row[]) {
  const value: any = {
    where: vi.fn(() => value),
    orderBy: vi.fn(() => value),
    limit: vi.fn(() => value),
    then: (
      resolve: (value: Row[]) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return value;
}

function createDatabase(rows: Map<unknown, Row[]>) {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => query(rows.get(table) ?? [])),
      })),
    },
  };
}

describe("DramaEpisodeContinuityService", () => {
  it("blocks production preflight when active storyboard pairs have no continuity contract", async () => {
    const database = createDatabase(
      new Map<unknown, Row[]>([
        [
          episodes,
          [
            {
              id: 41,
              userId: 7,
              dramaId: 23,
              videoConfigId: null,
              deletedAt: null,
            },
          ],
        ],
        [
          dramas,
          [
            {
              id: 23,
              userId: 7,
              metadata: null,
              deletedAt: null,
            },
          ],
        ],
        [
          storyboards,
          [
            {
              id: 101,
              userId: 7,
              episodeId: 41,
              storyboardSetId: 301,
              storyboardNumber: 1,
              title: "镜头 1",
              deletedAt: null,
            },
            {
              id: 102,
              userId: 7,
              episodeId: 41,
              storyboardSetId: 301,
              storyboardNumber: 2,
              title: "镜头 2",
              deletedAt: null,
            },
          ],
        ],
        [storyboardBoundaries, []],
      ]),
    );
    const service = new DramaEpisodeContinuityService(
      database as any,
      {} as any,
    );

    const result = await service.preflight(41, 7);

    expect(result.ready).toBe(false);
    expect(result.boundaries).toMatchObject({
      total: 1,
      continuous: 0,
    });
    expect(result.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "continuity_contract_missing",
        }),
      ]),
    );
  });

  it("blocks an intentional cut without an explicit narrative or editing intent", async () => {
    const database = createDatabase(
      new Map<unknown, Row[]>([
        [
          episodes,
          [
            {
              id: 41,
              userId: 7,
              dramaId: 23,
              videoConfigId: null,
              deletedAt: null,
            },
          ],
        ],
        [
          dramas,
          [
            {
              id: 23,
              userId: 7,
              metadata: null,
              deletedAt: null,
            },
          ],
        ],
        [
          storyboards,
          [
            {
              id: 101,
              userId: 7,
              episodeId: 41,
              storyboardSetId: 301,
              storyboardNumber: 1,
              title: "镜头 1",
              firstFrameImage: "https://media.example/shot-1.png",
              deletedAt: null,
            },
            {
              id: 102,
              userId: 7,
              episodeId: 41,
              storyboardSetId: 301,
              storyboardNumber: 2,
              title: "镜头 2",
              firstFrameImage: "https://media.example/shot-2.png",
              deletedAt: null,
            },
          ],
        ],
        [
          storyboardBoundaries,
          [
            {
              id: 801,
              userId: 7,
              dramaId: 23,
              episodeId: 41,
              sourceStoryboardSetId: 301,
              fromStoryboardId: 101,
              toStoryboardId: 102,
              relationType: "intentional_cut",
              transitionType: "hard_cut",
              openingStateJson: "{}",
              closingStateJson: "{}",
              handoffJson: "{}",
              assetLockJson: "{}",
              status: "ready",
              reviewJson: "{}",
              deletedAt: null,
            },
          ],
        ],
      ]),
    );
    const service = new DramaEpisodeContinuityService(
      database as any,
      {} as any,
    );

    const result = await service.preflight(41, 7);

    expect(result.ready).toBe(false);
    expect(result.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "continuity_cut_intent_missing",
          boundary_id: 801,
        }),
      ]),
    );
  });

  it("blocks a required lip-sync boundary when the selected video model cannot consume dialogue audio", async () => {
    const database = createDatabase(
      new Map<unknown, Row[]>([
        [
          episodes,
          [
            {
              id: 41,
              userId: 7,
              dramaId: 23,
              videoConfigId: 18,
              deletedAt: null,
            },
          ],
        ],
        [
          dramas,
          [
            {
              id: 23,
              userId: 7,
              metadata: null,
              deletedAt: null,
            },
          ],
        ],
        [
          storyboards,
          [
            {
              id: 101,
              userId: 7,
              episodeId: 41,
              storyboardSetId: 301,
              storyboardNumber: 1,
              title: "镜头 1",
              firstFrameImage: "https://media.example/shot-1.png",
              deletedAt: null,
            },
            {
              id: 102,
              userId: 7,
              episodeId: 41,
              storyboardSetId: 301,
              storyboardNumber: 2,
              title: "镜头 2",
              firstFrameImage: "https://media.example/shot-2.png",
              deletedAt: null,
            },
          ],
        ],
        [
          storyboardBoundaries,
          [
            {
              id: 801,
              userId: 7,
              dramaId: 23,
              episodeId: 41,
              sourceStoryboardSetId: 301,
              fromStoryboardId: 101,
              toStoryboardId: 102,
              relationType: "intentional_cut",
              transitionType: "hard_cut",
              status: "ready",
              handoffJson: JSON.stringify({
                dialogue_handoff: {
                  sync_policy: "required",
                },
              }),
              reviewJson: "{}",
              deletedAt: null,
            },
          ],
        ],
      ]),
    );
    const aiConfigResolver = {
      resolveConfig: vi.fn(async () => ({
        provider: "minimax",
      })),
    };
    const service = new DramaEpisodeContinuityService(
      database as any,
      aiConfigResolver as any,
    );

    const result = await service.preflight(41, 7);

    expect(result.ready).toBe(false);
    expect(result.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dialogue_sync_provider_unsupported",
          boundary_id: 801,
        }),
      ]),
    );
  });

  it("does not allow a boundary to be approved before its latest video run provides review evidence", async () => {
    const database = createDatabase(
      new Map<unknown, Row[]>([
        [
          episodes,
          [
            {
              id: 41,
              userId: 7,
              dramaId: 23,
              deletedAt: null,
            },
          ],
        ],
        [
          dramas,
          [
            {
              id: 23,
              userId: 7,
              metadata: null,
              deletedAt: null,
            },
          ],
        ],
        [
          storyboardBoundaries,
          [
            {
              id: 801,
              userId: 7,
              dramaId: 23,
              episodeId: 41,
              fromStoryboardId: 101,
              toStoryboardId: 102,
              sourceStoryboardSetId: 301,
              relationType: "continuous",
              status: "review_required",
              reviewJson: "{}",
              deletedAt: null,
            },
          ],
        ],
      ]),
    );
    const service = new DramaEpisodeContinuityService(
      database as any,
      {} as any,
    );

    await expect(
      service.reviewBoundary(41, 801, 7, { decision: "approve" }),
    ).rejects.toThrow("continuity_boundary_video_not_ready");
  });

  it("does not allow a boundary contract to change while its production run is active", async () => {
    const responses = [
      [
        {
          id: 41,
          userId: 7,
          dramaId: 23,
          deletedAt: null,
        },
      ],
      [
        {
          id: 23,
          userId: 7,
          metadata: null,
          deletedAt: null,
        },
      ],
      [{ id: 71 }],
    ];
    const database = {
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => query(responses.shift() ?? [])),
        })),
        update: vi.fn(),
      },
    };
    const service = new DramaEpisodeContinuityService(
      database as any,
      {} as any,
    );

    await expect(
      service.updateBoundary(41, 801, 7, {
        handoff: { action_handoff: "新的动作交接" },
      }),
    ).rejects.toThrow("continuity_production_run_active");

    expect(database.db.update).not.toHaveBeenCalled();
  });

  it("cancels active video generations when the user cancels a continuity run", async () => {
    const continuityProductionService = {
      cancelRun: vi.fn(async () => ({
        id: 71,
        episode_id: 41,
        status: "canceled",
        items: [],
      })),
    };
    const videosService = {
      cancelVideoGeneration: vi.fn(async () => true),
    };
    const service = new DramaEpisodeContinuityService(
      { db: {} } as any,
      {} as any,
      continuityProductionService as any,
      videosService as any,
    );
    vi.spyOn(service, "getRun").mockResolvedValue({
      id: 71,
      episode_id: 41,
      status: "running",
      items: [
        {
          id: 1,
          status: "completed",
          video_generation_id: 501,
        },
        {
          id: 2,
          status: "generating",
          video_generation_id: 502,
        },
      ],
    } as any);

    await expect(service.cancelRun(41, 71, 7)).resolves.toMatchObject({
      id: 71,
      status: "canceled",
    });

    expect(continuityProductionService.cancelRun).toHaveBeenCalledWith(71, 7);
    expect(videosService.cancelVideoGeneration).toHaveBeenCalledWith(
      502,
      "Canceled with continuity production run",
    );
    expect(videosService.cancelVideoGeneration).toHaveBeenCalledTimes(1);
  });

  it("retries only failed video tasks that belong to the current continuity run", async () => {
    const tasksService = {
      findRetryableVideoGenerationTask: vi.fn(async (generationId: number) => ({
        id: generationId + 1_000,
      })),
      retryTask: vi.fn(async () => ({ task_id: 1 })),
    };
    const service = new DramaEpisodeContinuityService(
      { db: {} } as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tasksService as any,
    );
    const failedRun = {
      id: 71,
      episode_id: 41,
      status: "failed",
      items: [
        {
          id: 1,
          status: "completed",
          video_generation_id: 501,
        },
        {
          id: 2,
          status: "failed",
          video_generation_id: 502,
        },
        {
          id: 3,
          status: "blocked",
          video_generation_id: null,
        },
      ],
    };
    vi.spyOn(service, "getRun")
      .mockResolvedValueOnce(failedRun as any)
      .mockResolvedValueOnce({
        ...failedRun,
        status: "running",
      } as any);

    await expect(service.retryRun(41, 71, 7)).resolves.toMatchObject({
      id: 71,
      status: "running",
    });

    expect(tasksService.findRetryableVideoGenerationTask).toHaveBeenCalledTimes(
      1,
    );
    expect(tasksService.findRetryableVideoGenerationTask).toHaveBeenCalledWith(
      502,
      7,
    );
    expect(tasksService.retryTask).toHaveBeenCalledWith(1_502, { id: 7 });
  });

  it("rebuilds first-frame evidence without regenerating a completed video", async () => {
    const continuityProductionService = {
      completeVideoGeneration: vi.fn(async () => []),
    };
    const videosService = {
      loadOwnedVideoGeneration: vi.fn(async () => ({
        id: 502,
        videoUrl: "https://media.example/shot-2.mp4",
      })),
    };
    const service = new DramaEpisodeContinuityService(
      { db: {} } as any,
      {} as any,
      continuityProductionService as any,
      videosService as any,
    );
    const blockedRun = {
      id: 71,
      episode_id: 41,
      status: "failed",
      items: [
        {
          id: 2,
          status: "blocked",
          video_generation_id: 502,
          failure_code: "continuity_first_frame_failed",
        },
      ],
    };
    vi.spyOn(service, "getRun")
      .mockResolvedValueOnce(blockedRun as any)
      .mockResolvedValueOnce({
        ...blockedRun,
        status: "running",
      } as any);

    await expect(service.retryRun(41, 71, 7)).resolves.toMatchObject({
      id: 71,
      status: "running",
    });

    expect(videosService.loadOwnedVideoGeneration).toHaveBeenCalledWith(502, 7);
    expect(
      continuityProductionService.completeVideoGeneration,
    ).toHaveBeenCalledWith(502, "https://media.example/shot-2.mp4");
  });

  it("does not revive a user-canceled continuity run through retry", async () => {
    const service = new DramaEpisodeContinuityService(
      { db: {} } as any,
      {} as any,
    );
    vi.spyOn(service, "getRun").mockResolvedValue({
      id: 71,
      episode_id: 41,
      status: "canceled",
      items: [],
    } as any);

    await expect(service.retryRun(41, 71, 7)).rejects.toThrow(
      "continuity_production_run_canceled",
    );
  });
});
