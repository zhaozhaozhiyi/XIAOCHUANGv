import { describe, expect, it, vi } from "vitest";

import { dramas, taskLogs } from "../../../db/schema";
import { DramaStoryGraphBuildTaskHandler } from "./drama-story-graph-build-task.handler";

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 45,
    userId: 7,
    organizationId: null,
    dramaId: 88,
    domainId: 88,
    payloadJson: JSON.stringify({
      drama_id: 88,
      graph_id: 501,
      script_hash: "a".repeat(64),
      episode_numbers: [1, 2],
    }),
    resultSummaryJson: null,
    startedAt: null,
    status: "running",
    progress: 0,
    ...overrides,
  };
}

function createMemoryDatabase() {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const makeQuery = (rows: Array<Record<string, unknown>>) => {
    const query: any = {
      where: vi.fn(() => query),
      limit: vi.fn((limit: number) => Promise.resolve(rows.slice(0, limit))),
      then: (resolve: any, reject: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return query;
  };

  return {
    updates,
    inserts,
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) =>
          makeQuery(table === dramas ? [{ id: 88, userId: 7 }] : []),
        ),
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

describe("DramaStoryGraphBuildTaskHandler", () => {
  it("keeps the direct graph build path when Hermes Runtime is disabled", async () => {
    const database = createMemoryDatabase();
    const dramaStoryGraphService = {
      executeBuildTask: vi.fn(() => Promise.resolve()),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => false),
      run: vi.fn(),
    };
    const handler = new DramaStoryGraphBuildTaskHandler(
      database as any,
      dramaStoryGraphService as any,
      agentRuntimeService as any,
    );

    await expect(handler.execute(createTask() as any)).resolves.toBe(
      "drama_story_graph_build",
    );

    expect(dramaStoryGraphService.executeBuildTask).toHaveBeenCalledWith({
      taskId: 45,
      userId: 7,
      dramaId: 88,
      graphId: 501,
    });
    expect(agentRuntimeService.run).not.toHaveBeenCalled();
    expect(database.updates).toHaveLength(0);
  });

  it("starts a scoped Hermes Runtime graph run without calling the local extractor", async () => {
    const database = createMemoryDatabase();
    const dramaStoryGraphService = {
      executeBuildTask: vi.fn(),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(() =>
        Promise.resolve({
          executionId: 507,
          remoteRunId: "run-graph-507",
          status: "running",
          pool: "drama-graph-pool",
          instance: "hermes-graph-1",
          reused: false,
        }),
      ),
    };
    const handler = new DramaStoryGraphBuildTaskHandler(
      database as any,
      dramaStoryGraphService as any,
      agentRuntimeService as any,
    );

    await expect(handler.execute(createTask() as any)).resolves.toBe(
      "drama_story_graph_build_agent_runtime",
    );

    expect(agentRuntimeService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 45,
        userId: 7,
        organizationId: null,
        dramaId: 88,
        toolProfile: "xiaochuang-drama-graph",
        modelProfile: "xiaochuang-text-project",
        skillRefs: [
          "xiaochuang_runtime_policy@1.0.0",
          "drama_story_graph_build@1.0.0",
        ],
        instruction: "开始执行当前已绑定任务。",
      }),
    );
    expect(dramaStoryGraphService.executeBuildTask).not.toHaveBeenCalled();
    expect(database.updates).toHaveLength(1);
    expect(database.updates[0]).toMatchObject({
      status: "running",
      progress: 5,
      providerTaskId: "agent_execution:507",
    });
    expect(
      JSON.parse(String(database.updates[0].resultSummaryJson)),
    ).toMatchObject({
      phase: "agent_runtime_running",
      runtime: "hermes",
      agent_execution_id: 507,
      remote_run_id: "run-graph-507",
      graph_id: 501,
    });
    expect(
      database.inserts.find((insert) => insert.table === taskLogs)?.values,
    ).toMatchObject({
      taskId: 45,
      message: "故事地图任务已启动",
    });
  });

  it("keeps the business task active when the runtime pool queues the graph run", async () => {
    const database = createMemoryDatabase();
    const handler = new DramaStoryGraphBuildTaskHandler(
      database as any,
      { executeBuildTask: vi.fn() } as any,
      {
        isEnabled: vi.fn(() => true),
        run: vi.fn(() =>
          Promise.resolve({
            executionId: 508,
            remoteRunId: null,
            status: "queued",
            pool: "drama-graph-pool",
            instance: null,
            reused: false,
          }),
        ),
      } as any,
    );

    await handler.execute(createTask() as any);

    expect(database.updates[0]).toMatchObject({
      status: "running",
      progress: 0,
      providerTaskId: "agent_execution:508",
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
    const handler = new DramaStoryGraphBuildTaskHandler(
      database as any,
      { executeBuildTask: vi.fn() } as any,
      { isEnabled: vi.fn(() => true), run: vi.fn() } as any,
    );

    await handler.refreshPresentation(
      createTask({
        resultSummaryJson: JSON.stringify({
          phase: "story_graph_batch_submitted",
          agent_execution_id: 507,
        }),
      }) as any,
    );

    expect(database.updates).toHaveLength(0);
  });

  it("forwards cancellation to Hermes before resetting the graph task", async () => {
    const database = createMemoryDatabase();
    const dramaStoryGraphService = {
      cancelBuildTask: vi.fn(() => Promise.resolve()),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      stop: vi.fn(() => Promise.resolve({ status: "canceled" })),
    };
    const handler = new DramaStoryGraphBuildTaskHandler(
      database as any,
      dramaStoryGraphService as any,
      agentRuntimeService as any,
    );

    await expect(
      handler.cancel(
        createTask({
          progress: 42,
          resultSummaryJson: JSON.stringify({
            agent_execution_id: 507,
          }),
        }) as any,
        7,
      ),
    ).resolves.toEqual({ canceled: true });

    expect(agentRuntimeService.stop).toHaveBeenCalledWith(507, 7);
    expect(dramaStoryGraphService.cancelBuildTask).toHaveBeenCalledWith({
      taskId: 45,
      graphId: 501,
      dramaId: 88,
      userId: 7,
    });
    expect(
      database.inserts.find((insert) => insert.table === taskLogs)?.values,
    ).toMatchObject({
      taskId: 45,
      message: "已请求取消 AI 生产任务",
    });
    expect(database.updates[database.updates.length - 1]).toMatchObject({
      status: "canceled",
      progress: 42,
    });
  });
});
