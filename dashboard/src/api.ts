import type { DashboardState, SessionState } from "./types";

const apiKey = import.meta.env.VITE_SYNCO_API_KEY ?? "";

function headers(json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  if (response.status === 401) {
    throw new AuthError("Sign in required");
  }
  if (!response.ok) {
    throw new Error(await readError(response, `Request failed (${response.status})`));
  }
  return response.json() as Promise<T>;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function authStatus(): Promise<{ hasUsers: boolean }> {
  return request("/api/auth/status");
}

export async function loadSession(): Promise<SessionState> {
  return request("/api/auth/me");
}

export async function register(input: { username: string; password: string }): Promise<SessionState> {
  return request("/api/auth/register", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(input),
  });
}

export async function login(input: { username: string; password: string }): Promise<SessionState> {
  return request("/api/auth/login", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(input),
  });
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "POST" });
}

export async function setActiveProject(projectId: string): Promise<SessionState> {
  return request("/api/auth/active-project", {
    method: "PUT",
    headers: headers(true),
    body: JSON.stringify({ projectId }),
  });
}

export async function createProject(input: { name: string; id?: string }): Promise<SessionState> {
  const result = await request<{ project: { id: string } } & SessionState>("/api/projects", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(input),
  });
  return result;
}

export async function loadState(projectId: string): Promise<DashboardState> {
  return request(`/api/projects/${projectId}`, { headers: headers() });
}

export function eventsUrl(projectId: string): string {
  return `/api/projects/${projectId}/events`;
}

export async function addManualLog(
  projectId: string,
  input: { summary: string; author?: string },
): Promise<void> {
  await request(`/api/projects/${projectId}/logs`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(input),
  });
}
