import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";

import { DatabaseService } from "../../db/database.service";
import { AuthService } from "../auth/auth.service";
import { DramaAiFirstService } from "../dramas/drama-ai-first.service";
import { DramaStoryboardBreakdownService } from "../dramas/drama-storyboard-breakdown.service";
import { EpisodesController } from "./episodes.controller";

describe("EpisodesController", () => {
  it("forwards a storyboard breakdown request to the injected service", async () => {
    const episode = { id: 400, dramaId: 295 };
    const databaseService = {
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([episode])),
          })),
        })),
      },
    };
    const dramaAiFirstService = {};
    const dramaStoryboardBreakdownService = {
      requestBreakdown: vi.fn(() =>
        Promise.resolve({
          runtime_enabled: false,
        }),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [EpisodesController],
      providers: [
        { provide: DatabaseService, useValue: databaseService },
        { provide: AuthService, useValue: {} },
        { provide: DramaAiFirstService, useValue: dramaAiFirstService },
        {
          provide: DramaStoryboardBreakdownService,
          useValue: dramaStoryboardBreakdownService,
        },
      ],
    }).compile();
    const controller = moduleRef.get(EpisodesController);

    await expect(
      controller.requestStoryboardBreakdown("400", { id: 7 } as never),
    ).resolves.toEqual({ runtime_enabled: false });

    expect(dramaStoryboardBreakdownService.requestBreakdown).toHaveBeenCalledWith({
      userId: 7,
      dramaId: 295,
      episodeId: 400,
    });
    await moduleRef.close();
  });
});
