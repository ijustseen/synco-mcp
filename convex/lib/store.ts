import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { AppError, ErrorCodes } from "./errors.js";
import { newId, nowIso, slugifyProjectId } from "./ids.js";
import { findOverlaps, type OverlapClaim } from "./overlap.js";
import { compactEvent, compactReport, type EventLike, type ReportLike } from "./summaries.js";

const AGENT_OFFLINE_MS = 5 * 60 * 1000;

export const LIMITS = {
  agents: 20,
  tasks: 20,
  claims: 20,
  events: 15,
  reports: 5,
  handoffs: 10,
};

type Ctx = QueryCtx | MutationCtx;

function newestFirst<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function getProject(ctx: Ctx, id: string) {
  return await ctx.db
    .query("projects")
    .withIndex("by_public_id", (q) => q.eq("id", id))
    .unique();
}

export async function getAgent(ctx: Ctx, id: string) {
  return await ctx.db
    .query("agents")
    .withIndex("by_public_id", (q) => q.eq("id", id))
    .unique();
}

export async function getTask(ctx: Ctx, id: string) {
  return await ctx.db
    .query("tasks")
    .withIndex("by_public_id", (q) => q.eq("id", id))
    .unique();
}

export async function requireProject(ctx: Ctx, id: string) {
  const project = await getProject(ctx, id);
  if (!project) {
    throw new AppError(ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${id}`, { id }, 404);
  }
  return project;
}

export async function requireAgentInProject(ctx: Ctx, agentId: string, projectId: string) {
  const agent = await getAgent(ctx, agentId);
  if (!agent || agent.projectId !== projectId) {
    throw new AppError(ErrorCodes.AGENT_NOT_FOUND, `Agent not found in project: ${agentId}`, { agentId }, 404);
  }
  return agent;
}

export async function requireTaskInProject(ctx: Ctx, taskId: string, projectId: string) {
  const task = await getTask(ctx, taskId);
  if (!task || task.projectId !== projectId) {
    throw new AppError(ErrorCodes.TASK_NOT_FOUND, `Task not found in project: ${taskId}`, { taskId }, 404);
  }
  return task;
}

export async function listProjects(ctx: Ctx) {
  return await ctx.db.query("projects").collect();
}

export async function listProjectsForUser(ctx: Ctx, userId: Id<"users">) {
  const members = await ctx.db
    .query("projectMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const projects = [];
  for (const member of members) {
    const project = await getProject(ctx, member.projectId);
    if (project) {
      projects.push(project);
    }
  }
  return projects;
}

export async function getProjectMember(ctx: Ctx, userId: Id<"users">, projectId: string) {
  return await ctx.db
    .query("projectMembers")
    .withIndex("by_project_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .unique();
}

export async function requireProjectMember(ctx: Ctx, userId: Id<"users">, projectId: string) {
  await requireProject(ctx, projectId);
  const member = await getProjectMember(ctx, userId, projectId);
  if (!member) {
    throw new AppError(ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${projectId}`, { projectId }, 404);
  }
  return member;
}

export async function addProjectMember(
  ctx: MutationCtx,
  userId: Id<"users">,
  projectId: string,
  role: "owner" | "member" = "owner",
) {
  const existing = await getProjectMember(ctx, userId, projectId);
  if (existing) {
    return existing;
  }
  const stored = { userId, projectId, role, createdAt: nowIso() };
  await ctx.db.insert("projectMembers", stored);
  return stored;
}

async function deskProjectIdAdmin(ctx: Ctx): Promise<string> {
  const setting = await ctx.db
    .query("workspaceSettings")
    .withIndex("by_key", (q) => q.eq("key", "desk_project_id"))
    .unique();
  if (setting && (await getProject(ctx, setting.value))) {
    return setting.value;
  }
  const first = (await listProjects(ctx))[0];
  if (first) {
    return first.id;
  }
  throw new AppError(
    ErrorCodes.PROJECT_NOT_FOUND,
    "No project selected. Create one on the website or call register_agent on an empty backend.",
    undefined,
    404,
  );
}

async function deskProjectIdForUser(ctx: Ctx, userId: Id<"users">): Promise<string> {
  const setting = await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (setting && (await getProjectMember(ctx, userId, setting.deskProjectId))) {
    return setting.deskProjectId;
  }
  const first = (await listProjectsForUser(ctx, userId))[0];
  if (first) {
    return first.id;
  }
  throw new AppError(
    ErrorCodes.PROJECT_NOT_FOUND,
    "No project selected. Create one on the website.",
    undefined,
    404,
  );
}

export async function deskProjectId(ctx: Ctx, userId?: Id<"users">): Promise<string> {
  return userId ? await deskProjectIdForUser(ctx, userId) : await deskProjectIdAdmin(ctx);
}

export async function resolveProjectId(ctx: Ctx, projectId?: string, userId?: Id<"users">): Promise<string> {
  if (projectId) {
    if (userId) {
      await requireProjectMember(ctx, userId, projectId);
      return projectId;
    }
    if (await getProject(ctx, projectId)) {
      return projectId;
    }
  }
  return await deskProjectId(ctx, userId);
}

async function ensureDeskAdmin(ctx: MutationCtx): Promise<string> {
  try {
    return await deskProjectIdAdmin(ctx);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== ErrorCodes.PROJECT_NOT_FOUND) {
      throw error;
    }
  }
  const ts = nowIso();
  const id = "synco-mcp";
  if (!(await getProject(ctx, id))) {
    await ctx.db.insert("projects", {
      id,
      name: "synco-mcp",
      createdAt: ts,
      updatedAt: ts,
    });
  }
  await setDeskProjectIdAdmin(ctx, id);
  return id;
}

async function ensureDeskForUser(ctx: MutationCtx, userId: Id<"users">): Promise<string> {
  try {
    return await deskProjectIdForUser(ctx, userId);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== ErrorCodes.PROJECT_NOT_FOUND) {
      throw error;
    }
  }
  const user = await ctx.db.get(userId);
  const name = user?.name || user?.email?.split("@")[0] || "My desk";
  let id = slugifyProjectId(name);
  if (await getProject(ctx, id)) {
    id = `${id}-${newId().slice(0, 8)}`;
  }
  const ts = nowIso();
  await ctx.db.insert("projects", { id, name, createdAt: ts, updatedAt: ts });
  await addProjectMember(ctx, userId, id, "owner");
  await setDeskProjectIdForUser(ctx, userId, id);
  return id;
}

export async function ensureDesk(ctx: MutationCtx, userId?: Id<"users">): Promise<string> {
  return userId ? await ensureDeskForUser(ctx, userId) : await ensureDeskAdmin(ctx);
}

async function setDeskProjectIdAdmin(ctx: MutationCtx, projectId: string): Promise<void> {
  await requireProject(ctx, projectId);
  const existing = await ctx.db
    .query("workspaceSettings")
    .withIndex("by_key", (q) => q.eq("key", "desk_project_id"))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { value: projectId });
    return;
  }
  await ctx.db.insert("workspaceSettings", { key: "desk_project_id", value: projectId });
}

async function setDeskProjectIdForUser(ctx: MutationCtx, userId: Id<"users">, projectId: string): Promise<void> {
  await requireProjectMember(ctx, userId, projectId);
  const existing = await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { deskProjectId: projectId });
    return;
  }
  await ctx.db.insert("userSettings", { userId, deskProjectId: projectId });
}

export async function setDeskProjectId(
  ctx: MutationCtx,
  projectId: string,
  userId?: Id<"users">,
): Promise<void> {
  if (userId) {
    await setDeskProjectIdForUser(ctx, userId, projectId);
    return;
  }
  await setDeskProjectIdAdmin(ctx, projectId);
}

export async function listActiveClaims(ctx: Ctx, projectId: string, limit = 100) {
  const rows = await ctx.db
    .query("claims")
    .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "active"))
    .collect();
  return newestFirst(rows).slice(0, limit);
}

export async function listActiveClaimsByAgent(ctx: Ctx, projectId: string, agentId: string, limit = 100) {
  const rows = await ctx.db
    .query("claims")
    .withIndex("by_project_agent_status", (q) =>
      q.eq("projectId", projectId).eq("agentId", agentId).eq("status", "active"),
    )
    .collect();
  return newestFirst(rows).slice(0, limit);
}

export async function listReports(ctx: Ctx, projectId: string, limit = LIMITS.reports) {
  const rows = await ctx.db
    .query("changeReports")
    .withIndex("by_project_created", (q) => q.eq("projectId", projectId))
    .collect();
  return newestFirst(rows).slice(0, limit);
}

export async function listEvents(ctx: Ctx, projectId: string, limit = LIMITS.events) {
  const rows = await ctx.db
    .query("events")
    .withIndex("by_project_created", (q) => q.eq("projectId", projectId))
    .collect();
  return newestFirst(rows).slice(0, limit);
}

export async function listHandoffs(ctx: Ctx, projectId: string, limit = LIMITS.handoffs) {
  const rows = await ctx.db
    .query("handoffs")
    .withIndex("by_project_created", (q) => q.eq("projectId", projectId))
    .collect();
  return newestFirst(rows).slice(0, limit);
}

export async function findByIdempotency(ctx: Ctx, projectId: string, idempotencyKey: string | undefined) {
  if (!idempotencyKey) {
    return undefined;
  }
  return await ctx.db
    .query("events")
    .withIndex("by_project_idempotency", (q) =>
      q.eq("projectId", projectId).eq("idempotencyKey", idempotencyKey),
    )
    .unique();
}

export async function emit(
  ctx: MutationCtx,
  event: {
    projectId: string;
    type: string;
    agentId?: string;
    taskId?: string;
    payload: unknown;
    idempotencyKey?: string;
  },
) {
  const stored = {
    id: newId(),
    createdAt: nowIso(),
    ...event,
  };
  await ctx.db.insert("events", stored);
  return stored;
}

export async function markStaleAgentsOffline(ctx: MutationCtx, projectId: string): Promise<void> {
  if (AGENT_OFFLINE_MS <= 0) {
    return;
  }
  const seenBefore = new Date(Date.now() - AGENT_OFFLINE_MS).toISOString();
  const agents = await ctx.db
    .query("agents")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  for (const agent of agents) {
    if (agent.status !== "offline" && agent.lastSeenAt < seenBefore) {
      await ctx.db.patch(agent._id, { status: "offline" });
    }
  }
}

export async function protocolStatus(ctx: Ctx, projectId: string, agentId: string) {
  const agent = await getAgent(ctx, agentId);
  const task = agent?.currentTaskId ? await getTask(ctx, agent.currentTaskId) : undefined;
  const openTask = task && task.status === "in_progress" ? task : undefined;
  const claims = await listActiveClaimsByAgent(ctx, projectId, agentId, 100);
  const reports = await listReports(ctx, projectId, 40);
  const reported = openTask
    ? reports.some((report) => report.taskId === openTask.id && report.agentId === agentId)
    : false;

  const openItems: string[] = [];
  if (claims.length > 0 && !openTask) {
    openItems.push(
      `You hold ${claims.length} active claim(s) with no task in progress. Call release_claims when you stop editing.`,
    );
  }
  if (openTask && claims.length > 0 && !reported) {
    openItems.push(
      `Task "${openTask.title}" is in progress and you declared intent but published no report_change yet.`,
    );
  }

  let nextRequiredCall: string;
  if (!openTask) {
    nextRequiredCall = "claim_task (or create_task then claim_task) before editing files";
  } else if (claims.length === 0) {
    nextRequiredCall = "declare_change_intent with every path you will touch";
  } else if (!reported) {
    nextRequiredCall = "report_change after editing, then update_task_status(done)";
  } else {
    nextRequiredCall = "update_task_status(done) to close the task and release claims";
  }

  return {
    nextRequiredCall,
    openItems,
    reminder:
      "Before editing: declare_change_intent. After editing: report_change in the same turn. Only a finished task releases claims; anything else needs release_claims.",
  };
}

export async function computeWarnings(ctx: Ctx, projectId: string) {
  const active = await listActiveClaims(ctx, projectId, 100);
  const groups = new Map<string, OverlapClaim[]>();

  for (let i = 0; i < active.length; i += 1) {
    const current = active[i]!;
    for (let j = i + 1; j < active.length; j += 1) {
      const other = active[j]!;
      if (other.agentId === current.agentId) {
        continue;
      }
      if (findOverlaps([{ type: current.resourceType, path: current.resourcePath }], [other]).length > 0) {
        const key = [current.resourcePath, other.resourcePath].sort().join("::");
        const bucket = groups.get(key) ?? [];
        if (!bucket.some((item) => item.id === current.id)) bucket.push(current);
        if (!bucket.some((item) => item.id === other.id)) bucket.push(other);
        groups.set(key, bucket);
      }
    }
  }

  const current = [...groups.entries()].map(([key, claims]) => ({
    resourcePath: key.split("::")[0] ?? claims[0]!.resourcePath,
    agentIds: [...new Set(claims.map((claim) => claim.agentId))],
    taskIds: [...new Set(claims.map((claim) => claim.taskId).filter(Boolean))] as string[],
    claimIds: claims.map((claim) => claim.id),
    detectedAt: claims[0]!.createdAt,
    status: "active" as const,
  }));

  if (current.length > 0) {
    return current;
  }

  const events = (await listEvents(ctx, projectId, 40)).filter((event) => event.type === "conflict_detected").slice(0, 8);
  return events.flatMap((event) => {
    const payload = (event.payload ?? {}) as {
      resourcePaths?: string[];
      overlappingAgentIds?: string[];
    };
    const paths = payload.resourcePaths ?? [];
    return paths.map((resourcePath) => ({
      resourcePath,
      agentIds: payload.overlappingAgentIds ?? (event.agentId ? [event.agentId] : []),
      taskIds: event.taskId ? [event.taskId] : [],
      claimIds: [] as string[],
      detectedAt: event.createdAt,
      status: "resolved" as const,
    }));
  });
}

export async function compactSnapshot(ctx: Ctx, projectId: string, userId?: Id<"users">) {
  const project = await requireProject(ctx, projectId);
  const agents = newestFirst(
    await ctx.db
      .query("agents")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect(),
  ).slice(0, LIMITS.agents);
  const tasks = newestFirst(
    await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect(),
  )
    .filter((task) => task.status !== "done")
    .slice(0, LIMITS.tasks);
  const claims = await listActiveClaims(ctx, projectId, LIMITS.claims);
  const reports = await listReports(ctx, projectId, LIMITS.reports);
  const events = await listEvents(ctx, projectId, LIMITS.events);
  const handoffs = await listHandoffs(ctx, projectId, LIMITS.handoffs);
  const warnings = await computeWarnings(ctx, projectId);
  const deskId = await deskProjectId(ctx, userId);

  return {
    project: { id: project.id, name: project.name },
    desk: { id: deskId, note: "The project selected in the dashboard. MCP writes here." },
    activeAgents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      platform: agent.platform,
      model: agent.model,
      status: agent.status,
      currentTaskId: agent.currentTaskId,
      lastSeenAt: agent.lastSeenAt,
    })),
    activeTasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      assignedAgentId: task.assignedAgentId,
    })),
    activeClaims: claims.map((claim) => ({
      id: claim.id,
      agentId: claim.agentId,
      taskId: claim.taskId,
      type: claim.resourceType,
      path: claim.resourcePath,
    })),
    recentChangeReports: reports.map((report) => compactReport(report as ReportLike)),
    recentEvents: events.map((event) => compactEvent(event as EventLike)),
    recentHandoffs: handoffs,
    warnings,
  };
}

export async function compactSnapshotFresh(ctx: MutationCtx, projectId: string, userId?: Id<"users">) {
  await markStaleAgentsOffline(ctx, projectId);
  return await compactSnapshot(ctx, projectId, userId);
}
