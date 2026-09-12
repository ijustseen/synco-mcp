export const SERVER_INSTRUCTIONS =
  "synco-mcp coordinates several AI coding agents on one project. Using it is mandatory, not optional: " +
  "call register_agent once at session start, then get_agent_context at the start of every turn. " +
  "Before editing any file call declare_change_intent with every path you will touch; after editing, " +
  "call report_change in the same turn, before your final reply. Close work with update_task_status(done), " +
  "or blocked plus create_handoff. Only a finished task releases claims — anything else needs release_claims. " +
  "Never invent a ChangeReport for a turn that changed no files, and never claim tests you did not run. " +
  "Git remains the source of truth; ChangeReports are agent-declared, not verified diffs; claims warn about " +
  "overlap but do not lock files. Nothing is pushed to you — poll get_project_state or get_recent_changes. " +
  "The project is the one selected in the dashboard. Omit projectId on every tool — do not pass leftover default. " +
  "Every response carries a protocol.nextRequiredCall field; follow it.";

const optionalProjectId = {
  projectId: {
    type: "string",
    description: "Omit this. The desk picker fills the live project.",
  },
};

export const MCP_TOOLS = [
  {
    name: "register_agent",
    description:
      "Register this agent on the project selected in the dashboard. Omit projectId — the desk picker fills it. Do not pass leftover default.",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        agentId: { type: "string" },
        name: { type: "string" },
        platform: { type: "string" },
        model: { type: "string" },
      },
      required: ["name", "platform"],
    },
  },
  {
    name: "get_project_state",
    description:
      "Return a compact snapshot of the project selected in the dashboard. Omit projectId — the desk picker is the source of truth.",
    inputSchema: { type: "object", properties: optionalProjectId },
  },
  {
    name: "create_task",
    description: "Create a coordination task on the dashboard desk. Omit projectId. Does not assign it.",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        title: { type: "string" },
        description: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "claim_task",
    description: "Atomically reserve a todo task. Returns a structured refusal if another agent already claimed it.",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        taskId: { type: "string" },
        agentId: { type: "string" },
      },
      required: ["taskId", "agentId"],
    },
  },
  {
    name: "update_task_status",
    description:
      "Update task status (todo | in_progress | blocked | done). Completing a task releases that agent's resource claims for it.",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        taskId: { type: "string" },
        agentId: { type: "string" },
        status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"] },
      },
      required: ["taskId", "agentId", "status"],
    },
  },
  {
    name: "declare_change_intent",
    description:
      "Declare intent to change files or areas. Creates coordination claims and overlap warnings. This is not a Git lock.",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        agentId: { type: "string" },
        taskId: { type: "string" },
        summary: { type: "string" },
        resources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["file", "directory", "glob"] },
              path: { type: "string" },
            },
            required: ["type", "path"],
          },
        },
        idempotencyKey: { type: "string" },
      },
      required: ["agentId", "summary", "resources"],
    },
  },
  {
    name: "report_change",
    description:
      "Publish a structured agent-declared ChangeReport. Must include files, areas, interfaces, tests, and next steps. Not a verified Git diff.",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        agentId: { type: "string" },
        taskId: { type: "string" },
        summary: { type: "string" },
        files: { type: "array" },
        affectedAreas: { type: "array", items: { type: "string" } },
        interfacesChanged: { type: "array" },
        behaviorChanges: { type: "array", items: { type: "string" } },
        breakingChange: { type: "boolean" },
        tests: { type: "object" },
        nextSteps: { type: "array", items: { type: "string" } },
        commitHash: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: [
        "agentId",
        "summary",
        "files",
        "affectedAreas",
        "interfacesChanged",
        "behaviorChanges",
        "breakingChange",
        "tests",
        "nextSteps",
      ],
    },
  },
  {
    name: "get_recent_changes",
    description:
      "List recent agent-declared change reports. Default view is compact. Use detail=full for the full structured report.",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        limit: { type: "number" },
        since: { type: "string" },
        area: { type: "string" },
        detail: { type: "string", enum: ["compact", "full"] },
      },
    },
  },
  {
    name: "get_resource_claims",
    description: "List active resource claims. Optional path filters to overlapping claims.",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        path: { type: "string" },
      },
    },
  },
  {
    name: "release_claims",
    description:
      "Release your own active resource claims. Omit claimIds and paths to release all of them. Use this when you declared intent without a task, or finished editing before the task is done.",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        agentId: { type: "string" },
        claimIds: { type: "array", items: { type: "string" } },
        paths: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["agentId"],
    },
  },
  {
    name: "create_handoff",
    description: "Pass structured technical context to another agent (or the next agent on the project).",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        fromAgentId: { type: "string" },
        toAgentId: { type: "string" },
        taskId: { type: "string" },
        summary: { type: "string" },
        completedWork: { type: "array", items: { type: "string" } },
        remainingWork: { type: "array", items: { type: "string" } },
        importantFiles: { type: "array", items: { type: "string" } },
        knownIssues: { type: "array", items: { type: "string" } },
        nextSteps: { type: "array", items: { type: "string" } },
        idempotencyKey: { type: "string" },
      },
      required: ["fromAgentId", "summary", "completedWork", "remainingWork", "importantFiles", "knownIssues", "nextSteps"],
    },
  },
  {
    name: "get_agent_context",
    description:
      "Return context for this agent on the dashboard desk: current task, claims, recent reports, handoffs, and warnings. Omit projectId.",
    inputSchema: {
      type: "object",
      properties: {
        ...optionalProjectId,
        agentId: { type: "string" },
      },
      required: ["agentId"],
    },
  },
] as const;

export function toolResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
    ...(isError ? { isError: true as const } : {}),
  };
}
