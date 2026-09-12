import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CoordinationService } from "../application/services/coordination-service.js";
import { registerCoordinationTools } from "../mcp/tools/register-tools.js";

export function createMcpServer(service: CoordinationService): McpServer {
  const server = new McpServer(
    {
      name: "synco-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "synco-mcp coordinates several AI coding agents on one project. Using it is mandatory, not optional: " +
        "call register_agent once at session start, then get_agent_context at the start of every turn. " +
        "Before editing any file call declare_change_intent with every path you will touch; after editing, " +
        "call report_change in the same turn, before your final reply. Close work with update_task_status(done), " +
        "or blocked plus create_handoff. Only a finished task releases claims — anything else needs release_claims. " +
        "Never invent a ChangeReport for a turn that changed no files, and never claim tests you did not run. " +
        "Git remains the source of truth; ChangeReports are agent-declared, not verified diffs; claims warn about " +
        "overlap but do not lock files. Nothing is pushed to you — poll get_project_state or get_recent_changes. " +
        "The project is the one selected in the dashboard. Omit projectId on every tool — do not pass leftover default. " +
        "Every response carries a protocol.nextRequiredCall field; follow it.",
    },
  );

  registerCoordinationTools(server, service);
  return server;
}
