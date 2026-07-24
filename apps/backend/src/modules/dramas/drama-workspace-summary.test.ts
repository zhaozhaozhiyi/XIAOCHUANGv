import { describe, expect, it } from "vitest";

import {
  buildDramaWorkspaceHref,
  resolveDramaWorkspaceTaskStage,
} from "../drama-workspace/drama-workspace-routing";

describe("drama workspace summary routing", () => {
  it("builds focused episode workspace links with route context", () => {
    expect(
      buildDramaWorkspaceHref(7, "assets", {
        episodeNumber: 2,
        shotId: 99,
        taskId: 3001,
        origin: "final-gap",
      }),
    ).toBe("/drama/7/episodes/2?stage=assets&origin=final-gap&shot=99&task=3001");
  });

  it("maps backend task signatures to workspace stages", () => {
    expect(resolveDramaWorkspaceTaskStage(task({ domainTable: "drama_story_graph_build" }))).toBe("graph");
    expect(resolveDramaWorkspaceTaskStage(task({ domainTable: "storyboard_breakdown" }))).toBe("storyboard");
    expect(resolveDramaWorkspaceTaskStage(task({ domainTable: "image_generations" }))).toBe("assets");
    expect(resolveDramaWorkspaceTaskStage(task({ domainTable: "storyboard_tts" }))).toBe("video");
    expect(resolveDramaWorkspaceTaskStage(task({ domainTable: "video_merges", type: "merge" }))).toBe("final");
    expect(resolveDramaWorkspaceTaskStage(task({ payloadJson: "{\"skill_id\":\"storyboard_breaker\"}" }))).toBe("storyboard");
  });
});

function task(overrides: Partial<Record<"domainTable" | "type" | "sourceType" | "payloadJson", string>>) {
  return {
    id: 1,
    domainTable: "",
    type: "generation",
    sourceType: "drama_workspace",
    ...overrides,
  } as never;
}
