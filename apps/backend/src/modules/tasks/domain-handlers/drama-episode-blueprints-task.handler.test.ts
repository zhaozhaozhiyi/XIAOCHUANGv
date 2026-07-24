import { describe, expect, it, vi } from "vitest";

import { taskLogs } from "../../../db/schema";
import { DramaEpisodeBlueprintsTaskHandler } from "./drama-episode-blueprints-task.handler";

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 43,
    userId: 7,
    organizationId: null,
    dramaId: 88,
    domainId: 88,
    payloadJson: JSON.stringify({
      drama_id: 88,
      source_id: 100,
      selected_brief_id: "brief-a",
      target_episode_count: 24,
      replace_without_script: false,
    }),
    resultSummaryJson: null,
    startedAt: null,
    status: "running",
    ...overrides,
  };
}

function createMemoryDatabase() {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];

  return {
    updates,
    inserts,
    db: {
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

describe("DramaEpisodeBlueprintsTaskHandler", () => {
  it("keeps the direct DramaAiFirstService path when Hermes Runtime is disabled", async () => {
    const database = createMemoryDatabase();
    const dramaAiFirstService = {
      executeEpisodeBlueprintsTask: vi.fn(() => Promise.resolve()),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => false),
      run: vi.fn(),
    };
    const handler = new DramaEpisodeBlueprintsTaskHandler(
      database as any,
      dramaAiFirstService as any,
      agentRuntimeService as any,
    );

    await expect(handler.execute(createTask() as any)).resolves.toBe(
      "drama_episode_blueprints",
    );

    expect(
      dramaAiFirstService.executeEpisodeBlueprintsTask,
    ).toHaveBeenCalledWith({
      taskId: 43,
      userId: 7,
      dramaId: 88,
      replaceWithoutScript: false,
    });
    expect(agentRuntimeService.run).not.toHaveBeenCalled();
    expect(database.updates).toHaveLength(0);
  });

  it("starts a scoped Hermes Runtime run without calling the direct model path", async () => {
    const database = createMemoryDatabase();
    const dramaAiFirstService = {
      executeEpisodeBlueprintsTask: vi.fn(),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(() =>
        Promise.resolve({
          executionId: 503,
          remoteRunId: "run-plan-503",
          status: "running",
          pool: "drama-plan-pool",
          instance: "hermes-plan-1",
          reused: false,
        }),
      ),
    };
    const handler = new DramaEpisodeBlueprintsTaskHandler(
      database as any,
      dramaAiFirstService as any,
      agentRuntimeService as any,
    );

    await expect(handler.execute(createTask() as any)).resolves.toBe(
      "drama_episode_blueprints_agent_runtime",
    );

    expect(agentRuntimeService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 43,
        userId: 7,
        organizationId: null,
        dramaId: 88,
        toolProfile: "xiaochuang-drama-plan",
        modelProfile: "xiaochuang-text-project",
        skillRefs: [
          "xiaochuang_runtime_policy@1.0.0",
          "drama_episode_planning@1.0.0",
        ],
        instruction: "开始执行当前已绑定任务。",
      }),
    );
    expect(
      dramaAiFirstService.executeEpisodeBlueprintsTask,
    ).not.toHaveBeenCalled();
    expect(database.updates).toHaveLength(1);
    expect(database.updates[0]).toMatchObject({
      status: "running",
      progress: 5,
      providerTaskId: "agent_execution:503",
    });
    expect(
      JSON.parse(String(database.updates[0].resultSummaryJson)),
    ).toMatchObject({
      phase: "agent_runtime_running",
      runtime: "hermes",
      agent_execution_id: 503,
      remote_run_id: "run-plan-503",
      pool: "drama-plan-pool",
      instance: "hermes-plan-1",
      selected_brief_id: "brief-a",
      target_episode_count: 24,
    });
    expect(
      database.inserts.find((insert) => insert.table === taskLogs)?.values,
    ).toMatchObject({
      taskId: 43,
      message: "分集规划任务已启动",
    });
  });

  it("keeps the business task active when the runtime pool queues the run", async () => {
    const database = createMemoryDatabase();
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(() =>
        Promise.resolve({
          executionId: 504,
          remoteRunId: null,
          status: "queued",
          pool: "drama-plan-pool",
          instance: null,
          reused: false,
        }),
      ),
    };
    const handler = new DramaEpisodeBlueprintsTaskHandler(
      database as any,
      { executeEpisodeBlueprintsTask: vi.fn() } as any,
      agentRuntimeService as any,
    );

    await handler.execute(createTask() as any);

    expect(database.updates[0]).toMatchObject({
      status: "running",
      progress: 0,
      providerTaskId: "agent_execution:504",
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
    const handler = new DramaEpisodeBlueprintsTaskHandler(
      database as any,
      { executeEpisodeBlueprintsTask: vi.fn() } as any,
      { isEnabled: vi.fn(() => true), run: vi.fn() } as any,
    );

    await handler.refreshPresentation(
      createTask({
        resultSummaryJson: JSON.stringify({
          phase: "blueprint_batch_submitted",
          agent_execution_id: 503,
          generated_episodes: 8,
        }),
      }) as any,
    );

    expect(database.updates).toHaveLength(0);
  });

  it("rejects invalid task scope before invoking either runtime path", async () => {
    const database = createMemoryDatabase();
    const dramaAiFirstService = {
      executeEpisodeBlueprintsTask: vi.fn(),
    };
    const agentRuntimeService = {
      isEnabled: vi.fn(() => true),
      run: vi.fn(),
    };
    const handler = new DramaEpisodeBlueprintsTaskHandler(
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
      dramaAiFirstService.executeEpisodeBlueprintsTask,
    ).not.toHaveBeenCalled();
  });
});
