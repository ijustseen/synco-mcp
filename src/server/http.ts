import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { AppError, ErrorCodes } from "../domain/errors.js";
import type { Runtime } from "../application/runtime.js";
import { attachProjectSse } from "../infrastructure/realtime/sse.js";
import { config } from "../shared/config.js";
import {
  clearSessionCookie,
  requireApiKey,
  sessionTokenFrom,
  setSessionCookie,
} from "./auth.js";
import { createMcpServer } from "./mcp.js";

function sendError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof AppError) {
    res.status(error.httpStatus).json(error.toJSON());
    return;
  }
  res.status(500).json({ code: ErrorCodes.VALIDATION_ERROR, message: fallback });
}

function authBody(result: { user: unknown; projects: unknown; activeProjectId?: string }) {
  return {
    user: result.user,
    projects: result.projects,
    activeProjectId: result.activeProjectId ?? null,
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(here, "../../dashboard/dist");

async function handleMcp(runtime: Runtime, req: Request, res: Response): Promise<void> {
  const server = createMcpServer(runtime.service);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    console.error("[synco-mcp] MCP request failed");
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
    void transport.close();
    void server.close();
    void error;
  }
}

export function createHttpApp(runtime: Runtime) {
  const app = express();
  app.use(cors({ origin: true, credentials: true, exposedHeaders: ["Mcp-Session-Id"] }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, name: "synco-mcp", version: "0.1.0" });
  });

  app.post("/mcp", requireApiKey, (req, res) => {
    void handleMcp(runtime, req, res);
  });

  app.get("/mcp", requireApiKey, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed on stateless endpoint. Use POST." },
      id: null,
    });
  });

  app.delete("/mcp", requireApiKey, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed on stateless endpoint." },
      id: null,
    });
  });

  // Edit guard for host hooks. Uses the agent API key, not a dashboard session:
  // the caller is a hook running next to an agent, not a browser.
  app.get("/api/guard/edit", requireApiKey, (req, res) => {
    try {
      res.json(
        runtime.service.checkEditGuard({
          projectId: runtime.service.deskProjectId(),
          agentId: typeof req.query.agentId === "string" ? req.query.agentId : "",
          path: typeof req.query.path === "string" ? req.query.path : undefined,
        }),
      );
    } catch (error) {
      sendError(res, error, "Guard check failed");
    }
  });

  app.get("/api/auth/status", (_req, res) => {
    res.json({ hasUsers: runtime.auth.hasUsers() });
  });

  app.post("/api/auth/register", (req, res) => {
    try {
      const result = runtime.auth.register(req.body);
      setSessionCookie(res, result.session.token);
      res.status(201).json(authBody(result));
    } catch (error) {
      sendError(res, error, "Failed to register");
    }
  });

  app.post("/api/auth/login", (req, res) => {
    try {
      const result = runtime.auth.login(req.body);
      setSessionCookie(res, result.session.token);
      res.json(authBody(result));
    } catch (error) {
      sendError(res, error, "Failed to sign in");
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    runtime.auth.logout(sessionTokenFrom(req));
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    try {
      res.json(authBody(runtime.auth.me(sessionTokenFrom(req))));
    } catch (error) {
      sendError(res, error, "Failed to load session");
    }
  });

  app.put("/api/auth/active-project", (req, res) => {
    try {
      res.json(authBody(runtime.auth.setActiveProject(sessionTokenFrom(req), req.body)));
    } catch (error) {
      sendError(res, error, "Failed to set active project");
    }
  });

  app.get("/api/projects", (req, res) => {
    try {
      const session = runtime.auth.requireSession(sessionTokenFrom(req));
      res.json({ projects: runtime.service.listProjects(session.userId) });
    } catch (error) {
      sendError(res, error, "Failed to list projects");
    }
  });

  app.post("/api/projects", (req, res) => {
    try {
      const session = runtime.auth.requireSession(sessionTokenFrom(req));
      const project = runtime.service.createProject(session.userId, req.body);
      const result = runtime.auth.setActiveProject(session.token, { projectId: project.id });
      setSessionCookie(res, result.session.token);
      res.status(201).json({ project, ...authBody(result) });
    } catch (error) {
      sendError(res, error, "Failed to create project");
    }
  });

  app.get("/api/projects/:projectId", (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      runtime.auth.requireProjectAccess(sessionTokenFrom(req), projectId);
      res.json(runtime.service.getDashboardState(projectId));
    } catch (error) {
      sendError(res, error, "Failed to load project");
    }
  });

  app.post("/api/projects/:projectId/logs", (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      runtime.auth.requireProjectAccess(sessionTokenFrom(req), projectId);
      const body = (req.body ?? {}) as { summary?: string; author?: string };
      const result = runtime.service.addManualLog({
        projectId,
        summary: body.summary ?? "",
        author: body.author,
      });
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error, "Failed to add log");
    }
  });

  app.get("/api/projects/:projectId/events", (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      runtime.auth.requireProjectAccess(sessionTokenFrom(req), projectId);
      const lastEventId =
        (typeof req.header("last-event-id") === "string" && req.header("last-event-id")) ||
        (typeof req.query.after === "string" ? req.query.after : undefined);
      const replay = runtime.service.listEventsAfter(projectId, lastEventId, 40);
      attachProjectSse({
        res,
        projectId,
        lastEventId: lastEventId || undefined,
        bus: runtime.bus,
        replay,
      });
    } catch (error) {
      sendError(res, error, "Failed to subscribe");
    }
  });

  if (fs.existsSync(dashboardDir)) {
    app.use(express.static(dashboardDir));
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/mcp") || req.path === "/health") {
        next();
        return;
      }
      res.sendFile(path.join(dashboardDir, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res.type("html").send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>synco-mcp</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0f1419;color:#e7ecf1;padding:48px}a{color:#7dd3fc}</style>
</head>
<body>
  <h1>synco-mcp</h1>
  <p>Coordination server is running. Dashboard build is missing.</p>
  <p>Health: <a href="/health">/health</a> · MCP: POST /mcp</p>
  <p>Build the UI with <code>npm run dashboard:build</code> and restart.</p>
</body>
</html>`);
    });
  }

  return app;
}

export function dashboardUrl(): string {
  const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
  return `http://${host}:${config.port}/`;
}
