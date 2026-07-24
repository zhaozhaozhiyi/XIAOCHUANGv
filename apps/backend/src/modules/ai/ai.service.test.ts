import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { DramaStoryGraphService } from "../dramas/drama-story-graph.service";
import { GridService } from "../grid/grid.service";
import { AiService } from "./ai.service";

describe("AiService", () => {
  it("receives the services that episode-domain skills depend on", async () => {
    const gridService = {};
    const dramaStoryGraphService = {};
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: GridService, useValue: gridService },
        {
          provide: DramaStoryGraphService,
          useValue: dramaStoryGraphService,
        },
      ],
    }).compile();
    const service = moduleRef.get(AiService) as unknown as {
      gridService: unknown;
      dramaStoryGraphService: unknown;
    };

    expect(service.gridService).toBe(gridService);
    expect(service.dramaStoryGraphService).toBe(dramaStoryGraphService);

    await moduleRef.close();
  });
});
