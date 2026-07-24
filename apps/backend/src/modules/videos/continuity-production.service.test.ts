import { describe, expect, it, vi } from "vitest";

import {
  characters,
  episodeMediaProductionRuns,
  episodeMediaRunItems,
  scenes,
  storyboardBoundaries,
  storyboards,
} from "../../db/schema";
import { ContinuityProductionService } from "./continuity-production.service";

type Row = Record<string, unknown>;

function createSequencedDatabase(sequences: Map<unknown, Row[][]>) {
  const updates: Array<{ table: unknown; values: Row }> = [];
  const takeRows = (table: unknown) => sequences.get(table)?.shift() ?? [];
  return {
    updates,
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          const rows = takeRows(table);
          return {
            where: vi.fn(() => Promise.resolve(rows)),
            orderBy: vi.fn(() => Promise.resolve(rows)),
          };
        }),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Row) => {
          updates.push({ table, values });
          return {
            where: vi.fn(() => Promise.resolve()),
          };
        }),
      })),
    },
  };
}

describe("ContinuityProductionService planning", () => {
  it("waits for a continuous predecessor while allowing an intentional cut to start independently", () => {
    const service = new ContinuityProductionService({} as any, {} as any);

    const preview = service.previewRun({
      userId: 7,
      dramaId: 23,
      episodeId: 41,
      storyboardSetId: 301,
      storyboards: [
        {
          id: 101,
          storyboardNumber: 1,
          firstFrameImage: "https://media.example/shot-1.png",
          composedImage: null,
          lastFrameImage: null,
        },
        {
          id: 102,
          storyboardNumber: 2,
          firstFrameImage: null,
          composedImage: null,
          lastFrameImage: null,
        },
        {
          id: 103,
          storyboardNumber: 3,
          firstFrameImage: "https://media.example/shot-3.png",
          composedImage: null,
          lastFrameImage: null,
        },
      ] as any,
      boundaries: [
        {
          id: 801,
          fromStoryboardId: 101,
          toStoryboardId: 102,
          relationType: "continuous",
        },
        {
          id: 802,
          fromStoryboardId: 102,
          toStoryboardId: 103,
          relationType: "intentional_cut",
        },
      ] as any,
    });

    expect(preview.blocked).toEqual([]);
    expect(preview.will_generate).toEqual([
      { storyboard_id: 101, mode: "anchor_from_assets" },
      { storyboard_id: 103, mode: "anchor_from_assets" },
    ]);
    expect(preview.will_wait).toEqual([
      {
        storyboard_id: 102,
        depends_on_storyboard_id: 101,
        reason: "等待上一镜的真实尾帧",
      },
    ]);
  });
});

describe("ContinuityProductionService execution", () => {
  it("extracts a completed video's real tail frame and uses it to unlock the dependent shot", async () => {
    const upstream = {
      id: 11,
      productionRunId: 71,
      storyboardId: 101,
      boundaryId: null,
      status: "generating",
      videoGenerationId: 501,
      startAnchorUrl: "https://media.example/shot-1.png",
      plannedEndAnchorUrl: null,
    };
    const child = {
      id: 12,
      productionRunId: 71,
      storyboardId: 102,
      boundaryId: 901,
      predecessorItemId: 11,
      status: "waiting_dependency",
      videoGenerationId: null,
      startAnchorUrl: null,
      plannedEndAnchorUrl: "https://media.example/shot-2-end.png",
    };
    const run = {
      id: 71,
      userId: 7,
      dramaId: 23,
      episodeId: 41,
      status: "running",
    };
    const database = createSequencedDatabase(
      new Map<unknown, Row[][]>([
        [
          episodeMediaRunItems,
          [
            [upstream],
            [child],
            [
              {
                ...child,
                status: "ready",
                startAnchorUrl: "https://media.example/shot-1-real-tail.jpg",
              },
            ],
            [
              { ...upstream, status: "completed" },
              { ...child, status: "ready" },
            ],
          ],
        ],
        [episodeMediaProductionRuns, [[run], [run]]],
        [
          storyboards,
          [
            [
              {
                id: 102,
                deletedAt: null,
              },
            ],
          ],
        ],
        [
          storyboardBoundaries,
          [
            [
              {
                id: 901,
                userId: 7,
                dramaId: 23,
                episodeId: 41,
                assetLockJson: JSON.stringify({
                  character_ids: [201],
                  scene_ids: [301],
                }),
                deletedAt: null,
              },
            ],
          ],
        ],
        [
          characters,
          [
            [
              {
                id: 201,
                imageUrl: "https://media.example/character.png",
                referenceImages: JSON.stringify([
                  "https://media.example/character-alt.png",
                ]),
              },
            ],
          ],
        ],
        [
          scenes,
          [
            [
              {
                id: 301,
                imageUrl: "https://media.example/scene.png",
              },
            ],
          ],
        ],
      ]),
    );
    const tailFrameService = {
      extractTailFrame: vi.fn(async () => ({
        url: "https://media.example/shot-1-real-tail.jpg",
      })),
      extractFirstFrame: vi.fn(async () => ({
        url: "https://media.example/shot-1-real-first.jpg",
      })),
    };
    const service = new ContinuityProductionService(
      database as any,
      tailFrameService as any,
    );

    const instructions = await service.completeVideoGeneration(
      501,
      "https://media.example/shot-1.mp4",
    );

    expect(tailFrameService.extractTailFrame).toHaveBeenCalledWith(
      "https://media.example/shot-1.mp4",
    );
    expect(tailFrameService.extractFirstFrame).toHaveBeenCalledWith(
      "https://media.example/shot-1.mp4",
    );
    expect(database.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: episodeMediaRunItems,
          values: expect.objectContaining({
            status: "completed",
            actualFirstFrameUrl: "https://media.example/shot-1-real-first.jpg",
            actualTailFrameUrl: "https://media.example/shot-1-real-tail.jpg",
          }),
        }),
        expect.objectContaining({
          table: episodeMediaRunItems,
          values: expect.objectContaining({
            status: "ready",
            startAnchorUrl: "https://media.example/shot-1-real-tail.jpg",
          }),
        }),
      ]),
    );
    expect(instructions).toEqual([
      {
        runId: 71,
        runItemId: 12,
        userId: 7,
        dramaId: 23,
        episodeId: 41,
        storyboardId: 102,
        startAnchorUrl: "https://media.example/shot-1-real-tail.jpg",
        plannedEndAnchorUrl: "https://media.example/shot-2-end.png",
        referenceImageUrls: [
          "https://media.example/character.png",
          "https://media.example/character-alt.png",
          "https://media.example/scene.png",
        ],
      },
    ]);
  });

  it("marks the completed destination shot's boundary ready for human review", async () => {
    const completedDestination = {
      id: 12,
      productionRunId: 71,
      storyboardId: 102,
      boundaryId: 901,
      status: "generating",
      videoGenerationId: 502,
    };
    const run = {
      id: 71,
      userId: 7,
      dramaId: 23,
      episodeId: 41,
      status: "running",
    };
    const database = createSequencedDatabase(
      new Map<unknown, Row[][]>([
        [
          episodeMediaRunItems,
          [
            [completedDestination],
            [],
            [{ ...completedDestination, status: "completed" }],
          ],
        ],
        [episodeMediaProductionRuns, [[run], [run]]],
      ]),
    );
    const service = new ContinuityProductionService(
      database as any,
      {
        extractTailFrame: vi.fn(async () => ({
          url: "https://media.example/shot-2-real-tail.jpg",
        })),
        extractFirstFrame: vi.fn(async () => ({
          url: "https://media.example/shot-2-real-first.jpg",
        })),
      } as any,
    );

    await service.completeVideoGeneration(
      502,
      "https://media.example/shot-2.mp4",
    );

    expect(database.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: storyboardBoundaries,
          values: expect.objectContaining({
            status: "review_required",
          }),
        }),
      ]),
    );
  });

  it("blocks only the failed shot's dependent chain and leaves independent work running", async () => {
    const root = {
      id: 11,
      productionRunId: 71,
      storyboardId: 101,
      status: "generating",
      videoGenerationId: 501,
    };
    const child = {
      id: 12,
      productionRunId: 71,
      storyboardId: 102,
      predecessorItemId: 11,
      status: "waiting_dependency",
    };
    const grandchild = {
      id: 13,
      productionRunId: 71,
      storyboardId: 103,
      predecessorItemId: 12,
      status: "waiting_dependency",
    };
    const independent = {
      id: 14,
      productionRunId: 71,
      storyboardId: 104,
      predecessorItemId: null,
      status: "ready",
    };
    const run = { id: 71, status: "running" };
    const database = createSequencedDatabase(
      new Map<unknown, Row[][]>([
        [
          episodeMediaRunItems,
          [
            [root],
            [child],
            [grandchild],
            [],
            [
              { ...root, status: "failed" },
              { ...child, status: "blocked" },
              { ...grandchild, status: "blocked" },
              independent,
            ],
          ],
        ],
        [episodeMediaProductionRuns, [[run]]],
      ]),
    );
    const service = new ContinuityProductionService(database as any, {} as any);

    await service.markVideoGenerationFailed(501, new Error("provider failed"));

    expect(database.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: episodeMediaRunItems,
          values: expect.objectContaining({
            status: "failed",
            failureCode: "continuity_video_generation_failed",
          }),
        }),
        expect.objectContaining({
          table: episodeMediaRunItems,
          values: expect.objectContaining({
            status: "blocked",
            failureCode: "continuity_upstream_video_failed",
          }),
        }),
      ]),
    );
    expect(database.updates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: episodeMediaProductionRuns,
          values: expect.objectContaining({ status: "failed" }),
        }),
      ]),
    );
  });

  it("cancels a running shot, blocks its dependent chain, and closes the run", async () => {
    const root = {
      id: 11,
      productionRunId: 71,
      storyboardId: 101,
      status: "generating",
      videoGenerationId: 501,
    };
    const child = {
      id: 12,
      productionRunId: 71,
      storyboardId: 102,
      predecessorItemId: 11,
      status: "waiting_dependency",
    };
    const grandchild = {
      id: 13,
      productionRunId: 71,
      storyboardId: 103,
      predecessorItemId: 12,
      status: "waiting_dependency",
    };
    const run = { id: 71, status: "running" };
    const database = createSequencedDatabase(
      new Map<unknown, Row[][]>([
        [
          episodeMediaRunItems,
          [
            [root],
            [child],
            [grandchild],
            [],
            [
              { ...root, status: "canceled" },
              { ...child, status: "blocked" },
              { ...grandchild, status: "blocked" },
            ],
          ],
        ],
        [episodeMediaProductionRuns, [[run]]],
      ]),
    );
    const service = new ContinuityProductionService(database as any, {} as any);

    await service.markVideoGenerationCanceled(501, "Canceled by user");

    expect(database.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: episodeMediaRunItems,
          values: expect.objectContaining({
            status: "canceled",
            failureCode: "continuity_video_generation_canceled",
          }),
        }),
        expect.objectContaining({
          table: episodeMediaRunItems,
          values: expect.objectContaining({
            status: "blocked",
            failureCode: "continuity_upstream_video_canceled",
          }),
        }),
        expect.objectContaining({
          table: episodeMediaProductionRuns,
          values: expect.objectContaining({ status: "failed" }),
        }),
      ]),
    );
  });

  it("reopens a verified retry and restores only descendants blocked by that upstream failure", async () => {
    const failedItem = {
      id: 11,
      productionRunId: 71,
      storyboardId: 101,
      status: "failed",
      videoGenerationId: 501,
      failureCode: "continuity_video_generation_failed",
    };
    const blockedChild = {
      id: 12,
      productionRunId: 71,
      storyboardId: 102,
      predecessorItemId: 11,
      status: "blocked",
      videoGenerationId: null,
      failureCode: "continuity_upstream_video_failed",
    };
    const blockedGrandchild = {
      id: 13,
      productionRunId: 71,
      storyboardId: 103,
      predecessorItemId: 12,
      status: "blocked",
      videoGenerationId: null,
      failureCode: "continuity_upstream_video_failed",
    };
    const run = {
      id: 71,
      userId: 7,
      episodeId: 41,
      status: "failed",
    };
    const database = createSequencedDatabase(
      new Map<unknown, Row[][]>([
        [
          episodeMediaRunItems,
          [[failedItem], [blockedChild], [blockedGrandchild], []],
        ],
        [episodeMediaProductionRuns, [[run]]],
      ]),
    );
    const service = new ContinuityProductionService(database as any, {} as any);

    await service.retryVideoGeneration({
      videoGenerationId: 501,
      runId: 71,
      userId: 7,
      episodeId: 41,
    });

    expect(database.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: episodeMediaRunItems,
          values: expect.objectContaining({
            status: "generating",
            failureCode: null,
          }),
        }),
        expect.objectContaining({
          table: episodeMediaProductionRuns,
          values: expect.objectContaining({
            status: "running",
            currentStoryboardId: 101,
            completedAt: null,
          }),
        }),
        expect.objectContaining({
          table: episodeMediaRunItems,
          values: expect.objectContaining({
            status: "waiting_dependency",
            failureCode: null,
          }),
        }),
      ]),
    );
  });

  it("reopens descendants blocked by a canceled upstream shot", async () => {
    const canceledItem = {
      id: 11,
      productionRunId: 71,
      storyboardId: 101,
      status: "canceled",
      videoGenerationId: 501,
      failureCode: "continuity_video_generation_canceled",
    };
    const blockedChild = {
      id: 12,
      productionRunId: 71,
      storyboardId: 102,
      predecessorItemId: 11,
      status: "blocked",
      videoGenerationId: null,
      failureCode: "continuity_upstream_video_canceled",
    };
    const run = {
      id: 71,
      userId: 7,
      episodeId: 41,
      status: "failed",
    };
    const database = createSequencedDatabase(
      new Map<unknown, Row[][]>([
        [episodeMediaRunItems, [[canceledItem], [blockedChild], []]],
        [episodeMediaProductionRuns, [[run]]],
      ]),
    );
    const service = new ContinuityProductionService(database as any, {} as any);

    await service.retryVideoGeneration({
      videoGenerationId: 501,
      runId: 71,
      userId: 7,
      episodeId: 41,
    });

    expect(database.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: episodeMediaRunItems,
          values: expect.objectContaining({ status: "generating" }),
        }),
        expect.objectContaining({
          table: episodeMediaRunItems,
          values: expect.objectContaining({
            status: "waiting_dependency",
            failureCode: null,
          }),
        }),
      ]),
    );
  });
});
