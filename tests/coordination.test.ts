import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntime, type Runtime } from "../src/application/runtime.js";

const runtimes: Runtime[] = [];

function runtime(): Runtime {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synco-"));
  const created = createRuntime(path.join(dir, "test.sqlite"));
  runtimes.push(created);
  return created;
}

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()?.close();
  }
});

describe("coordination service", () => {
  it("seeds the default project", () => {
    const { service } = runtime();
    const state = service.getProjectState("default");
    expect(state.project.id).toBe("default");
    expect(state.project.name).toBe("synco-mcp");
  });

  it("registers two agents into the same project snapshot", () => {
    const { service } = runtime();
    service.registerAgent({
      projectId: "default",
      agentId: "agent-a",
      name: "Backend Agent",
      platform: "cursor",
      model: "grok",
    });
    const result = service.registerAgent({
      projectId: "default",
      agentId: "agent-b",
      name: "Frontend Agent",
      platform: "claude-code",
    });
    expect(result.activeAgents.map((agent) => agent.id).sort()).toEqual(["agent-a", "agent-b"]);
  });

  it("does not let two agents claim the same task", () => {
    const { service } = runtime();
    service.registerAgent({ projectId: "default", agentId: "a", name: "A", platform: "cursor" });
    service.registerAgent({ projectId: "default", agentId: "b", name: "B", platform: "codex" });
    const { task } = service.createTask({ projectId: "default", title: "Add auth API" });
    expect(task).toBeDefined();

    const first = service.claimTask({ projectId: "default", taskId: task!.id, agentId: "a" });
    const second = service.claimTask({ projectId: "default", taskId: task!.id, agentId: "b" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("TASK_ALREADY_CLAIMED");
      expect(second.task.assignedAgentId).toBe("a");
    }
  });

  it("rejects concurrent claims at the SQL layer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synco-claim-"));
    const dbPath = path.join(dir, "test.sqlite");
    const one = createRuntime(dbPath);
    const two = createRuntime(dbPath);
    runtimes.push(one, two);

    one.service.registerAgent({ projectId: "default", agentId: "a", name: "A", platform: "cursor" });
    one.service.registerAgent({ projectId: "default", agentId: "b", name: "B", platform: "cursor" });
    const { task } = one.service.createTask({ projectId: "default", title: "Shared" });

    const claimed = [one, two].map((item, index) =>
      item.service.claimTask({
        projectId: "default",
        taskId: task!.id,
        agentId: index === 0 ? "a" : "b",
      }),
    );

    const wins = claimed.filter((result) => result.ok);
    const losses = claimed.filter((result) => !result.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
  });

  it("replays create_task with the same idempotency key", () => {
    const { service } = runtime();
    const first = service.createTask({
      projectId: "default",
      title: "Auth API",
      idempotencyKey: "task-1",
    });
    const second = service.createTask({
      projectId: "default",
      title: "Auth API again",
      idempotencyKey: "task-1",
    });
    expect(second.replayed).toBe(true);
    expect(second.task?.id).toBe(first.task?.id);
    const state = service.getDashboardState("default");
    expect(state.tasks.filter((task) => task.title.startsWith("Auth"))).toHaveLength(1);
  });

  it("warns when two agents declare overlapping resources", () => {
    const { service } = runtime();
    service.registerAgent({ projectId: "default", agentId: "a", name: "A", platform: "cursor" });
    service.registerAgent({ projectId: "default", agentId: "b", name: "B", platform: "claude" });

    service.declareChangeIntent({
      projectId: "default",
      agentId: "a",
      summary: "Touch auth backend",
      resources: [{ type: "file", path: "src/auth/session.ts" }],
    });
    const result = service.declareChangeIntent({
      projectId: "default",
      agentId: "b",
      summary: "Also touch auth",
      resources: [{ type: "directory", path: "src/auth" }],
    });

    expect(result.overlappingClaims?.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.note).toContain("not a Git lock");
  });

  it("rejects unstructured change reports", () => {
    const { service } = runtime();
    service.registerAgent({ projectId: "default", agentId: "a", name: "A", platform: "cursor" });
    expect(() =>
      service.reportChange({
        projectId: "default",
        agentId: "a",
        summary: "updated files",
        files: [],
        affectedAreas: [],
        interfacesChanged: [],
        behaviorChanges: [],
        breakingChange: false,
        tests: { status: "not_run" },
        nextSteps: [],
      }),
    ).toThrow();
  });

  it("stores a structured declared change report", () => {
    const { service } = runtime();
    service.registerAgent({ projectId: "default", agentId: "a", name: "A", platform: "cursor" });
    const result = service.reportChange({
      projectId: "default",
      agentId: "a",
      summary: "Added refresh-token rotation to the authentication flow.",
      files: [
        {
          path: "src/auth/session.ts",
          action: "modified",
          description: "Reject expired refresh tokens in SessionService.refresh()",
        },
      ],
      affectedAreas: ["auth", "api"],
      interfacesChanged: [
        { name: "SessionService.refresh", description: "Expired refresh tokens are now rejected" },
      ],
      behaviorChanges: ["Expired refresh tokens no longer mint a new session"],
      breakingChange: false,
      tests: { status: "passed", summary: "Authentication tests passed" },
      nextSteps: ["Wire the frontend login form to the new refresh flow"],
    });

    expect(result.source).toBe("agent_declared");
    expect(result.confirmation).toMatchObject({ breakingChange: false, tests: "passed" });
    const recent = service.getRecentChanges({ projectId: "default" });
    expect(recent.reports).toHaveLength(1);
  });

  it("creates a handoff and returns agent context", () => {
    const { service } = runtime();
    service.registerAgent({ projectId: "default", agentId: "a", name: "A", platform: "cursor" });
    service.registerAgent({ projectId: "default", agentId: "b", name: "B", platform: "claude" });
    const { task } = service.createTask({ projectId: "default", title: "Frontend integration" });
    service.claimTask({ projectId: "default", taskId: task!.id, agentId: "b" });
    service.createHandoff({
      projectId: "default",
      fromAgentId: "a",
      toAgentId: "b",
      taskId: task!.id,
      summary: "Auth API is ready for frontend wiring",
      completedWork: ["Refresh rotation"],
      remainingWork: ["Login form"],
      importantFiles: ["src/auth/session.ts"],
      knownIssues: [],
      nextSteps: ["Call /auth/refresh from the SPA"],
    });

    const context = service.getAgentContext({ projectId: "default", agentId: "b" });
    expect(context.currentTask?.id).toBe(task!.id);
    expect(context.handoffs[0]?.summary).toContain("Auth API");
  });

  it("adds a dashboard manual log to the event feed", () => {
    const { service } = runtime();
    const result = service.addManualLog({
      projectId: "default",
      summary: "Paused frontend until auth lands",
      author: "Andrew",
    });
    expect(result.event.type).toBe("manual_log");
    expect(result.event.summary).toContain("Andrew");
    expect(result.event.summary).toContain("Paused frontend");
    const desk = service.getDashboardState("default");
    expect(desk.events[0]?.type).toBe("manual_log");
  });
});
