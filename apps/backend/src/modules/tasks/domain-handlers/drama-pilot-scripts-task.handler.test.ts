import { describe, expect, it, vi } from "vitest";

import { dramas, episodes, taskLogs } from "../../../db/schema";
import { DramaPilotScriptsTaskHandler } from "./drama-pilot-scripts-task.handler";

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 44,
    userId: 7,
    organizationId: null,
    dramaId: 88,
    domainId: 88,
    payloadJson: JSON.stringify({
      drama_id: 88,
      episode_ids: [301, 302],
      target_count: 2,
    }),
    resultSummaryJson: null,
    startedAt: null,
    status: "running",
    progress: 0,
    ...overrides,
  };
}

function createMemoryDatabase(
  options: {
    drama?: Record<string, unknown> | null;
    episodeRows?: Array<Record<string, unknown>>;
  } = {},
) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const drama =
    options.drama === undefined ? { id: 88, userId: 7 } : options.drama;
  const episodeRows = options.episodeRows ?? [
    { id: 301, status: "script_ready" },
    { id: 302, status: "script_generating" },
  ];
  const rowsFor = (table: unknown) => {
    if (table === dramas) return drama ? [drama] : [];
    if (table === episodes) return episodeRows;
    return [];
  };
  const makeQuery = (rows: Array<Record<string, unknown>>) => {
    const query: any = {
      where: vi.fn(() => query),
      limit: vi.fn((limit: number) => Promise.resolve(rows.slice(0, limit))),
      then: (resolve: any, reject: any) =>
        Promise.resolve(rows).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(rows).catch(reject),
    };
    return query;
  };

  return {
    updates,
    inserts,
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => makeQuery(rowsFor(table))),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => ({
          where: vi.fn(() => {
            updates.push(values);
            return Promise.resolve();
          }),
        })),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          inserts.push({ table, values });
          return Promise.resolve();
        }),
      })),
    },
  };
}

describe("DramaPilotScriptsTaskHandler", () => {
  it("keeps the direct DramaAiFirstService path when Hermes Runtime is disabled", async () => {
    const database = createMemoryDatabase();
    const dramaAiFirstService = {
      executePilotScriptsTask: vi.fn(() => Promise.resolve()),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => false),
      run: vi.fn(),
    };
    const handler = new DramaPilotScriptsTaskHandler(
      database as any,
      dramaAiFirstService as any,
      agentRuntimeService as any,
    );

    await expect(handler.execute(createTask() as any)).resolves.toBe(
      "drama_pilot_scripts",
    );

    expect(dramaAiFirstService.executePilotScriptsTask).toHaveBeenCalledWith({
      taskId: 44,
      userId: 7,
      dramaId: 88,
      episodeIds: [301, 302],
      limit: 2,
    });
    expect(agentRuntimeService.run).not.toHaveBeenCalled();
    expect(database.updates).toHaveLength(0);
  });

  it("starts a scoped Hermes Runtime run without calling the direct model path", async () => {
    const database = createMemoryDatabase();
    const dramaAiFirstService = {
      executePilotScriptsTask: vi.fn(),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(() =>
        Promise.resolve({
          executionId: 505,
          remoteRunId: "run-script-505",
          status: "running",
          pool: "drama-script-pool",
          instance: "hermes-script-1",
          reused: false,
        }),
      ),
    };
    const handler = new DramaPilotScriptsTaskHandler(
      database as any,
      dramaAiFirstService as any,
      agentRuntimeService as any,
    );

    await expect(handler.execute(createTask() as any)).resolves.toBe(
      "drama_pilot_scripts_agent_runtime",
    );

    expect(agentRuntimeService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 44,
        userId: 7,
        organizationId: null,
        dramaId: 88,
        toolProfile: "xiaochuang-drama-script",
        modelProfile: "xiaochuang-text-project",
        skillRefs: [
          "xiaochuang_runtime_policy@1.0.0",
          "drama_episode_script_writing@1.0.0",
        ],
        instruction: "开始执行当前已绑定任务。",
      }),
    );
    expect(dramaAiFirstService.executePilotScriptsTask).not.toHaveBeenCalled();
    expect(database.updates).toHaveLength(1);
    expect(database.updates[0]).toMatchObject({
      status: "running",
      progress: 5,
      providerTaskId: "agent_execution:505",
    });
    expect(
      JSON.parse(String(database.updates[0].resultSummaryJson)),
    ).toMatchObject({
      phase: "agent_runtime_running",
      runtime: "hermes",
      agent_execution_id: 505,
      remote_run_id: "run-script-505",
      pool: "drama-script-pool",
      instance: "hermes-script-1",
      episode_ids: [301, 302],
    });
    expect(
      database.inserts.find((insert) => insert.table === taskLogs)?.values,
    ).toMatchObject({
      taskId: 44,
      message: "剧本正文任务已启动",
    });
  });

  it("keeps the business task active when the runtime pool queues the run", async () => {
    const database = createMemoryDatabase();
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(() =>
        Promise.resolve({
          executionId: 506,
          remoteRunId: null,
          status: "queued",
          pool: "drama-script-pool",
          instance: null,
          reused: false,
        }),
      ),
    };
    const handler = new DramaPilotScriptsTaskHandler(
      database as any,
      { executePilotScriptsTask: vi.fn() } as any,
      agentRuntimeService as any,
    );

    await handler.execute(createTask() as any);

    expect(database.updates[0]).toMatchObject({
      status: "running",
      progress: 0,
      providerTaskId: "agent_execution:506",
    });
    expect(
      JSON.parse(String(database.updates[0].resultSummaryJson)),
    ).toMatchObject({
      phase: "agent_runtime_queued",
      runtime_status: "queued",
    });
  });

  it("does not overwrite an active runtime projection during presentation refresh", async () => {
    const database = createMemoryDatabase();
    const handler = new DramaPilotScriptsTaskHandler(
      database as any,
      { executePilotScriptsTask: vi.fn() } as any,
      { isEnabled: vi.fn(() => true), run: vi.fn() } as any,
    );

    await handler.refreshPresentation(
      createTask({
        resultSummaryJson: JSON.stringify({
          phase: "episode_script_submitted",
          agent_execution_id: 505,
          completed_episodes: 1,
        }),
      }) as any,
    );

    expect(database.updates).toHaveLength(0);
  });

  it("rejects invalid task scope before invoking either runtime path", async () => {
    const database = createMemoryDatabase();
    const dramaAiFirstService = {
      executePilotScriptsTask: vi.fn(),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(),
    };
    const handler = new DramaPilotScriptsTaskHandler(
      database as any,
      dramaAiFirstService as any,
      agentRuntimeService as any,
    );

    await expect(
      handler.execute(
        createTask({
          userId: null,
          dramaId: null,
          domainId: 0,
          payloadJson: JSON.stringify({}),
        }) as any,
      ),
    ).rejects.toThrow("invalid_task_user");

    expect(agentRuntimeService.run).not.toHaveBeenCalled();
    expect(dramaAiFirstService.executePilotScriptsTask).not.toHaveBeenCalled();
  });

  it("forwards cancellation to Hermes before canceling the business task", async () => {
    const database = createMemoryDatabase();
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      stop: vi.fn(() => Promise.resolve({ status: "canceled" })),
    };
    const handler = new DramaPilotScriptsTaskHandler(
      database as any,
      { executePilotScriptsTask: vi.fn() } as any,
      agentRuntimeService as any,
    );

    await expect(
      handler.cancel(
        createTask({
          progress: 36,
          resultSummaryJson: JSON.stringify({
            agent_execution_id: 505,
          }),
        }) as any,
        7,
      ),
    ).resolves.toEqual({ canceled: true });

    expect(agentRuntimeService.stop).toHaveBeenCalledWith(505, 7);
    expect(
      database.inserts.find((insert) => insert.table === taskLogs)?.values,
    ).toMatchObject({
      taskId: 44,
      message: "已请求取消 AI 生产任务",
    });
    expect(database.updates[database.updates.length - 1]).toMatchObject({
      status: "canceled",
      progress: 36,
      errorKind: "canceled",
    });
  });
});
