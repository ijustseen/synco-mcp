import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRuntime } from "../src/application/runtime.js";
import { createHttpApp } from "../src/server/http.js";
import type { Server } from "node:http";

describe("edit guard", () => {
  let runtime: ReturnType<typeof createRuntime>;

  beforeEach(() => {
    const file = join(mkdtempSync(join(tmpdir(), "synco-guard-")), "test.sqlite");
    runtime = createRuntime(file);
    runtime.service.seedDefaultProject();
    runtime.service.registerAgent({
      projectId: "default",
      agentId: "cursor",
      name: "Cursor",
      platform: "cursor",
    });
  });

  const guard = (path?: string) =>
    runtime.service.checkEditGuard({ projectId: "default", agentId: "cursor", path });

  it("refuses an agent that never declared intent", () => {
    const result = guard("src/auth/session.ts");
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("NO_INTENT");
    expect(result.message).toContain("declare_change_intent");
  });

  it("refuses an unknown agent and names the fix", () => {
    const result = runtime.service.checkEditGuard({
      projectId: "default",
      agentId: "ghost",
      path: "src/index.ts",
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("NOT_REGISTERED");
    expect(result.message).toContain("register_agent");
  });

  it("allows a declared path and refuses an undeclared neighbour", () => {
    runtime.service.declareChangeIntent({
      projectId: "default",
      agentId: "cursor",
      summary: "Touch the session module",
      resources: [{ type: "file", path: "src/auth/session.ts" }],
    });

    expect(guard("src/auth/session.ts").allowed).toBe(true);
    const denied = guard("src/billing/invoice.ts");
    expect(denied.allowed).toBe(false);
    expect(denied.code).toBe("PATH_NOT_DECLARED");
    expect(denied.message).toContain("src/auth/session.ts");
  });

  it("treats a declared directory as covering files inside it", () => {
    runtime.service.declareChangeIntent({
      projectId: "default",
      agentId: "cursor",
      summary: "Rework auth",
      resources: [{ type: "directory", path: "src/auth" }],
    });

    expect(guard("src/auth/session.ts").allowed).toBe(true);
    expect(guard("src/billing/invoice.ts").allowed).toBe(false);
  });

  it("reports another agent holding the same path", () => {
    runtime.service.registerAgent({
      projectId: "default",
      agentId: "opencode",
      name: "opencode",
      platform: "cli",
    });
    runtime.service.declareChangeIntent({
      projectId: "default",
      agentId: "opencode",
      summary: "Also editing",
      resources: [{ type: "file", path: "src/auth/session.ts" }],
    });
    runtime.service.declareChangeIntent({
      projectId: "default",
      agentId: "cursor",
      summary: "Editing too",
      resources: [{ type: "file", path: "src/auth/session.ts" }],
    });

    const result = guard("src/auth/session.ts");
    expect(result.allowed).toBe(true);
    expect(result.allowed && result.overlappingAgentIds).toEqual(["opencode"]);
  });

  it("closes the guard again once the task is done", () => {
    const { task } = runtime.service.createTask({ projectId: "default", title: "Auth work" });
    runtime.service.claimTask({ projectId: "default", taskId: task!.id, agentId: "cursor" });
    runtime.service.declareChangeIntent({
      projectId: "default",
      agentId: "cursor",
      taskId: task!.id,
      summary: "Touch the session module",
      resources: [{ type: "file", path: "src/auth/session.ts" }],
    });
    expect(guard("src/auth/session.ts").allowed).toBe(true);

    runtime.service.reportChange({
      projectId: "default",
      agentId: "cursor",
      taskId: task!.id,
      summary: "Rotated refresh tokens in the session module.",
      files: [{ path: "src/auth/session.ts", action: "modified", description: "Rotate refresh tokens" }],
      affectedAreas: ["auth"],
      interfacesChanged: [],
      behaviorChanges: ["Refresh tokens rotate"],
      breakingChange: false,
      tests: { status: "not_run" },
      nextSteps: [],
    });
    runtime.service.updateTaskStatus({
      projectId: "default",
      agentId: "cursor",
      taskId: task!.id,
      status: "done",
    });

    expect(guard("src/auth/session.ts").allowed).toBe(false);
  });

  it("tells the agent what to call next", () => {
    const registered = runtime.service.registerAgent({
      projectId: "default",
      agentId: "cursor",
      name: "Cursor",
      platform: "cursor",
    });
    expect(registered.protocol.nextRequiredCall).toContain("claim_task");

    const { task } = runtime.service.createTask({ projectId: "default", title: "Auth work" });
    runtime.service.claimTask({ projectId: "default", taskId: task!.id, agentId: "cursor" });
    const context = runtime.service.getAgentContext({ projectId: "default", agentId: "cursor" });
    expect(context.protocol.nextRequiredCall).toContain("declare_change_intent");

    const declared = runtime.service.declareChangeIntent({
      projectId: "default",
      agentId: "cursor",
      taskId: task!.id,
      summary: "Touch the session module",
      resources: [{ type: "file", path: "src/auth/session.ts" }],
    });
    expect(declared.protocol.nextRequiredCall).toContain("report_change");
    expect(
      runtime.service
        .getAgentContext({ projectId: "default", agentId: "cursor" })
        .protocol.openItems.join(" "),
    ).toContain("no report_change");
  });

  describe("over HTTP", () => {
    let server: Server;
    let base: string;

    beforeEach(async () => {
      server = createHttpApp(runtime).listen(0);
      await new Promise((done) => server.once("listening", done));
      const address = server.address();
      base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    });

    afterEach(async () => {
      await new Promise((done) => server.close(done));
    });

    it("answers the hook adapters", async () => {
      const denied = await fetch(
        `${base}/api/guard/edit?projectId=default&agentId=cursor&path=src/index.ts`,
      );
      expect(denied.status).toBe(200);
      expect(await denied.json()).toMatchObject({ allowed: false, code: "NO_INTENT" });

      runtime.service.declareChangeIntent({
        projectId: "default",
        agentId: "cursor",
        summary: "Touch the entry point",
        resources: [{ type: "file", path: "src/index.ts" }],
      });

      const allowed = await fetch(
        `${base}/api/guard/edit?projectId=default&agentId=cursor&path=src/index.ts`,
      );
      expect(await allowed.json()).toMatchObject({ allowed: true, code: "OK" });
    });
  });
});

describe("guard adapter core", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "synco-project-"));
  });

  it("stays out of repositories that never opted in", async () => {
    const { checkEdit } = await import("../integrations/synco-guard.mjs");
    const result = await checkEdit({
      payload: { tool_name: "Write", tool_input: { file_path: join(root, "src/a.ts") } },
      cwd: root,
      env: { SYNCO_AGENT_ID: "cursor" },
    });
    expect(result).toMatchObject({ allowed: true, reason: "not-a-synco-project" });
  });

  it("ignores tools that do not write files", async () => {
    const { checkEdit, isWriteTool } = await import("../integrations/synco-guard.mjs");
    expect(isWriteTool("Read")).toBe(false);
    expect(isWriteTool("Write")).toBe(true);
    expect(isWriteTool("str_replace")).toBe(true);
    expect(isWriteTool("edit")).toBe(true);

    const result = await checkEdit({ payload: { tool_name: "Read" }, cwd: root, env: {} });
    expect(result).toMatchObject({ allowed: true, reason: "not-a-write-tool" });
  });

  it("pulls the path out of every host payload shape and makes it repo-relative", async () => {
    const { extractPath, toRepoPath } = await import("../integrations/synco-guard.mjs");
    expect(extractPath({ tool_input: { file_path: "/repo/src/a.ts" } })).toBe("/repo/src/a.ts");
    expect(extractPath({ args: { filePath: "/repo/src/b.ts" } })).toBe("/repo/src/b.ts");
    expect(extractPath({ tool_input: { target_file: "src/c.ts" } })).toBe("src/c.ts");
    expect(extractPath({ tool_name: "Write" })).toBeUndefined();

    expect(toRepoPath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(toRepoPath("src/a.ts", "/repo")).toBe("src/a.ts");
    expect(toRepoPath("/elsewhere/a.ts", "/repo")).toBeUndefined();
  });

  it("finds the project from the edited file, not from cwd", async () => {
    // A user-level hook runs from ~/.cursor or ~/.claude, never from the repo.
    const { projectSearchStarts, resolveConfig } = await import("../integrations/synco-guard.mjs");
    writeFileSync(join(root, ".synco.json"), JSON.stringify({ projectId: "p1" }));

    expect(projectSearchStarts({}, "/elsewhere", join(root, "src/a.ts"))[0]).toBe(join(root, "src"));

    const config = resolveConfig({
      cwd: "/elsewhere",
      env: { SYNCO_AGENT_ID: "cursor" },
      payload: {},
      editedPath: join(root, "src/a.ts"),
    });
    expect(config).toMatchObject({ root, projectId: "p1", agentId: "cursor" });
  });

  it("fails open when the server cannot be reached", async () => {
    const { checkEdit } = await import("../integrations/synco-guard.mjs");
    writeFileSync(join(root, ".synco.json"), JSON.stringify({ url: "http://127.0.0.1:1" }));
    const result = await checkEdit({
      payload: { tool_name: "Write", tool_input: { file_path: join(root, "src/a.ts") } },
      cwd: root,
      env: { SYNCO_AGENT_ID: "cursor", SYNCO_GUARD_TIMEOUT_MS: "300" },
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("server-unreachable");
  });
});
