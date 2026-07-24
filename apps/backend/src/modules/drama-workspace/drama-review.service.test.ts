import { describe, expect, it } from "vitest";

import { resolveReviewCheckpointForTarget } from "./drama-review.service";

const target = {
  subjectType: "episode_script",
  subjectId: "12",
  versionKey: "v2",
} as const;

describe("resolveReviewCheckpointForTarget", () => {
  it("keeps the exact current version review status", () => {
    const resolved = resolveReviewCheckpointForTarget(target, [
      checkpoint({ versionKey: "v2", reviewStatus: "confirmed" }),
      checkpoint({ versionKey: "v1", reviewStatus: "confirmed" }),
    ]);

    expect(resolved).toMatchObject({
      reviewStatus: "confirmed",
      reviewNote: "ok",
    });
  });

  it("marks a previously reviewed subject as stale when the version changes", () => {
    const resolved = resolveReviewCheckpointForTarget(target, [
      checkpoint({ versionKey: "v1", reviewStatus: "confirmed" }),
    ]);

    expect(resolved).toMatchObject({
      reviewStatus: "stale",
      reviewNote: "当前版本已更新，请重新确认。",
    });
  });

  it("ignores archived historical reviews when resolving current status", () => {
    const resolved = resolveReviewCheckpointForTarget(target, [
      checkpoint({ versionKey: "v1", reviewStatus: "archived" }),
    ]);

    expect(resolved.reviewStatus).toBe("pending_confirmation");
  });
});

function checkpoint(overrides: Partial<{
  versionKey: string;
  reviewStatus: string;
  reviewNote: string | null;
}>) {
  return {
    subjectType: "episode_script",
    subjectId: "12",
    versionKey: "v1",
    reviewStatus: "confirmed",
    reviewNote: "ok",
    reviewedAt: new Date("2026-07-13T00:00:00.000Z"),
    updatedAt: new Date("2026-07-13T00:00:00.000Z"),
    ...overrides,
  };
}
