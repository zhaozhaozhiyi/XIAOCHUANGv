import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireOwnedStoryboardMock, downloadFileMock } = vi.hoisted(() => ({
  requireOwnedStoryboardMock: vi.fn(),
  downloadFileMock: vi.fn(async () => ({
    url: "stored://video.mp4",
    key: "videos/k",
  })),
}));

vi.mock("../images/images.ownership", () => ({
  requireOwnedStoryboard: requireOwnedStoryboardMock,
}));

vi.mock("../images/images.storage", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, downloadFile: downloadFileMock };
});

import { VideosService } from "./videos.service";

function createClaimService(opts: { claimReturns: unknown[] }) {
  const updateChain = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateChain),
    returning: vi.fn(() => Promise.resolve(opts.claimReturns)),
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() =>
          Promise.resolve([
            {
              id: 90,
              taskId: "vidu_d",
              status: "processing",
              storyboardId: null,
            },
          ]),
        ),
      })),
    })),
    update: vi.fn(() => updateChain),
  };
  const videosTasksService = {
    syncTaskForVideoGeneration: vi.fn(() => Promise.resolve()),
  };
  const service = new VideosService(
    { db } as any,
    {} as any,
    videosTasksService as any,
    {} as any,
    {} as any,
  );
  return { service, db, videosTasksService };
}

function createBuildRequestDatabase(
  responses: Array<Record<string, unknown>[]>,
) {
  return {
    select: vi.fn(() => {
      const rows = responses.shift() ?? [];
      const result = {
        limit: vi.fn(() => Promise.resolve(rows)),
        then: (
          resolve: (value: Record<string, unknown>[]) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => result),
      };
      return chain;
    }),
  };
}

function ownedStoryboard(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    userId: 7,
    episodeId: 55,
    storyboardSetId: 401,
    composedImage: null,
    firstFrameImage: null,
    lastFrameImage: null,
    referenceImages: null,
    duration: 8,
    videoPrompt: "人物转身进入室内",
    imagePrompt: null,
    description: null,
    action: null,
    result: null,
    atmosphere: null,
    title: "镜头 1",
    dialogue: null,
    ...overrides,
  };
}

function createTerminalWebhookService(status: string) {
  const record = {
    id: 88,
    taskId: "vidu_terminal",
    status,
    duration: null,
    storyboardId: 99,
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([record])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  };
  const videosTasksService = {
    syncTaskForVideoGeneration: vi.fn(() => Promise.resolve()),
  };
  const service = new VideosService(
    { db } as any,
    {} as any,
    videosTasksService as any,
    {} as any,
    {} as any,
  );

  return { service, db, videosTasksService };
}

describe("VideosService handleViduWebhook", () => {
  it.each(["completed", "failed", "canceled", "cancelled"])(
    "does not reprocess terminal video generations with status %s",
    async (status) => {
      const { service, db, videosTasksService } =
        createTerminalWebhookService(status);

      const result = await service.handleViduWebhook({
        task_id: "vidu_terminal",
        state: "success",
        video_url: "https://example.com/video.mp4",
      });

      expect(result).toEqual({ message: `Task already ${status}` });
      expect(db.update).not.toHaveBeenCalled();
      expect(
        videosTasksService.syncTaskForVideoGeneration,
      ).not.toHaveBeenCalled();
    },
  );
});

describe("VideosService direct storyboard generation", () => {
  it("requires a continuity run for a current storyboard with a continuity contract", async () => {
    requireOwnedStoryboardMock.mockResolvedValue(ownedStoryboard());
    const db = createBuildRequestDatabase([
      [{ id: 401 }],
      [{ id: 901 }],
    ]);
    const service = new VideosService(
      { db } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.buildVideoRequest({ storyboard_id: 99, prompt: "人物转身" }, 7),
    ).rejects.toMatchObject({ message: "continuity_run_required" });
  });

  it("keeps direct generation available for legacy storyboards without a continuity set", async () => {
    requireOwnedStoryboardMock.mockResolvedValue(
      ownedStoryboard({ storyboardSetId: null }),
    );
    const db = createBuildRequestDatabase([
      [{ id: 55, dramaId: 42, videoConfigId: 7 }],
      [{ id: 42, style: null }],
    ]);
    const service = new VideosService(
      { db } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.buildVideoRequest({ storyboard_id: 99, prompt: "人物转身" }, 7),
    ).resolves.toMatchObject({
      storyboardId: 99,
      dramaId: 42,
    });
  });

  it("allows the trusted continuity-run path to build the same request", async () => {
    requireOwnedStoryboardMock.mockResolvedValue(ownedStoryboard());
    const db = createBuildRequestDatabase([
      [{ id: 55, dramaId: 42, videoConfigId: 7 }],
      [{ id: 42, style: null }],
    ]);
    const service = new VideosService(
      { db } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.buildVideoRequest(
        { storyboard_id: 99, prompt: "人物转身" },
        7,
        { isContinuityRun: true },
      ),
    ).resolves.toMatchObject({
      storyboardId: 99,
      dramaId: 42,
    });
  });
});

describe("VideosService reference rejection", () => {
  it("keeps reference inputs and fails visibly instead of retrying without references", async () => {
    const record = {
      id: 89,
      status: "pending",
      storyboardId: 99,
      referenceMode: "first_last",
      imageUrl: null,
      firstFrameUrl: "https://example.com/previous-tail.png",
      lastFrameUrl: "https://example.com/planned-tail.png",
      referenceImageUrls: JSON.stringify(["https://example.com/character.png"]),
      model: "video-01",
      prompt: "角色转身进入室内",
      duration: 5,
      aspectRatio: "16:9",
    };
    const storyboard = {
      id: 99,
      videoUrl: null,
      composedVideoUrl: null,
    };
    const selectRows = [[record], [record], [storyboard]];
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(selectRows.shift() ?? [])),
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
    };
    const videosTasksService = {
      syncTaskForVideoGeneration: vi.fn(() => Promise.resolve()),
    };
    const service = new VideosService(
      { db } as any,
      {} as any,
      videosTasksService as any,
      {} as any,
      {} as any,
    );
    vi.spyOn(service as any, "normalizeVideoReferenceUrl").mockImplementation(
      async (value: unknown) => (typeof value === "string" ? value : null),
    );
    vi.spyOn(service as any, "normalizeVideoReferenceUrls").mockResolvedValue([
      "https://example.com/character.png",
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () =>
          "InputImageSensitiveContentDetected.PrivacyInformation",
      })),
    );

    await (service as any).processVideoGenerationWithConfig(89, {
      provider: "minimax",
      baseUrl: "https://example.com",
      apiKey: "test-key",
      model: "video-01",
      settings: {},
    });

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          errorMsg: expect.stringContaining("continuity_reference_rejected"),
        }),
      ]),
    );
    expect(updates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referenceMode: "none",
        }),
      ]),
    );
    expect(videosTasksService.syncTaskForVideoGeneration).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('VideosService handleVideoComplete claim-before-download', () => {
  beforeEach(() => {
    downloadFileMock.mockClear()
  })

  it('claim 失败（已被另一并发调用认领）时不下载、不写终态', async () => {
    const { service, db, videosTasksService } = createClaimService({ claimReturns: [] })

    await (service as any).handleVideoComplete(90, 'https://example.com/v.mp4', null, null)

    expect(downloadFileMock).not.toHaveBeenCalled()
    expect(videosTasksService.syncTaskForVideoGeneration).not.toHaveBeenCalled()
    // claim 阶段只调用一次 update（RETURNING 返回空即返回，不进入 complete 写库）
    expect(db.update).toHaveBeenCalledTimes(1)
  })

  it('claim 成功时才下载并写 completed', async () => {
    const { service, videosTasksService } = createClaimService({ claimReturns: [{ id: 90, storyboardId: null }] })

    await (service as any).handleVideoComplete(90, 'https://example.com/v.mp4', null, null)

    expect(downloadFileMock).toHaveBeenCalledTimes(1)
    expect(videosTasksService.syncTaskForVideoGeneration).toHaveBeenCalledWith(90)
  })
})
