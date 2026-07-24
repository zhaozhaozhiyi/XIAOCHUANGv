import { describe, expect, it, vi } from "vitest";

import {
  assertContinuityVideoRetryAllowed,
  assertLegacyEpisodeProductionAllowed,
} from "./continuity-production-gate";

function createDatabase(
  responses: Array<Array<Record<string, unknown>>>,
) {
  const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];

  return {
    db: {
      select: vi.fn(() => {
        const rows = responses.shift() ?? [];
        const chain = {
          from: vi.fn(),
          innerJoin: vi.fn(),
          where: vi.fn(),
          limit: vi.fn(),
        };
        chain.from.mockReturnValue(chain);
        chain.innerJoin.mockReturnValue(chain);
        chain.where.mockReturnValue(chain);
        chain.limit.mockResolvedValue(rows);
        chains.push(chain);
        return chain;
      }),
    },
    chains,
  };
}

describe("assertLegacyEpisodeProductionAllowed", () => {
  it("blocks legacy compose and merge paths when the current set has continuity contracts", async () => {
    const database = createDatabase([[{ id: 901 }]]);

    await expect(
      assertLegacyEpisodeProductionAllowed(database as any, 55, 7),
    ).rejects.toMatchObject({
      message: "continuity_edit_revision_required",
    });
  });

  it("keeps legacy production available without a current continuity contract", async () => {
    const database = createDatabase([[]]);

    await expect(
      assertLegacyEpisodeProductionAllowed(database as any, 55, 7),
    ).resolves.toBeUndefined();
  });

  it("keeps internal compatibility calls without a user context untouched", async () => {
    const database = createDatabase([[{ id: 901 }]]);

    await expect(
      assertLegacyEpisodeProductionAllowed(database as any, 55),
    ).resolves.toBeUndefined();
    expect(database.db.select).not.toHaveBeenCalled();
  });
});

describe("assertContinuityVideoRetryAllowed", () => {
  const retryInput = {
    episodeId: 55,
    userId: 7,
    videoGenerationId: 902,
  };

  it("rejects a direct legacy video retry for a current continuity episode", async () => {
    const database = createDatabase([[{ id: 901 }]]);

    await expect(
      assertContinuityVideoRetryAllowed(database as any, {
        ...retryInput,
        payload: {},
      }),
    ).rejects.toMatchObject({
      message: "continuity_run_required",
    });
    expect(database.db.select).toHaveBeenCalledTimes(1);
  });

  it("allows a retry only when the task payload run id is bound to that video generation", async () => {
    const database = createDatabase([[{ id: 901 }], [{ id: 18 }]]);

    await expect(
      assertContinuityVideoRetryAllowed(database as any, {
        ...retryInput,
        payload: { continuity_run_id: 77 },
      }),
    ).resolves.toEqual({
      runId: 77,
      userId: 7,
      episodeId: 55,
    });
    expect(database.db.select).toHaveBeenCalledTimes(2);
  });

  it("rejects a forged or stale continuity run id", async () => {
    const database = createDatabase([[{ id: 901 }], []]);

    await expect(
      assertContinuityVideoRetryAllowed(database as any, {
        ...retryInput,
        payload: { continuity_run_id: 77 },
      }),
    ).rejects.toMatchObject({
      message: "continuity_run_required",
    });
  });

  it("derives the current continuity episode from the generation storyboard", async () => {
    const database = createDatabase([[{ episodeId: 55, userId: 7 }], [{ id: 901 }]]);

    await expect(
      assertContinuityVideoRetryAllowed(database as any, {
        episodeId: null,
        userId: 7,
        storyboardId: 405,
        videoGenerationId: 902,
        payload: {},
      }),
    ).rejects.toMatchObject({
      message: "continuity_run_required",
    });
    expect(database.db.select).toHaveBeenCalledTimes(2);
  });
});
