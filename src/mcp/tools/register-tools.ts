import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppError, ErrorCodes } from "../../domain/errors.js";
import type { CoordinationService } from "../../application/services/coordination-service.js";
import {
  claimTaskInput,
  createHandoffInput,
  createTaskInput,
  declareIntentInput,
  getAgentContextInput,
  getRecentChangesInput,
  getResourceClaimsInput,
  projectIdInput,
  registerAgentInput,
  reportChangeInput,
  updateTaskStatusInput,
} from "../../shared/validation/schemas.js";

function ok(data: unknown) {
  const text = JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: data as Record<string, unknown>,
  };
}

function fail(error: unknown) {
  if (error instanceof AppError) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: JSON.stringify(error.toJSON()) }],
    };
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ code: ErrorCodes.VALIDATION_ERROR, message }),
      },
    ],
  };
}

export function registerCoordinationTools(server: McpServer, service: CoordinationService): void {
  server.registerTool(
    "register_agent",
    {
      description:
        "Register this agent in a synco-mcp project and receive a compact snapshot of current coordination state.",
      inputSchema: registerAgentInput,
    },
    async (input) => {
      try {
        return ok(service.registerAgent(input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_project_state",
    {
      description:
        "Return a compact project snapshot: active agents, tasks, claims, recent declared change reports, events, and overlap warnings. Poll this — hosts may not push live updates into the model.",
      inputSchema: projectIdInput,
    },
    async (input) => {
      try {
        return ok(service.getProjectState(input.projectId));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "create_task",
    {
      description: "Create a coordination task in the project. Does not assign it.",
      inputSchema: createTaskInput,
    },
    async (input) => {
      try {
        return ok(service.createTask(input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "claim_task",
    {
      description:
        "Atomically reserve a todo task. Returns a structured refusal if another agent already claimed it.",
      inputSchema: claimTaskInput,
    },
    async (input) => {
      try {
        return ok(service.claimTask(input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_task_status",
    {
      description:
        "Update task status (todo | in_progress | blocked | done). Completing a task releases that agent's resource claims for it.",
      inputSchema: updateTaskStatusInput,
    },
    async (input) => {
      try {
        return ok(service.updateTaskStatus(input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "declare_change_intent",
    {
      description:
        "Declare intent to change files or areas. Creates coordination claims and overlap warnings. This is not a Git lock.",
      inputSchema: declareIntentInput,
    },
    async (input) => {
      try {
        return ok(service.declareChangeIntent(input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "report_change",
    {
      description:
        "Publish a structured agent-declared ChangeReport. Must include files, areas, interfaces, tests, and next steps. Not a verified Git diff.",
      inputSchema: reportChangeInput,
    },
    async (input) => {
      try {
        return ok(service.reportChange(input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_recent_changes",
    {
      description:
        "List recent agent-declared change reports. Default view is compact. Use detail=full for the full structured report.",
      inputSchema: getRecentChangesInput,
    },
    async (input) => {
      try {
        return ok(service.getRecentChanges(input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_resource_claims",
    {
      description: "List active resource claims. Optional path filters to overlapping claims.",
      inputSchema: getResourceClaimsInput,
    },
    async (input) => {
      try {
        return ok(service.getResourceClaims(input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "create_handoff",
    {
      description: "Pass structured technical context to another agent (or the next agent on the project).",
      inputSchema: createHandoffInput,
    },
    async (input) => {
      try {
        return ok(service.createHandoff(input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_agent_context",
    {
      description:
        "Return context relevant to one agent: current task, claims, recent reports, handoffs, and warnings. Not the full event log.",
      inputSchema: getAgentContextInput,
    },
    async (input) => {
      try {
        return ok(service.getAgentContext(input));
      } catch (error) {
        return fail(error);
      }
    },
  );
}
