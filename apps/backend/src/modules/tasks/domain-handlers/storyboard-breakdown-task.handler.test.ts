import { describe, expect, it, vi } from "vitest";

import { dramas, taskLogs } from "../../../db/schema";
import { StoryboardBreakdownTaskHandler } from "./storyboard-breakdown-task.handler";

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 45,
    userId: 7,
    organizationId: null,
    dramaId: 282,
    episodeId: 101,
    domainId: 101,
    payloadJson: JSON.stringify({
      operation: "storyboard_breakdown",
      drama_id: 282,
      episode_id: 101,
      story_graph_id: 501,
      episode_script_hash: "a".repeat(64),
      story_graph_script_hash: "b".repeat(64),
      base_storyboard_revision: null,
      base_storyboard_content_hash: null,
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
  const query = {
    where: vi.fn(function where() {
      return query;
    }),
    limit: vi.fn(() => Promise.resolve([{ id: 282, userId: 7 }])),
  };
  return {
    updates,
    inserts,
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          if (table !== dramas) return query;
          return query;
        }),
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

describe("StoryboardBreakdownTaskHandler", () => {
  it("starts a scoped Hermes run with the storyboard skill and no direct model call", async () => {
    const database = createMemoryDatabase();
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(() =>
        Promise.resolve({
          executionId: 701,
          remoteRunId: "run-storyboard-701",
          status: "running",
          pool: "drama-storyboard-pool",
          instance: "hermes-storyboard-1",
          reused: false,
        }),
      ),
    };
    const handler = new StoryboardBreakdownTaskHandler(
      database as any,
      agentRuntimeService as any,
    );

    await expect(handler.execute(createTask() as any)).resolves.toBe(
      "storyboard_breakdown_agent_runtime",
    );

    expect(agentRuntimeService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 45,
        userId: 7,
        organizationId: null,
        dramaId: 282,
        toolProfile: "xiaochuang-drama-storyboard",
        modelProfile: "xiaochuang-text-project",
        skillRefs: [
          "xiaochuang_runtime_policy@1.0.0",
          "drama_storyboard_planning@1.0.0",
        ],
        instruction: "开始执行当前已绑定任务。",
      }),
    );
    expect(database.updates[0]).toMatchObject({
      status: "running",
      progress: 5,
      providerTaskId: "agent_execution:701",
    });
    expect(JSON.parse(String(database.updates[0].resultSummaryJson))).toMatchObject({
      phase: "agent_runtime_running",
      runtime: "hermes",
      agent_execution_id: 701,
      remote_run_id: "run-storyboard-701",
    });
    expect(
      database.inserts.find((entry) => entry.table === taskLogs)?.values,
    ).toMatchObject({
      taskId: 45,
      message: "正在拆解本集分镜",
    });
  });

  it("keeps the business task active while the Hermes pool is queued", async () => {
    const database = createMemoryDatabase();
    const handler = new StoryboardBreakdownTaskHandler(
      database as any,
      {
        isEnabled: vi.fn(() => true),
        run: vi.fn(() =>
          Promise.resolve({
            executionId: 702,
            remoteRunId: null,
            status: "queued",
            pool: "drama-storyboard-pool",
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
      providerTaskId: "agent_execution:702",
    });
    expect(JSON.parse(String(database.updates[0].resultSummaryJson))).toMatchObject({
      phase: "agent_runtime_queued",
      runtime_status: "queued",
    });
  });

  it("forwards cancellation to Hermes before closing the business task", async () => {
    const database = createMemoryDatabase();
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      stop: vi.fn(() => Promise.resolve({ status: "canceled" })),
    };
    const handler = new StoryboardBreakdownTaskHandler(
      database as any,
      agentRuntimeService as any,
    );

    await expect(
      handler.cancel(
        createTask({
          progress: 42,
          resultSummaryJson: JSON.stringify({ agent_execution_id: 701 }),
        }) as any,
        7,
      ),
    ).resolves.toEqual({ canceled: true });

    expect(agentRuntimeService.stop).toHaveBeenCalledWith(701, 7);
    expect(database.updates.at(-1)).toMatchObject({
      status: "canceled",
      progress: 42,
      errorKind: "canceled",
    });
  });

  it("resets a failed storyboard task for retry without losing its frozen payload", async () => {
    const database = createMemoryDatabase();
    const handler = new StoryboardBreakdownTaskHandler(
      database as any,
      { isEnabled: vi.fn(() => true) } as any,
    );
    const task = createTask({
      status: "failed",
      progress: 12,
      errorMessage: "timeout",
    }) as any;

    await expect(handler.retry(task, {})).resolves.toEqual({
      task_id: 45,
      status: "queued",
    });

    expect(database.updates[0]).toMatchObject({
      status: "queued",
      progress: 0,
      providerTaskId: null,
      errorKind: null,
      errorMessage: null,
    });
    expect(JSON.parse(String(database.updates[0].payloadJson))).toMatchObject({
      episode_id: 101,
      story_graph_id: 501,
      episode_script_hash: "a".repeat(64),
    });
  });
});
