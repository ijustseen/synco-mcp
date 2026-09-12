import fs from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntime, type Runtime } from "../src/application/runtime.js";
import { AppError } from "../src/domain/errors.js";
import { createHttpApp } from "../src/server/http.js";

const runtimes: Runtime[] = [];
const servers: Server[] = [];

function runtime(): Runtime {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synco-auth-"));
  const created = createRuntime(path.join(dir, "test.sqlite"));
  runtimes.push(created);
  return created;
}

async function listen(app: ReturnType<typeof createHttpApp>) {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

function sessionCookie(response: Response): string {
  const cookies = response.headers.getSetCookie();
  const line = cookies.find((item) => item.startsWith("synco_session="));
  if (!line) {
    throw new Error("missing session cookie");
  }
  return line.split(";")[0]!;
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  while (runtimes.length > 0) {
    runtimes.pop()?.close();
  }
});

describe("dashboard auth", () => {
  it("gives the first user the default project", () => {
    const { auth } = runtime();
    const result = auth.register({ username: "andrew", password: "secret123" });
    expect(result.user.username).toBe("andrew");
    expect(result.projects.map((project) => project.id)).toEqual(["default"]);
    expect(result.activeProjectId).toBe("default");
  });

  it("rejects a duplicate username", () => {
    const { auth } = runtime();
    auth.register({ username: "andrew", password: "secret123" });
    expect(() => auth.register({ username: "andrew", password: "otherpass" })).toThrow(AppError);
  });

  it("does not put a later user on leftover default", () => {
    const created = runtime();
    created.auth.register({ username: "andrew", password: "secret123" });
    created.service.registerAgent({
      projectId: "default",
      agentId: "cursor-grok",
      name: "Cursor Grok",
      platform: "cursor",
    });
    const second = created.auth.register({ username: "ijustseen", password: "secret123" });
    expect(second.projects).toEqual([]);
    expect(second.activeProjectId).toBeUndefined();
    expect(() => created.auth.requireProjectAccess(second.session.token, "default")).toThrow(AppError);

    const project = created.service.createProject(second.user.id, { name: "Mobile app" });
    expect(project.id).toBe("mobile-app");
    const switched = created.auth.setActiveProject(second.session.token, { projectId: project.id });
    expect(switched.activeProjectId).toBe("mobile-app");
    expect(created.service.deskProjectId()).toBe("mobile-app");
    expect(created.auth.me(second.session.token).projects.map((item) => item.id)).toEqual(["mobile-app"]);
  });

  it("requires a session to load a project over HTTP", async () => {
    const created = runtime();
    const base = await listen(createHttpApp(created));
    const denied = await fetch(`${base}/api/projects/default`);
    expect(denied.status).toBe(401);

    const registered = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "andrew", password: "secret123" }),
    });
    expect(registered.status).toBe(201);
    const cookie = sessionCookie(registered);
    const allowed = await fetch(`${base}/api/projects/default`, { headers: { cookie } });
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as { project: { id: string } };
    expect(body.project.id).toBe("default");
  });

  it("creates a second project and makes it active", async () => {
    const created = runtime();
    const base = await listen(createHttpApp(created));
    const registered = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "andrew", password: "secret123" }),
    });
    const cookie = sessionCookie(registered);

    const createdProject = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "Website" }),
    });
    expect(createdProject.status).toBe(201);
    const payload = (await createdProject.json()) as {
      project: { id: string; name: string };
      activeProjectId: string;
      projects: Array<{ id: string }>;
    };
    expect(payload.project.id).toBe("website");
    expect(payload.activeProjectId).toBe("website");
    expect(payload.projects.map((project) => project.id).sort()).toEqual(["default", "website"]);
  });

  it("makes the dashboard picker the project MCP writes to", () => {
    const created = runtime();
    const first = created.auth.register({ username: "andrew", password: "secret123" });
    created.service.registerAgent({
      projectId: "default",
      agentId: "cursor-grok",
      name: "Cursor Grok",
      platform: "cursor",
    });
    const website = created.service.createProject(first.user.id, { name: "Website" });
    created.auth.setActiveProject(first.session.token, { projectId: website.id });
    expect(created.service.deskProjectId()).toBe("website");

    created.service.registerAgent({
      projectId: created.service.deskProjectId(),
      agentId: "cursor-grok",
      name: "Cursor Grok",
      platform: "cursor",
    });
    expect(created.repos.agents.getById("cursor-grok")?.projectId).toBe("website");
    const listed = created.service.listProjects(first.user.id);
    expect(listed.find((project) => project.id === "default")?.eventCount).toBeGreaterThan(0);
  });

  it("restores the last active project on login", () => {
    const created = runtime();
    const first = created.auth.register({ username: "andrew", password: "secret123" });
    const project = created.service.createProject(first.user.id, { name: "Website" });
    created.auth.setActiveProject(first.session.token, { projectId: project.id });
    const again = created.auth.login({ username: "andrew", password: "secret123" });
    expect(again.activeProjectId).toBe("website");
  });
});
