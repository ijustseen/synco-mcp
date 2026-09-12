import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { AppError } from "./lib/errors.js";
import { MCP_TOOLS, SERVER_INSTRUCTIONS, toolResult } from "./lib/mcpProtocol.js";

const http = httpRouter();
auth.addHttpRoutes(http);

type Access = { kind: "admin" } | { kind: "user"; userId: Id<"users"> };

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin === "null" ? "*" : origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    Vary: "Origin",
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
    },
  });
}

function getApiKey(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("apiKey");
  return query && query.length > 0 ? query : undefined;
}

async function resolveAccess(ctx: ActionCtx, request: Request): Promise<Access | null> {
  const token = getApiKey(request);
  if (!token) {
    return null;
  }
  return await ctx.runQuery(internal.access.resolveBearer, { token });
}

function withActor(args: Record<string, unknown>, access: Access): Record<string, unknown> {
  const { actorUserId: _ignored, ...rest } = args;
  if (access.kind === "user") {
    return { ...rest, actorUserId: access.userId };
  }
  return rest;
}

async function dispatchTool(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  access: Access,
): Promise<unknown> {
  const scoped = withActor(args, access);
  switch (name) {
    case "register_agent":
      return await ctx.runMutation(internal.coordination.registerAgent, scoped as never);
    case "get_project_state":
      return await ctx.runQuery(internal.coordination.getProjectState, scoped as never);
    case "create_task":
      return await ctx.runMutation(internal.coordination.createTask, scoped as never);
    case "claim_task":
      return await ctx.runMutation(internal.coordination.claimTask, scoped as never);
    case "update_task_status":
      return await ctx.runMutation(internal.coordination.updateTaskStatus, scoped as never);
    case "declare_change_intent":
      return await ctx.runMutation(internal.coordination.declareChangeIntent, scoped as never);
    case "report_change":
      return await ctx.runMutation(internal.coordination.reportChange, scoped as never);
    case "get_recent_changes":
      return await ctx.runQuery(internal.coordination.getRecentChanges, scoped as never);
    case "get_resource_claims":
      return await ctx.runQuery(internal.coordination.getResourceClaims, scoped as never);
    case "release_claims":
      return await ctx.runMutation(internal.coordination.releaseClaims, scoped as never);
    case "create_handoff":
      return await ctx.runMutation(internal.coordination.createHandoff, scoped as never);
    case "get_agent_context":
      return await ctx.runMutation(internal.coordination.getAgentContext, scoped as never);
    default:
      throw new AppError("VALIDATION_ERROR", `Unknown tool: ${name}`);
  }
}

async function handleJsonRpc(
  ctx: ActionCtx,
  message: Record<string, unknown>,
  access: Access,
): Promise<unknown | undefined> {
  const id = message.id ?? null;
  const method = typeof message.method === "string" ? message.method : "";
  const params = (message.params ?? {}) as Record<string, unknown>;

  if (method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26";
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: requested,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "synco-mcp", version: "0.1.0" },
        instructions: SERVER_INSTRUCTIONS,
      },
    };
  }

  if (method === "notifications/initialized" || method.startsWith("notifications/")) {
    return undefined;
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
  }

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      const data = await dispatchTool(ctx, name, args, access);
      return { jsonrpc: "2.0", id, result: toolResult(data) };
    } catch (error) {
      const payload =
        error instanceof AppError
          ? error.toJSON()
          : { code: "VALIDATION_ERROR", message: error instanceof Error ? error.message : "Unknown error" };
      return { jsonrpc: "2.0", id, result: toolResult(payload, true) };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

const handleMcp = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  const access = await resolveAccess(ctx, request);
  if (!access) {
    return json(
      request,
      {
        code: "UNAUTHORIZED",
        message:
          "Send Authorization: Bearer <key>. Create a personal key on the website, or use the deployment SYNCO_API_KEY.",
      },
      401,
    );
  }
  if (request.method !== "POST") {
    return json(
      request,
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed on stateless endpoint. Use POST." },
        id: null,
      },
      405,
    );
  }

  const body = await request.json();
  if (Array.isArray(body)) {
    const results = [];
    for (const item of body) {
      const result = await handleJsonRpc(ctx, item as Record<string, unknown>, access);
      if (result !== undefined) {
        results.push(result);
      }
    }
    return json(request, results);
  }

  const result = await handleJsonRpc(ctx, body as Record<string, unknown>, access);
  if (result === undefined) {
    return new Response(null, { status: 202, headers: corsHeaders(request) });
  }
  return json(request, result);
});

const handleGuard = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  const access = await resolveAccess(ctx, request);
  if (!access) {
    return json(
      request,
      {
        code: "UNAUTHORIZED",
        message:
          "Send Authorization: Bearer <key>. Create a personal key on the website, or use the deployment SYNCO_API_KEY.",
      },
      401,
    );
  }
  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  const result = await ctx.runQuery(
    internal.coordination.checkEditGuard,
    withActor(
      {
        agentId: url.searchParams.get("agentId") ?? "",
        ...(path ? { path } : {}),
      },
      access,
    ) as never,
  );
  return json(request, result);
});

const handleHealth = httpAction(async (_ctx, request) => {
  return json(request, { ok: true, name: "synco-mcp", version: "0.1.0", backend: "convex" });
});

http.route({ path: "/mcp", method: "POST", handler: handleMcp });
http.route({ path: "/mcp", method: "GET", handler: handleMcp });
http.route({ path: "/mcp", method: "DELETE", handler: handleMcp });
http.route({ path: "/mcp", method: "OPTIONS", handler: handleMcp });
http.route({ path: "/api/guard/edit", method: "GET", handler: handleGuard });
http.route({ path: "/api/guard/edit", method: "OPTIONS", handler: handleGuard });
http.route({ path: "/health", method: "GET", handler: handleHealth });

export default http;
