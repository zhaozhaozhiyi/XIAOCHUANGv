export type AgentExecutionStatus =
  | "created"
  | "queued"
  | "starting"
  | "running"
  | "checkpointed"
  | "stopping"
  | "completed"
  | "failed"
  | "canceled"
  | "orphaned";

export type AgentRunProfile = {
  taskId: number;
  userId: number;
  organizationId?: number | null;
  dramaId?: number | null;
  toolProfile: string;
  modelProfile: string;
  skillRefs: string[];
  instruction: string;
};

export type SkillManifestEntry = {
  ref: string;
  id: string;
  version: string;
  sha256: string;
};

export type HermesPoolInstance = {
  name: string;
  baseUrl: string;
};

export type HermesRuntimePool = {
  name: string;
  toolProfile: string;
  skillBundle: string;
  skillRefs: string[];
  skillManifest: Array<{
    ref: string;
    sha256: string;
  }>;
  allowedTools: string[];
  modelProfile: string;
  maxConcurrentRuns: number;
  maxConcurrentRunsPerUser: number;
  instances: HermesPoolInstance[];
};

export type PreparedAgentRunProfile = {
  profile: AgentRunProfile;
  pool: HermesRuntimePool;
  skillManifest: SkillManifestEntry[];
};

export type AgentRuntimeRunResult = {
  executionId: number;
  remoteRunId: string | null;
  status: AgentExecutionStatus;
  pool: string | null;
  instance: string | null;
  reused: boolean;
};

export type HermesRunStatus = {
  status: string;
  raw: Record<string, unknown>;
};
