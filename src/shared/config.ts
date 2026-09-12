import path from "node:path";

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export const config = {
  host: env("HOST", "127.0.0.1"),
  port: Number(env("PORT", "3847")),
  apiKey: env("SYNCO_API_KEY", ""),
  databasePath: path.resolve(env("SYNCO_DATABASE_PATH", "./data/synco.sqlite")),
  defaultProjectId: env("SYNCO_DEFAULT_PROJECT_ID", "default"),
  defaultProjectName: env("SYNCO_DEFAULT_PROJECT_NAME", "synco-mcp"),
  agentOfflineMs: Number(env("SYNCO_AGENT_OFFLINE_MS", String(5 * 60 * 1000))),
};

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
