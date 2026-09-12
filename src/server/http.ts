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
import { requireApiKey } from "./auth.js";
import { createMcpServer } from "./mcp.js";

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
  app.use(cors({ origin: true, exposedHeaders: ["Mcp-Session-Id"] }));
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

  app.get("/api/projects/:projectId", requireApiKey, (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      res.json(runtime.service.getDashboardState(projectId));
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.httpStatus).json(error.toJSON());
        return;
      }
      res.status(500).json({ code: ErrorCodes.VALIDATION_ERROR, message: "Failed to load project" });
    }
  });

  app.post("/api/projects/:projectId/logs", requireApiKey, (req, res) => {
    try {
      const projectId = String(req.params.projectId);
      const body = (req.body ?? {}) as { summary?: string; author?: string };
      const result = runtime.service.addManualLog({
        projectId,
        summary: body.summary ?? "",
        author: body.author,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.httpStatus).json(error.toJSON());
        return;
      }
      res.status(500).json({ code: ErrorCodes.VALIDATION_ERROR, message: "Failed to add log" });
    }
  });

  app.get("/api/projects/:projectId/events", requireApiKey, (req, res) => {
    try {
      const projectId = String(req.params.projectId);
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
      if (error instanceof AppError) {
        res.status(error.httpStatus).json(error.toJSON());
        return;
      }
      res.status(500).json({ code: "SSE_ERROR", message: "Failed to subscribe" });
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
