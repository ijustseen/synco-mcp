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
        "synco-mcp is a shared coordination layer for multiple AI coding agents. Git remains the source of truth for source code. ChangeReports are agent-declared, not verified diffs. Resource claims warn about overlap; they do not lock Git. Poll get_project_state or get_recent_changes — hosts may not push live events into the model. Typical flow: register_agent → get_project_state → create_task/claim_task → declare_change_intent → report_change → create_handoff.",
    },
  );

  registerCoordinationTools(server, service);
  return server;
}
