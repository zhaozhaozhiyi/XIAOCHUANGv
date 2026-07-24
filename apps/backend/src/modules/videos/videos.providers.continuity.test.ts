import { describe, expect, it, vi } from "vitest";

import { getVideoAdapter } from "./videos.providers.registry";

const config = {
  provider: "minimax",
  baseUrl: "https://video.example",
  apiKey: "test-key",
  model: "video-01",
};

describe("video provider continuity references", () => {
  it.each(["minimax", "volcengine"])(
    "%s keeps locked asset references when a continuous shot also has real start and planned end anchors",
    (provider) => {
      const request = getVideoAdapter(provider).buildGenerateRequest(
        { ...config, provider },
        {
          id: 1,
          model: "video-01",
          prompt: "角色沿着上一镜动作继续转身",
          referenceMode: "first_last",
          firstFrameUrl: "https://media.example/real-tail.jpg",
          lastFrameUrl: "https://media.example/planned-end.jpg",
          referenceImageUrls: JSON.stringify([
            "https://media.example/character.png",
            "https://media.example/scene.png",
          ]),
          duration: 6,
          aspectRatio: "16:9",
        },
      );
      const content =
        provider === "volcengine"
          ? request.body.content
          : request.body.content;

      expect(content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            image_url: expect.objectContaining({
              url: "https://media.example/real-tail.jpg",
            }),
            role: "first_frame",
          }),
          expect.objectContaining({
            image_url: expect.objectContaining({
              url: "https://media.example/planned-end.jpg",
            }),
            role: "last_frame",
          }),
          expect.objectContaining({
            image_url: expect.objectContaining({
              url: "https://media.example/character.png",
            }),
            role: "reference_image",
          }),
          expect.objectContaining({
            image_url: expect.objectContaining({
              url: "https://media.example/scene.png",
            }),
            role: "reference_image",
          }),
        ]),
      );
    },
  );

  it("keeps Vidu's real start and end anchors alongside the locked reference images", () => {
    vi.stubEnv("WEBHOOK_BASE_URL", "https://app.example");
    vi.stubEnv("VIDU_WEBHOOK_SECRET", "test-secret");
    const request = getVideoAdapter("vidu").buildGenerateRequest(
      { ...config, provider: "vidu" },
      {
        id: 1,
        model: "video-01",
        prompt: "角色承接上一镜动作",
        referenceMode: "first_last",
        firstFrameUrl: "https://media.example/real-tail.jpg",
        lastFrameUrl: "https://media.example/planned-end.jpg",
        referenceImageUrls: JSON.stringify([
          "https://media.example/character.png",
        ]),
        duration: 6,
        aspectRatio: "16:9",
      },
    );

    expect(request.body.images).toEqual([
      "https://media.example/real-tail.jpg",
      "https://media.example/planned-end.jpg",
      "https://media.example/character.png",
    ]);
    vi.unstubAllEnvs();
  });
});
