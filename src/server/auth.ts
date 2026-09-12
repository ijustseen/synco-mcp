import type { NextFunction, Request, Response } from "express";
import { config, isLoopbackHost } from "../shared/config.js";

export function getRequestApiKey(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const query = req.query.apiKey;
  return typeof query === "string" && query.length > 0 ? query : undefined;
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!config.apiKey) {
    next();
    return;
  }
  if (getRequestApiKey(req) === config.apiKey) {
    next();
    return;
  }
  res.status(401).json({ code: "UNAUTHORIZED", message: "Missing or invalid API key" });
}

export function assertBindSafe(): void {
  if (!config.apiKey && !isLoopbackHost(config.host)) {
    throw new Error(
      `Refusing to bind ${config.host} without SYNCO_API_KEY. Set a key or bind HOST=127.0.0.1.`,
    );
  }
  if (!config.apiKey) {
    console.warn(
      "[synco-mcp] SYNCO_API_KEY is empty. HTTP is open on loopback only. Do not expose this process to the network.",
    );
  }
}
