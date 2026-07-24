import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertContinuityVideoRetryAllowedMock,
  assertLegacyEpisodeProductionAllowedMock,
} = vi.hoisted(() => ({
  assertContinuityVideoRetryAllowedMock: vi.fn(),
  assertLegacyEpisodeProductionAllowedMock: vi.fn(),
}));

vi.mock("../../drama-workspace/continuity-production-gate", () => ({
  assertContinuityVideoRetryAllowed: assertContinuityVideoRetryAllowedMock,
  assertLegacyEpisodeProductionAllowed: assertLegacyEpisodeProductionAllowedMock,
}));

import { StoryboardComposeTaskHandler } from "./storyboard-compose-task.handler";
import { VideoGenerationTaskHandler } from "./video-generation-task.handler";
import { VideoMergeTaskHandler } from "./video-merge-task.handler";

function createDatabase(selectResponses: Array<Array<Record<string, unknown>>>) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(selectResponses.shift() ?? [])),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updates.push(values);
          return {
            where: vi.fn(() => Promise.resolve()),
          };
        }),
      })),
    },
  };
}

describe("continuity retry gates", () => {
  beforeEach(() => {
    assertContinuityVideoRetryAllowedMock.mockReset();
    assertLegacyEpisodeProductionAllowedMock.mockReset();
  });

  it("rejects a storyboard compose retry before resetting a current continuity storyboard", async () => {
    const database = createDatabase([
      [{
        id: 90,
        episodeId: 55,
        userId: 7,
        videoUrl: "/media/video.mp4",
      }],
    ]);
    assertLegacyEpisodeProductionAllowedMock.mockRejectedValueOnce(
      new Error("continuity_edit_revision_required"),
    );
    const handler = new StoryboardComposeTaskHandler(
      database as any,
      {} as any,
    );

    await expect(
      handler.retry({ id: 1, domainId: 90, userId: 7 } as any, {}),
    ).rejects.toThrow("continuity_edit_revision_required");

    expect(assertLegacyEpisodeProductionAllowedMock).toHaveBeenCalledWith(
      database,
      55,
      7,
    );
    expect(database.updates).toHaveLength(0);
  });

  it("rejects a legacy merge retry before clearing its rendered result", async () => {
    const database = createDatabase([
      [{
        id: 91,
        episodeId: 55,
        dramaId: 11,
        userId: 7,
        editRevisionId: null,
        scenes: "[]",
      }],
    ]);
    assertLegacyEpisodeProductionAllowedMock.mockRejectedValueOnce(
      new Error("continuity_edit_revision_required"),
    );
    const mergeService = {
      resetEditRevisionRenderForRetry: vi.fn(),
    };
    const handler = new VideoMergeTaskHandler(database as any, mergeService as any);

    await expect(
      handler.retry({ id: 2, domainId: 91, userId: 7 } as any, {}),
    ).rejects.toThrow("continuity_edit_revision_required");

    expect(assertLegacyEpisodeProductionAllowedMock).toHaveBeenCalledWith(
      database,
      55,
      7,
    );
    expect(database.updates).toHaveLength(0);
    expect(mergeService.resetEditRevisionRenderForRetry).not.toHaveBeenCalled();
  });

  it("keeps an edit-revision merge retry available", async () => {
    const database = createDatabase([
      [{
        id: 92,
        episodeId: 55,
        dramaId: 11,
        userId: 7,
        editRevisionId: 301,
        scenes: JSON.stringify(["/media/clip.mp4"]),
      }],
    ]);
    const mergeService = {
      resetEditRevisionRenderForRetry: vi.fn(() => Promise.resolve()),
    };
    const handler = new VideoMergeTaskHandler(database as any, mergeService as any);

    await expect(
      handler.retry({ id: 3, domainId: 92, userId: 7 } as any, {}),
    ).resolves.toEqual({ task_id: 3, merge_id: 92 });

    expect(assertLegacyEpisodeProductionAllowedMock).not.toHaveBeenCalled();
    expect(mergeService.resetEditRevisionRenderForRetry).toHaveBeenCalledWith(92);
    expect(database.updates).toHaveLength(2);
  });

  it("rejects a direct legacy video retry before resetting the generation", async () => {
    const database = createDatabase([
      [{
        id: 93,
        userId: 7,
      }],
    ]);
    assertContinuityVideoRetryAllowedMock.mockRejectedValueOnce(
      new Error("continuity_run_required"),
    );
    const handler = new VideoGenerationTaskHandler(
      database as any,
      {} as any,
    );

    await expect(
      handler.retry(
        {
          id: 4,
          domainId: 93,
          userId: 7,
          episodeId: 55,
          payloadJson: JSON.stringify({ storyboard_id: 404 }),
        } as any,
        {},
      ),
    ).rejects.toThrow("continuity_run_required");

    expect(assertContinuityVideoRetryAllowedMock).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        episodeId: 55,
        userId: 7,
        videoGenerationId: 93,
        storyboardId: undefined,
        payload: { storyboard_id: 404 },
      }),
    );
    expect(database.updates).toHaveLength(0);
  });

  it("keeps a verified continuity video retry on its original run", async () => {
    const database = createDatabase([
      [{
        id: 94,
        userId: 7,
      }],
    ]);
    assertContinuityVideoRetryAllowedMock.mockResolvedValueOnce({
      runId: 88,
      userId: 7,
      episodeId: 55,
    });
    const videosService = {
      retryContinuityVideoGeneration: vi.fn(() => Promise.resolve()),
    };
    const handler = new VideoGenerationTaskHandler(
      database as any,
      videosService as any,
    );

    await expect(
      handler.retry(
        {
          id: 5,
          domainId: 94,
          userId: 7,
          episodeId: 55,
          payloadJson: JSON.stringify({
            storyboard_id: 405,
            continuity_run_id: 88,
          }),
        } as any,
        {},
      ),
    ).resolves.toEqual({ task_id: 5, video_generation_id: 94 });

    expect(assertContinuityVideoRetryAllowedMock).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        storyboardId: undefined,
        payload: {
          storyboard_id: 405,
          continuity_run_id: 88,
        },
      }),
    );
    expect(videosService.retryContinuityVideoGeneration).toHaveBeenCalledWith({
      videoGenerationId: 94,
      runId: 88,
      userId: 7,
      episodeId: 55,
    });
    expect(database.updates).toHaveLength(2);
  });

  it("does not reset the media task when its verified continuity run cannot resume", async () => {
    const database = createDatabase([
      [{
        id: 95,
        userId: 7,
      }],
    ]);
    assertContinuityVideoRetryAllowedMock.mockResolvedValueOnce({
      runId: 89,
      userId: 7,
      episodeId: 55,
    });
    const videosService = {
      retryContinuityVideoGeneration: vi.fn(() =>
        Promise.reject(new Error("continuity_run_required")),
      ),
    };
    const handler = new VideoGenerationTaskHandler(
      database as any,
      videosService as any,
    );

    await expect(
      handler.retry(
        {
          id: 6,
          domainId: 95,
          userId: 7,
          episodeId: 55,
          payloadJson: JSON.stringify({ continuity_run_id: 89 }),
        } as any,
        {},
      ),
    ).rejects.toThrow("continuity_run_required");

    expect(database.updates).toHaveLength(0);
  });

  it("delegates user cancellation and worker termination to the continuity-aware video service", async () => {
    const database = createDatabase([
      [
        {
          id: 96,
          userId: 7,
          provider: "vidu",
          taskId: "provider-task-96",
        },
      ],
      [],
      [],
    ]);
    const videosService = {
      cancelVideoGeneration: vi.fn(() => Promise.resolve(true)),
      failVideoGeneration: vi.fn(() => Promise.resolve(true)),
    };
    const handler = new VideoGenerationTaskHandler(
      database as any,
      videosService as any,
    );

    await handler.cancel(
      { id: 7, domainId: 96, userId: 7, progress: 44 } as any,
      7,
    );
    await handler.markCanceled({ id: 8, domainId: 96 } as any);
    await handler.markFailed({ id: 9, domainId: 96 } as any, new Error("worker lost"));

    expect(videosService.cancelVideoGeneration).toHaveBeenNthCalledWith(
      1,
      96,
      "Canceled by user",
    );
    expect(videosService.cancelVideoGeneration).toHaveBeenNthCalledWith(
      2,
      96,
      "Canceled by worker",
    );
    expect(videosService.failVideoGeneration).toHaveBeenCalledWith(
      96,
      "worker lost",
    );
  });
});
