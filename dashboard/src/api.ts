import type { DashboardState } from "./types";

const projectId = import.meta.env.VITE_PROJECT_ID ?? "default";
const apiKey = import.meta.env.VITE_SYNCO_API_KEY ?? "";

function headers(): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function withKey(url: string): string {
  if (!apiKey) return url;
  const next = new URL(url, window.location.origin);
  next.searchParams.set("apiKey", apiKey);
  return next.toString();
}

export async function loadState(): Promise<DashboardState> {
  const response = await fetch(`/api/projects/${projectId}`, { headers: headers() });
  if (!response.ok) {
    throw new Error(`Failed to load project (${response.status})`);
  }
  return response.json() as Promise<DashboardState>;
}

export function eventsUrl(): string {
  return withKey(`/api/projects/${projectId}/events`);
}

export async function addManualLog(input: { summary: string; author?: string }): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers() },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Failed to add log (${response.status})`);
  }
}

export { projectId };
