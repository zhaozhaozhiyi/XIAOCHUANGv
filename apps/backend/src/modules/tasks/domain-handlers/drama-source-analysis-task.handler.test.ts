import { describe, expect, it, vi } from "vitest";

import { dramaSourceChunks, dramaSources, taskLogs } from "../../../db/schema";
import { DramaSourceAnalysisTaskHandler } from "./drama-source-analysis-task.handler";

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    userId: 7,
    organizationId: null,
    dramaId: 88,
    domainId: 100,
    payloadJson: JSON.stringify({
      source_id: 100,
      drama_id: 88,
    }),
    resultSummaryJson: null,
    startedAt: null,
    ...overrides,
  };
}

function createMemoryDatabase(
  options: {
    chunks?: Array<Record<string, unknown>>;
    source?: Record<string, unknown>;
  } = {},
) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const source = options.source ?? {
    id: 100,
    userId: 7,
    dramaId: 88,
    title: "测试源稿",
    content: "她回到旧城，决定与过去和解。",
    estimatedTokens: 32,
    deletedAt: null,
  };
  const rowsFor = (table: unknown) => {
    if (table === dramaSourceChunks) return options.chunks ?? [];
    if (table === dramaSources) return source ? [source] : [];
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
          return {
            onConflictDoNothing: vi.fn(() => Promise.resolve()),
          };
        }),
      })),
    },
  };
}

describe("DramaSourceAnalysisTaskHandler", () => {
  it("keeps the direct DramaAiFirstService path when Hermes Runtime is disabled", async () => {
    const database = createMemoryDatabase();
    const dramaAiFirstService = {
      executeSourceAnalysisTask: vi.fn(() => Promise.resolve()),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => false),
      run: vi.fn(),
    };
    const handler = new DramaSourceAnalysisTaskHandler(
      database as any,
      dramaAiFirstService as any,
      agentRuntimeService as any,
    );

    await expect(handler.execute(createTask() as any)).resolves.toBe(
      "drama_source_analysis",
    );

    expect(dramaAiFirstService.executeSourceAnalysisTask).toHaveBeenCalledWith({
      taskId: 42,
      userId: 7,
      dramaId: 88,
      sourceId: 100,
    });
    expect(agentRuntimeService.run).not.toHaveBeenCalled();
    expect(database.updates).toHaveLength(0);
  });

  it("starts a scoped Hermes Runtime run without calling the direct model path", async () => {
    const database = createMemoryDatabase();
    const dramaAiFirstService = {
      executeSourceAnalysisTask: vi.fn(),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(() =>
        Promise.resolve({
          executionId: 501,
          remoteRunId: "run-source-501",
          status: "running",
          pool: "drama-source-pool",
          instance: "hermes-source-1",
          reused: false,
        }),
      ),
    };
    const handler = new DramaSourceAnalysisTaskHandler(
      database as any,
      dramaAiFirstService as any,
      agentRuntimeService as any,
    );

    await expect(handler.execute(createTask() as any)).resolves.toBe(
      "drama_source_analysis_agent_runtime",
    );

    expect(agentRuntimeService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 42,
        userId: 7,
        dramaId: 88,
        organizationId: null,
        toolProfile: "xiaochuang-drama-source",
        modelProfile: "xiaochuang-text-project",
        skillRefs: [
          "xiaochuang_runtime_policy@1.0.0",
          "drama_source_understanding@1.0.0",
        ],
        instruction: "开始执行当前已绑定任务。",
      }),
    );
    expect(
      dramaAiFirstService.executeSourceAnalysisTask,
    ).not.toHaveBeenCalled();
    expect(database.updates).toHaveLength(1);
    expect(database.updates[0]).toMatchObject({
      status: "running",
      progress: 5,
      providerTaskId: "agent_execution:501",
    });
    expect(
      JSON.parse(String(database.updates[0].resultSummaryJson)),
    ).toMatchObject({
      phase: "agent_runtime_running",
      runtime: "hermes",
      agent_execution_id: 501,
      remote_run_id: "run-source-501",
      pool: "drama-source-pool",
      instance: "hermes-source-1",
    });
    const logInsert = database.inserts.find(
      (insert) => insert.table === taskLogs,
    );
    expect(logInsert?.values).toMatchObject({
      taskId: 42,
      message: "源稿理解任务已启动",
    });
    const chunkInsert = database.inserts.find(
      (insert) => insert.table === dramaSourceChunks,
    );
    expect(chunkInsert?.values).toMatchObject({
      userId: 7,
      dramaId: 88,
      sourceId: 100,
      chunkNo: 1,
      status: "pending",
    });
  });

  it("keeps the business task active when the runtime pool queues the run", async () => {
    const database = createMemoryDatabase();
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(() =>
        Promise.resolve({
          executionId: 502,
          remoteRunId: null,
          status: "queued",
          pool: "drama-source-pool",
          instance: null,
          reused: false,
        }),
      ),
    };
    const handler = new DramaSourceAnalysisTaskHandler(
      database as any,
      { executeSourceAnalysisTask: vi.fn() } as any,
      agentRuntimeService as any,
    );

    await handler.execute(createTask() as any);

    expect(database.updates[0]).toMatchObject({
      status: "running",
      progress: 0,
      providerTaskId: "agent_execution:502",
    });
    expect(
      JSON.parse(String(database.updates[0].resultSummaryJson)),
    ).toMatchObject({
      phase: "agent_runtime_queued",
      runtime_status: "queued",
    });
  });

  it("rejects invalid task scope before invoking either runtime path", async () => {
    const database = createMemoryDatabase();
    const dramaAiFirstService = {
      executeSourceAnalysisTask: vi.fn(),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(),
    };
    const handler = new DramaSourceAnalysisTaskHandler(
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
    expect(
      dramaAiFirstService.executeSourceAnalysisTask,
    ).not.toHaveBeenCalled();
  });
});
