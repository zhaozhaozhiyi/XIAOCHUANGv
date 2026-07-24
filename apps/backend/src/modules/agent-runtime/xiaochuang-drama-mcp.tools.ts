export type XiaochuangDramaMcpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const BUSINESS_ARGUMENTS_SCHEMA = {
  type: "object",
  description:
    "Business tool arguments only. Do not include user_id, organization_id, drama_id, execution_id, task_id, auth tokens, headers, URLs, file paths, or model configuration.",
  additionalProperties: true,
  properties: {},
};

export const XIAOCHUANG_DRAMA_MCP_TOOL_DEFINITIONS: readonly XiaochuangDramaMcpToolDefinition[] =
  [
    {
      name: "get_task_context",
      description:
        "Read the scoped drama task context, project configuration, coverage, and version pointers.",
    },
    {
      name: "list_source_chunks",
      description:
        "List source chunks available to the current task without returning source text.",
    },
    {
      name: "get_source_chunk",
      description:
        "Read one scoped source chunk in an untrusted content envelope.",
    },
    {
      name: "submit_source_chunk_analysis",
      description:
        "Submit analysis for one source chunk with evidence and source trace.",
    },
    {
      name: "submit_source_analysis",
      description:
        "Submit the global source-understanding result after all required chunks are ready.",
    },
    {
      name: "submit_blueprint_batch",
      description:
        "Submit one Agent-chosen continuous batch of episode blueprints for the current planning task.",
    },
    {
      name: "submit_episode_script",
      description:
        "Submit one target episode script bound to the current blueprint hash.",
    },
    {
      name: "list_episode_scripts",
      description:
        "List the scoped episode-script index for the current story-map task.",
    },
    {
      name: "get_episode_script",
      description:
        "Read one scoped episode script in an untrusted content envelope.",
    },
    {
      name: "submit_story_graph_batch",
      description:
        "Submit a recoverable batch of story-graph entities, relations, and events.",
    },
    {
      name: "get_storyboard_task_context",
      description:
        "Read the frozen script, story-map, and baseline contract for the current storyboard task.",
    },
    {
      name: "list_episode_script_segments",
      description:
        "List scoped script segments available to the current storyboard task.",
    },
    {
      name: "get_episode_script_segment",
      description:
        "Read one scoped script segment in an untrusted content envelope.",
    },
    {
      name: "get_storyboard_assets",
      description:
        "Read only the character, scene, and prop assets available to the current storyboard task.",
    },
    {
      name: "submit_storyboard_batch",
      description:
        "Submit a recoverable batch of storyboard shots bound to the frozen task contract.",
    },
    {
      name: "report_progress",
      description:
        "Report concise user-displayable progress facts for the current execution.",
    },
    {
      name: "complete_execution",
      description:
        "Declare this execution complete after Backend-validated production artifacts are submitted.",
    },
    {
      name: "fail_execution",
      description:
        "Declare this execution failed with a concise sanitized reason.",
    },
  ].map((tool) => ({
    ...tool,
    inputSchema: BUSINESS_ARGUMENTS_SCHEMA,
  }));

export const XIAOCHUANG_DRAMA_MCP_TOOL_NAMES = new Set(
  XIAOCHUANG_DRAMA_MCP_TOOL_DEFINITIONS.map((tool) => tool.name),
);
