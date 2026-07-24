import { describe, expect, it, vi } from "vitest";

import { dramas, episodes, tasks } from "../../db/schema";
import {
  DramaStoryboardBreakdownService,
  STORYBOARD_BREAKDOWN_DOMAIN,
  STORYBOARD_BREAKDOWN_TASK_TYPE,
} from "./drama-storyboard-breakdown.service";

type Row = Record<string, unknown>;

function query(rows: Row[]) {
  const value: any = {
    where: vi.fn(() => value),
    limit: vi.fn((limit: number) => Promise.resolve(rows.slice(0, limit))),
    then: (resolve: (value: Row[]) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return value;
}

function createDatabase(input: {
  episode?: Row | null;
  drama?: Row | null;
  taskRows?: Row[];
}) {
  const inserts: Array<{ table: unknown; values: Row }> = [];
  const updates: Array<{ table: unknown; values: Row }> = [];
  const taskRows = input.taskRows ?? [];
  const rowsFor = (table: unknown) => {
    if (table === episodes) return input.episode === null ? [] : [input.episode ?? {}];
    if (table === dramas) return input.drama === null ? [] : [input.drama ?? {}];
    if (table === tasks) return taskRows;
    return [];
  };
  const db: any = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => query(rowsFor(table))),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Row) => {
        inserts.push({ table, values });
        return {
          returning: vi.fn(() =>
            Promise.resolve([
              {
                id: 901,
                status: "queued",
                ...values,
              },
            ]),
          ),
        };
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Row) => ({
        where: vi.fn(() => {
          updates.push({ table, values });
          return {
            returning: vi.fn(() =>
              Promise.resolve([
                {
                  id: 901,
                  status: "queued",
                  ...values,
                },
              ]),
            ),
          };
        }),
      })),
    })),
  };
  return { db, inserts, updates };
}

function createService(
  database = createDatabase({
    episode: {
      id: 101,
      userId: 7,
      dramaId: 282,
      episodeNumber: 3,
      scriptContent: "林夏回到旧城，打开母亲留下的信。",
      content: "",
      deletedAt: null,
    },
    drama: {
      id: 282,
      userId: 7,
      title: "旧城来信",
      deletedAt: null,
    },
  }),
  runtimeEnabled = true,
) {
  const taskQueueService = {
    enqueueTask: vi.fn(() => Promise.resolve()),
  };
  const dramaStoryGraphService = {
    getStoryGraphSummary: vi.fn(() =>
      Promise.resolve({
        graph: {
          id: 501,
          status: "ready",
          script_hash: "g".repeat(64),
        },
        is_stale: false,
      }),
    ),
  };
  const storyboardSetsService = {
    getEpisodeBaseline: vi.fn(() =>
      Promise.resolve({
        activeSetId: null,
        revision: null,
        contentHash: null,
        storyboardCount: 0,
        hasLegacyRows: false,
        hasMixedSets: false,
        humanEditedAt: null,
        hasProducedMedia: false,
      }),
    ),
  };
  const service = new DramaStoryboardBreakdownService(
    { db: database.db } as any,
    {
      get: vi.fn((key: string) => {
        if (key === "AGENT_RUNTIME_PROVIDER") {
          return runtimeEnabled ? "hermes" : "direct";
        }
        if (key === "HERMES_RUNTIME_PER_RUN_MCP_AUTH_ENABLED") {
          return runtimeEnabled;
        }
        return undefined;
      }),
    } as any,
    taskQueueService as any,
    dramaStoryGraphService as any,
    storyboardSetsService as any,
  );
  return {
    service,
    taskQueueService,
    dramaStoryGraphService,
    storyboardSetsService,
    ...database,
  };
}

describe("DramaStoryboardBreakdownService", () => {
  it("reuses an active storyboard task without resetting its frozen input", async () => {
    const database = createDatabase({
      episode: {
        id: 101,
        userId: 7,
        dramaId: 282,
        episodeNumber: 3,
        scriptContent: "林夏回到旧城，打开母亲留下的信。",
        content: "",
        deletedAt: null,
      },
      drama: { id: 282, userId: 7, title: "旧城来信", deletedAt: null },
      taskRows: [
        {
          id: 44,
          status: "running",
          attemptCount: 1,
          domainTable: STORYBOARD_BREAKDOWN_DOMAIN,
          domainId: 101,
        },
      ],
    });
    const { service, taskQueueService, inserts, updates } = createService(database);

    await expect(
      service.requestBreakdown({ userId: 7, dramaId: 282, episodeId: 101 }),
    ).resolves.toEqual({
      runtime_enabled: true,
      task_id: 44,
      status: "running",
      episode_id: 101,
    });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(taskQueueService.enqueueTask).not.toHaveBeenCalled();
  });

  it("creates a queued task with script, graph, and storyboard baseline frozen", async () => {
    const { service, taskQueueService, inserts } = createService();

    await expect(
      service.requestBreakdown({ userId: 7, dramaId: 282, episodeId: 101 }),
    ).resolves.toEqual({
      runtime_enabled: true,
      task_id: 901,
      status: "queued",
      episode_id: 101,
    });

    const taskInsert = inserts.find((entry) => entry.table === tasks);
    expect(taskInsert?.values).toMatchObject({
      type: STORYBOARD_BREAKDOWN_TASK_TYPE,
      domainTable: STORYBOARD_BREAKDOWN_DOMAIN,
      domainId: 101,
      dramaId: 282,
      episodeId: 101,
      status: "queued",
    });
    expect(JSON.parse(String(taskInsert?.values.payloadJson))).toMatchObject({
      operation: "storyboard_breakdown",
      drama_id: 282,
      episode_id: 101,
      story_graph_id: 501,
      story_graph_script_hash: "g".repeat(64),
      base_storyboard_revision: null,
      base_storyboard_content_hash: null,
    });
    expect(JSON.parse(String(taskInsert?.values.payloadJson)).episode_script_hash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(taskQueueService.enqueueTask).toHaveBeenCalledWith(901, {
      replaceExisting: false,
    });
  });

  it("keeps the old direct fallback explicit when Hermes Runtime is disabled", async () => {
    const { service, taskQueueService, inserts } = createService(undefined, false);

    await expect(
      service.requestBreakdown({ userId: 7, dramaId: 282, episodeId: 101 }),
    ).resolves.toEqual({ runtime_enabled: false });

    expect(inserts).toHaveLength(0);
    expect(taskQueueService.enqueueTask).not.toHaveBeenCalled();
  });
});
