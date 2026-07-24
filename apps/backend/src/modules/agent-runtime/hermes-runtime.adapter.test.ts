import { describe, expect, it, vi } from "vitest";

import { HermesAgentHttpError } from "./hermes-agent.client";
import { HermesRuntimeAdapter } from "./hermes-runtime.adapter";

function createAdapter(overrides: Record<string, unknown> = {}) {
  const configOverrides = (overrides.config ?? {}) as Record<string, unknown>;
  const configService = {
    getOrThrow: vi.fn((key: string) => {
      if (key in configOverrides) return configOverrides[key];
      if (key === "AGENT_RUNTIME_PROVIDER") return "hermes";
      if (key === "AGENT_RUNTIME_MCP_SERVICE_KEY") return "mcp-service-key";
      if (key === "AGENT_RUNTIME_LEASE_TTL_SECONDS") return 900;
      if (key === "HERMES_RUNTIME_PER_RUN_MCP_AUTH_ENABLED") return true;
      if (key === "HERMES_RUNTIME_PER_RUN_MODEL_GATEWAY_AUTH_ENABLED")
        return true;
      return undefined;
    }),
  };
  const executionService = {
    createOrReuseActiveAttempt: vi.fn(),
    markStarting: vi.fn(),
    markRunning: vi.fn(),
    markQueued: vi.fn(),
    findOwned: vi.fn(),
    findById: vi.fn(),
    findActive: vi.fn(() => Promise.resolve([])),
    updateStatus: vi.fn(() => Promise.resolve()),
    recordEvent: vi.fn(() => Promise.resolve()),
  };
  const profileValidator = {
    prepare: vi.fn(),
  };
  const capabilityTokenService = {
    issue: vi.fn(),
  };
  const concurrencyBudget = {
    acquire: vi.fn(),
    renew: vi.fn(() => Promise.resolve(true)),
    release: vi.fn(() => Promise.resolve(true)),
    acquireEventProjector: vi.fn(() => Promise.resolve("projector-owner")),
    renewEventProjector: vi.fn(() => Promise.resolve(true)),
    releaseEventProjector: vi.fn(() => Promise.resolve(true)),
  };
  const poolRegistry = {
    getCandidateInstances: vi.fn(),
    findInstance: vi.fn(),
  };
  const hermesAgentClient = {
    createRun: vi.fn(),
    getRun: vi.fn(),
    stopRun: vi.fn(),
    streamEvents: vi.fn(),
  };
  const adapter = new HermesRuntimeAdapter(
    configService as any,
    executionService as any,
    profileValidator as any,
    capabilityTokenService as any,
    concurrencyBudget as any,
    poolRegistry as any,
    hermesAgentClient as any,
  );
  return {
    adapter,
    configService,
    executionService,
    profileValidator,
    capabilityTokenService,
    concurrencyBudget,
    poolRegistry,
    hermesAgentClient,
    ...overrides,
  };
}

describe("HermesRuntimeAdapter", () => {
  it("fails closed when the MCP service identity is not configured", async () => {
    const runtime = createAdapter({
      config: {
        AGENT_RUNTIME_MCP_SERVICE_KEY: "",
      },
    });

    await expect(runtime.adapter.run({} as any)).rejects.toThrow(
      "hermes_runtime_mcp_service_key_missing",
    );
    expect(runtime.profileValidator.prepare).not.toHaveBeenCalled();
    expect(runtime.hermesAgentClient.createRun).not.toHaveBeenCalled();
  });

  it("fails closed when per-run Model Gateway auth is not enabled", async () => {
    const runtime = createAdapter({
      config: {
        HERMES_RUNTIME_PER_RUN_MODEL_GATEWAY_AUTH_ENABLED: false,
      },
    });

    await expect(runtime.adapter.run({} as any)).rejects.toThrow(
      "hermes_runtime_per_run_model_gateway_auth_not_enabled",
    );
    expect(runtime.profileValidator.prepare).not.toHaveBeenCalled();
    expect(runtime.hermesAgentClient.createRun).not.toHaveBeenCalled();
  });

  it("passes the validated skill manifest to the Hermes run client", async () => {
    const runtime = createAdapter();
    const prepared = {
      profile: {
        taskId: 44,
        userId: 7,
        organizationId: null,
        dramaId: 12,
        toolProfile: "xiaochuang-drama-source",
        modelProfile: "xiaochuang-text-project",
        skillRefs: ["drama_adaptation_copilot@1.0.0"],
        instruction: "run source analysis",
      },
      pool: {
        name: "drama-source-pool",
        allowedTools: ["get_task_context"],
        maxConcurrentRuns: 2,
        maxConcurrentRunsPerUser: 1,
      },
      skillManifest: [
        {
          ref: "drama_adaptation_copilot@1.0.0",
          id: "drama_adaptation_copilot",
          version: "1.0.0",
          sha256: "a".repeat(64),
        },
      ],
    };
    runtime.profileValidator.prepare.mockResolvedValue(prepared);
    runtime.executionService.createOrReuseActiveAttempt.mockResolvedValue({
      execution: {
        id: 301,
        sessionId: "u:7:drama:12:task:44:attempt:1",
        checkpointJson: null,
        remoteRunId: null,
        status: "created",
      },
      reused: false,
    });
    runtime.capabilityTokenService.issue.mockReturnValue({
      token: "capability-token",
      claims: { jti: "capability-jti" },
    });
    runtime.poolRegistry.getCandidateInstances.mockReturnValue([
      { name: "hermes-source-1", baseUrl: "http://hermes.test" },
    ]);
    runtime.concurrencyBudget.acquire.mockResolvedValue({ status: "acquired" });
    runtime.hermesAgentClient.createRun.mockResolvedValue({
      remoteRunId: "run_301",
      status: "started",
    });
    runtime.hermesAgentClient.streamEvents.mockResolvedValue(undefined);

    await expect(runtime.adapter.run(prepared.profile)).resolves.toMatchObject({
      executionId: 301,
      remoteRunId: "run_301",
      status: "running",
    });

    expect(runtime.hermesAgentClient.createRun).toHaveBeenCalledWith(
      { name: "hermes-source-1", baseUrl: "http://hermes.test" },
      expect.objectContaining({
        skillManifest: prepared.skillManifest,
      }),
    );
  });

  it("fails an execution and stops the remote run when an unexpected approval is requested", async () => {
    const runtime = createAdapter();
    runtime.hermesAgentClient.streamEvents.mockImplementation(
      async ({ onEvent }: { onEvent: (event: Record<string, unknown>) => Promise<void> }) => {
        await onEvent({ event: "approval.request", run_id: "run_1" });
      },
    );
    runtime.hermesAgentClient.stopRun.mockResolvedValue({});

    await (runtime.adapter as any).projectEvents(
      101,
      { name: "hermes-source-1", baseUrl: "http://hermes.test" },
      "run_1",
      "projector-owner",
    );

    expect(runtime.executionService.recordEvent).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ event: "approval.request" }),
    );
    expect(runtime.hermesAgentClient.stopRun).toHaveBeenCalledWith(
      { name: "hermes-source-1", baseUrl: "http://hermes.test" },
      "run_1",
    );
    expect(runtime.executionService.updateStatus).toHaveBeenCalledWith(
      101,
      "failed",
      expect.objectContaining({
        errorKind: "approval_required",
      }),
    );
    expect(runtime.concurrencyBudget.release).toHaveBeenCalledWith(101);
  });

  it("marks a missing remote run orphaned and releases its lease during reconciliation", async () => {
    const runtime = createAdapter();
    (runtime.executionService.findActive as any).mockResolvedValue([
      {
        id: 102,
        status: "running",
        remoteRunId: "run_2",
        checkpointJson: JSON.stringify({
          pool: "drama-source-pool",
          instance: "hermes-source-1",
        }),
      },
    ]);
    runtime.poolRegistry.findInstance.mockReturnValue({
      pool: { name: "drama-source-pool" },
      instance: { name: "hermes-source-1", baseUrl: "http://hermes.test" },
    });
    runtime.hermesAgentClient.getRun.mockRejectedValue(
      new HermesAgentHttpError("not found", 404, ""),
    );

    const result = await runtime.adapter.reconcileActive(20);

    expect(result).toMatchObject({
      enabled: true,
      checked: 1,
      orphaned: 1,
    });
    expect(runtime.executionService.updateStatus).toHaveBeenCalledWith(
      102,
      "orphaned",
      expect.objectContaining({
        errorMessage: "hermes_runtime_run_not_found",
      }),
    );
    expect(runtime.concurrencyBudget.release).toHaveBeenCalledWith(102);
  });

  it("treats an unexpected remote cancellation as an orphaned execution", async () => {
    const runtime = createAdapter();
    (runtime.executionService.findActive as any).mockResolvedValue([
      {
        id: 107,
        status: "running",
        remoteRunId: "run_7",
        checkpointJson: JSON.stringify({
          pool: "drama-source-pool",
          instance: "hermes-source-1",
        }),
      },
    ]);
    runtime.poolRegistry.findInstance.mockReturnValue({
      pool: { name: "drama-source-pool" },
      instance: { name: "hermes-source-1", baseUrl: "http://hermes.test" },
    });
    runtime.hermesAgentClient.getRun.mockResolvedValue({
      status: "cancelled",
      raw: {},
    });

    const result = await runtime.adapter.reconcileActive(20);

    expect(result).toMatchObject({
      enabled: true,
      checked: 1,
      orphaned: 1,
    });
    expect(runtime.executionService.updateStatus).toHaveBeenCalledWith(
      107,
      "orphaned",
      expect.objectContaining({
        errorKind: "runtime",
        errorMessage: "hermes_runtime_run_cancelled",
      }),
    );
    expect(runtime.concurrencyBudget.release).toHaveBeenCalledWith(107);
  });

  it("re-attaches one SSE projector for a recovered remote run and renews the lease", async () => {
    const runtime = createAdapter();
    (runtime.executionService.findActive as any).mockResolvedValue([
      {
        id: 103,
        status: "running",
        remoteRunId: "run_3",
        checkpointJson: JSON.stringify({
          pool: "drama-plan-pool",
          instance: "hermes-plan-1",
        }),
      },
    ]);
    runtime.poolRegistry.findInstance.mockReturnValue({
      pool: { name: "drama-plan-pool" },
      instance: { name: "hermes-plan-1", baseUrl: "http://hermes.test" },
    });
    runtime.hermesAgentClient.getRun.mockResolvedValue({
      status: "running",
      raw: {},
    });
    let resolveStream: (() => void) | undefined;
    runtime.hermesAgentClient.streamEvents.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStream = resolve;
        }),
    );

    await runtime.adapter.reconcileActive(20);
    await runtime.adapter.reconcileActive(20);

    expect(runtime.hermesAgentClient.streamEvents).toHaveBeenCalledTimes(1);
    expect(runtime.concurrencyBudget.renew).toHaveBeenCalledTimes(2);
    expect(runtime.concurrencyBudget.acquireEventProjector).toHaveBeenCalledTimes(
      1,
    );
    resolveStream?.();
  });

  it("does not attach an SSE projector when another Backend instance owns the execution lease", async () => {
    const runtime = createAdapter();
    (runtime.executionService.findActive as any).mockResolvedValue([
      {
        id: 105,
        status: "running",
        remoteRunId: "run_5",
        checkpointJson: JSON.stringify({
          pool: "drama-script-pool",
          instance: "hermes-script-1",
        }),
      },
    ]);
    runtime.poolRegistry.findInstance.mockReturnValue({
      pool: { name: "drama-script-pool" },
      instance: { name: "hermes-script-1", baseUrl: "http://hermes.test" },
    });
    runtime.hermesAgentClient.getRun.mockResolvedValue({
      status: "running",
      raw: {},
    });
    (runtime.concurrencyBudget.acquireEventProjector as any).mockResolvedValue(
      null,
    );

    await runtime.adapter.reconcileActive(20);

    expect(runtime.concurrencyBudget.acquireEventProjector).toHaveBeenCalledWith(
      105,
    );
    expect(runtime.hermesAgentClient.streamEvents).not.toHaveBeenCalled();
  });

  it("records a non-terminal SSE disconnect and re-attaches the projector", async () => {
    const runtime = createAdapter();
    (runtime.executionService.findActive as any).mockResolvedValue([
      {
        id: 104,
        status: "running",
        remoteRunId: "run_4",
        checkpointJson: JSON.stringify({
          pool: "drama-script-pool",
          instance: "hermes-script-1",
        }),
      },
    ]);
    runtime.poolRegistry.findInstance.mockReturnValue({
      pool: { name: "drama-script-pool" },
      instance: { name: "hermes-script-1", baseUrl: "http://hermes.test" },
    });
    runtime.hermesAgentClient.getRun.mockResolvedValue({
      status: "running",
      raw: {},
    });

    let failFirstProjection: ((error: Error) => void) | undefined;
    runtime.hermesAgentClient.streamEvents.mockImplementation(() => {
      if (runtime.hermesAgentClient.streamEvents.mock.calls.length === 1) {
        return new Promise<void>((_resolve, reject) => {
          failFirstProjection = reject;
        });
      }
      return new Promise<void>(() => undefined);
    });

    await runtime.adapter.reconcileActive(20);
    expect(runtime.hermesAgentClient.streamEvents).toHaveBeenCalledTimes(1);

    failFirstProjection?.(new Error("sse_connection_lost"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.executionService.recordEvent).toHaveBeenCalledWith(
      104,
      expect.objectContaining({
        event: "runtime.sse_disconnected",
        error: "sse_connection_lost",
      }),
    );
    expect(
      runtime.concurrencyBudget.releaseEventProjector,
    ).toHaveBeenCalledWith(104, "projector-owner");

    await runtime.adapter.reconcileActive(20);
    expect(runtime.hermesAgentClient.streamEvents).toHaveBeenCalledTimes(2);
  });

  it("treats an unexpected run.cancelled event as orphaned instead of a user cancellation", async () => {
    const runtime = createAdapter();
    runtime.executionService.findById.mockResolvedValue({
      id: 108,
      status: "running",
    });
    runtime.hermesAgentClient.streamEvents.mockImplementation(
      async ({ onEvent }: { onEvent: (event: Record<string, unknown>) => Promise<void> }) => {
        await onEvent({ event: "run.cancelled", run_id: "run_8" });
      },
    );

    await (runtime.adapter as any).projectEvents(
      108,
      { name: "hermes-source-1", baseUrl: "http://hermes.test" },
      "run_8",
      "projector-owner",
    );

    expect(runtime.executionService.updateStatus).toHaveBeenCalledWith(
      108,
      "orphaned",
      expect.objectContaining({
        errorKind: "runtime",
        errorMessage: "hermes_runtime_run_cancelled",
      }),
    );
    expect(runtime.concurrencyBudget.release).toHaveBeenCalledWith(108);
  });

  it("preserves a requested run.cancelled event as a user cancellation", async () => {
    const runtime = createAdapter();
    runtime.executionService.findById.mockResolvedValue({
      id: 109,
      status: "stopping",
    });
    runtime.hermesAgentClient.streamEvents.mockImplementation(
      async ({ onEvent }: { onEvent: (event: Record<string, unknown>) => Promise<void> }) => {
        await onEvent({ event: "run.cancelled", run_id: "run_9" });
      },
    );

    await (runtime.adapter as any).projectEvents(
      109,
      { name: "hermes-source-1", baseUrl: "http://hermes.test" },
      "run_9",
      "projector-owner",
    );

    expect(runtime.executionService.updateStatus).toHaveBeenCalledWith(
      109,
      "canceled",
      expect.objectContaining({
        errorKind: null,
        errorMessage: null,
      }),
    );
    expect(runtime.concurrencyBudget.release).toHaveBeenCalledWith(109);
  });

  it("aborts an SSE projector that loses its cross-process lease without recording a disconnect", async () => {
    const runtime = createAdapter();
    runtime.concurrencyBudget.renewEventProjector.mockResolvedValue(false);
    let signal: AbortSignal | undefined;
    let onHeartbeat: (() => Promise<void>) | undefined;
    runtime.hermesAgentClient.streamEvents.mockImplementation(
      ({
        signal: inputSignal,
        onHeartbeat: inputOnHeartbeat,
      }: {
        signal?: AbortSignal;
        onHeartbeat: () => Promise<void>;
      }) =>
        new Promise<void>((_resolve, reject) => {
          signal = inputSignal;
          onHeartbeat = inputOnHeartbeat;
          inputSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const projection = (runtime.adapter as any).projectEvents(
      106,
      { name: "hermes-plan-1", baseUrl: "http://hermes.test" },
      "run_6",
      "projector-owner",
    );

    await onHeartbeat?.();
    await projection;

    expect(signal?.aborted).toBe(true);
    expect(runtime.concurrencyBudget.renewEventProjector).toHaveBeenCalledWith(
      106,
      "projector-owner",
    );
    expect(runtime.executionService.recordEvent).toHaveBeenCalledWith(
      106,
      expect.objectContaining({
        event: "runtime.sse_projector_lease_lost",
      }),
    );
    expect(runtime.executionService.recordEvent).not.toHaveBeenCalledWith(
      106,
      expect.objectContaining({
        event: "runtime.sse_disconnected",
      }),
    );
    expect(
      runtime.concurrencyBudget.releaseEventProjector,
    ).toHaveBeenCalledWith(106, "projector-owner");
  });
});
