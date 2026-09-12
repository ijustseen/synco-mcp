import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.SYNCO_URL ?? "http://127.0.0.1:3847";
const apiKey = process.env.SYNCO_API_KEY ?? "";
const projectId = process.env.SYNCO_DEFAULT_PROJECT_ID ?? "default";

function parse(result: unknown) {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("Empty tool result");
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function connect() {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const client = new Client({ name: "synco-demo", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers },
  });
  await client.connect(transport);
  return client;
}

async function main() {
  console.log(`Demo against ${baseUrl} (open ${baseUrl}/ to watch the dashboard)`);

  const client = await connect();
  const call = async (name: string, args: Record<string, unknown>) =>
    parse(await client.callTool({ name, arguments: args }));

  const agentA = call("register_agent", {
    projectId,
    agentId: "agent-backend",
    name: "Agent A",
    platform: "cursor",
    model: "grok",
  });
  const agentB = call("register_agent", {
    projectId,
    agentId: "agent-frontend",
    name: "Agent B",
    platform: "claude-code",
    model: "opus",
  });
  await Promise.all([agentA, agentB]);
  console.log("1. Both agents registered");

  const authTask = await call("create_task", {
    projectId,
    title: "Add authentication API",
    description: "Implement login, refresh-token rotation, and session middleware.",
    idempotencyKey: "demo-task-auth",
  });
  const uiTask = await call("create_task", {
    projectId,
    title: "Connect frontend to authentication API",
    description: "Wire the login form to the new auth endpoints.",
    idempotencyKey: "demo-task-ui",
  });
  const authTaskId = (authTask.task as { id: string }).id;
  const uiTaskId = (uiTask.task as { id: string }).id;
  console.log("2. Tasks created");

  const claimed = await call("claim_task", {
    projectId,
    taskId: authTaskId,
    agentId: "agent-backend",
  });
  console.log("3. Agent A claimed auth task", claimed.ok === true ? "ok" : claimed);

  const duplicate = await call("claim_task", {
    projectId,
    taskId: authTaskId,
    agentId: "agent-frontend",
  });
  console.log("4. Agent B failed to steal auth task", (duplicate as { code?: string }).code);

  await call("claim_task", {
    projectId,
    taskId: uiTaskId,
    agentId: "agent-frontend",
  });

  await call("declare_change_intent", {
    projectId,
    agentId: "agent-backend",
    taskId: authTaskId,
    summary: "Will change backend authentication session flow",
    resources: [
      { type: "file", path: "src/auth/session.ts" },
      { type: "file", path: "src/auth/middleware.ts" },
    ],
    idempotencyKey: "demo-intent-a",
  });
  console.log("5. Agent A declared auth intent");

  const overlap = await call("declare_change_intent", {
    projectId,
    agentId: "agent-frontend",
    taskId: uiTaskId,
    summary: "Exploring auth types for the login form",
    resources: [{ type: "directory", path: "src/auth" }],
    idempotencyKey: "demo-intent-b",
  });
  console.log(
    "6. Overlap warning",
    ((overlap.warnings as unknown[]) ?? []).length > 0 ? "yes" : "no",
  );

  const report = await call("report_change", {
    projectId,
    agentId: "agent-backend",
    taskId: authTaskId,
    summary:
      "Added refresh-token rotation to the authentication flow. Expired refresh tokens are now rejected.",
    files: [
      {
        path: "src/auth/session.ts",
        action: "modified",
        description: "SessionService.refresh() rejects expired refresh tokens",
      },
      {
        path: "src/auth/middleware.ts",
        action: "modified",
        description: "Attach rotated session cookies on successful refresh",
      },
    ],
    affectedAreas: ["auth", "api"],
    interfacesChanged: [
      {
        name: "SessionService.refresh",
        description: "Expired refresh tokens now throw instead of minting a session",
      },
    ],
    behaviorChanges: ["Expired refresh tokens no longer silently succeed"],
    breakingChange: false,
    tests: { status: "passed", summary: "Authentication tests passed" },
    nextSteps: ["Frontend should call POST /auth/refresh and handle 401 on expired tokens"],
    idempotencyKey: "demo-report-auth",
  });
  console.log("7. ChangeReport published", (report.confirmation as { source?: string })?.source ?? report.source);

  const recent = await call("get_recent_changes", { projectId, detail: "compact" });
  console.log("8. Agent B can read reports:", (recent.reports as unknown[]).length);

  await call("create_handoff", {
    projectId,
    fromAgentId: "agent-backend",
    toAgentId: "agent-frontend",
    taskId: uiTaskId,
    summary: "Auth API is ready for frontend integration",
    completedWork: ["Refresh-token rotation", "Session middleware cookie attach"],
    remainingWork: ["Login form", "Token storage in the SPA"],
    importantFiles: ["src/auth/session.ts", "src/auth/middleware.ts"],
    knownIssues: ["Claims overlap on src/auth — coordinate before more backend edits"],
    nextSteps: ["Read the latest ChangeReport", "Call POST /auth/refresh from the client"],
    idempotencyKey: "demo-handoff",
  });
  console.log("9. Handoff created");

  await call("update_task_status", {
    projectId,
    taskId: authTaskId,
    agentId: "agent-backend",
    status: "done",
  });

  const state = await call("get_project_state", { projectId });
  console.log("10. Compact state ready", {
    agents: (state.activeAgents as unknown[]).length,
    tasks: (state.activeTasks as unknown[]).length,
    warnings: (state.warnings as unknown[]).length,
  });

  await client.close();
  console.log(`Watch the live feed at ${baseUrl}/`);
}

main().catch((error) => {
  console.error("Demo failed. Is synco-mcp running?", error instanceof Error ? error.message : error);
  process.exit(1);
});
