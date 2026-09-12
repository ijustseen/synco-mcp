import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { AppError, ErrorCodes } from "./lib/errors.js";
import { newId, nowIso, slugifyProjectId } from "./lib/ids.js";
import { findOverlaps, type ResourceRef } from "./lib/overlap.js";
import { compactEvent, compactReport, type EventLike, type ReportLike } from "./lib/summaries.js";
import {
  addProjectMember,
  compactSnapshot,
  compactSnapshotFresh,
  computeWarnings,
  deskProjectId,
  emit,
  ensureDesk,
  findByIdempotency,
  getAgent,
  getProject,
  getProjectMember,
  LIMITS,
  listActiveClaims,
  listActiveClaimsByAgent,
  listEvents,
  listHandoffs,
  listProjects,
  listProjectsForUser,
  listReports,
  markStaleAgentsOffline,
  protocolStatus,
  requireAgentInProject,
  requireProject,
  requireTaskInProject,
  resolveProjectId,
  setDeskProjectId,
} from "./lib/store.js";

const actorUserId = v.optional(v.id("users"));

function asResource(resource: ResourceRef): ResourceRef {
  return { type: resource.type, path: resource.path };
}

export const health = query({
  args: {},
  handler: async () => ({ ok: true, name: "synco-mcp", version: "0.1.0", backend: "convex" }),
});

export const getProjectState = internalQuery({
  args: { projectId: v.optional(v.string()), actorUserId },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    return await compactSnapshot(ctx, projectId, args.actorUserId);
  },
});

export const getRecentChanges = internalQuery({
  args: {
    projectId: v.optional(v.string()),
    actorUserId,
    limit: v.optional(v.number()),
    since: v.optional(v.string()),
    area: v.optional(v.string()),
    detail: v.optional(v.union(v.literal("compact"), v.literal("full"))),
  },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    await requireProject(ctx, projectId);
    const limit = Math.min(args.limit ?? LIMITS.reports, LIMITS.reports);
    let reports = await listReports(ctx, projectId, 40);
    if (args.since) {
      reports = reports.filter((report) => report.createdAt > args.since!);
    }
    if (args.area) {
      reports = reports.filter((report) => report.affectedAreas.includes(args.area!));
    }
    reports = reports.slice(0, limit);
    if (args.detail === "full") {
      return { source: "agent_declared" as const, reports };
    }
    return { source: "agent_declared" as const, reports: reports.map((report) => compactReport(report as ReportLike)) };
  },
});

export const getResourceClaims = internalQuery({
  args: { projectId: v.optional(v.string()), actorUserId, path: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    await requireProject(ctx, projectId);
    const claims = await listActiveClaims(ctx, projectId, LIMITS.claims);
    const filtered = args.path
      ? claims.filter(
          (claim) =>
            findOverlaps([{ type: "file", path: args.path! }], [claim]).length > 0 ||
            claim.resourcePath.includes(args.path!),
        )
      : claims;
    return {
      claims: filtered,
      note: "Claims are a coordination signal, not exclusive Git locks.",
    };
  },
});

export const checkEditGuard = internalQuery({
  args: {
    projectId: v.optional(v.string()),
    actorUserId,
    agentId: v.string(),
    path: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId ?? (await deskProjectId(ctx, args.actorUserId).catch(() => ""));
    const deny = (code: string, message: string) => ({
      allowed: false as const,
      code,
      message,
      projectId,
      agentId: args.agentId,
      path: args.path,
    });

    if (
      !projectId ||
      !(await getProject(ctx, projectId)) ||
      (args.actorUserId && !(await getProjectMember(ctx, args.actorUserId, projectId)))
    ) {
      return deny(
        "PROJECT_NOT_FOUND",
        `synco-mcp has no project "${projectId}". Check the projectId before editing.`,
      );
    }

    const agent = await getAgent(ctx, args.agentId);
    if (!agent || agent.projectId !== projectId) {
      return deny(
        "NOT_REGISTERED",
        `Agent "${args.agentId}" is not registered in project "${projectId}". Call register_agent, then declare_change_intent for the paths you will touch.`,
      );
    }

    const mine = await listActiveClaimsByAgent(ctx, projectId, args.agentId, 100);
    if (mine.length === 0) {
      return deny(
        "NO_INTENT",
        "No active change intent. Call declare_change_intent with every path you are about to touch, then retry.",
      );
    }

    if (args.path) {
      const covered = findOverlaps([{ type: "file", path: args.path }], mine);
      if (covered.length === 0) {
        return deny(
          "PATH_NOT_DECLARED",
          `${args.path} is not in your declared intent. Call declare_change_intent for it (declared: ${mine
            .map((claim) => claim.resourcePath)
            .slice(0, 8)
            .join(", ")}).`,
        );
      }
    }

    const others = args.path
      ? findOverlaps(
          [{ type: "file", path: args.path }],
          (await listActiveClaims(ctx, projectId, 100)).filter((claim) => claim.agentId !== args.agentId),
        )
      : [];

    return {
      allowed: true as const,
      code: "OK",
      message: "Declared intent covers this path.",
      projectId,
      agentId: args.agentId,
      path: args.path,
      overlappingAgentIds: [...new Set(others.map((claim) => claim.agentId))],
    };
  },
});

export const getAgentContext = internalMutation({
  args: { projectId: v.optional(v.string()), actorUserId, agentId: v.string() },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    const agent = await requireAgentInProject(ctx, args.agentId, projectId);
    await ctx.db.patch(agent._id, { lastSeenAt: nowIso() });
    await markStaleAgentsOffline(ctx, projectId);
    const task = agent.currentTaskId ? await ctx.db
      .query("tasks")
      .withIndex("by_public_id", (q) => q.eq("id", agent.currentTaskId!))
      .unique() : undefined;
    const claims = (await listActiveClaims(ctx, projectId, LIMITS.claims)).filter(
      (claim) => claim.agentId === agent.id,
    );
    const reports = await listReports(ctx, projectId, 5);
    const handoffs = (await listHandoffs(ctx, projectId, 8)).filter(
      (item) => item.toAgentId === agent.id || item.fromAgentId === agent.id || !item.toAgentId,
    );
    const relevant = (await listEvents(ctx, projectId, 40))
      .filter((event) =>
        [
          "change_reported",
          "intent_declared",
          "handoff_created",
          "conflict_detected",
          "task_claimed",
          "manual_log",
        ].includes(event.type),
      )
      .slice(0, 10);

    return {
      agent: {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        currentTaskId: agent.currentTaskId,
      },
      currentTask: task
        ? { id: task.id, title: task.title, status: task.status, description: task.description }
        : null,
      myClaims: claims.map((claim) => ({ path: claim.resourcePath, type: claim.resourceType })),
      recentReports: reports.map((report) => compactReport(report as ReportLike)),
      handoffs: handoffs.map((item) => ({
        id: item.id,
        fromAgentId: item.fromAgentId,
        toAgentId: item.toAgentId,
        summary: item.summary,
        remainingWork: item.remainingWork,
        nextSteps: item.nextSteps,
      })),
      warnings: await computeWarnings(ctx, projectId),
      recentSignals: relevant.map((event) => compactEvent(event as EventLike)),
      protocol: await protocolStatus(ctx, projectId, agent.id),
    };
  },
});

export const registerAgent = internalMutation({
  args: {
    projectId: v.optional(v.string()),
    actorUserId,
    agentId: v.optional(v.string()),
    name: v.string(),
    platform: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId =
      args.projectId && (await getProject(ctx, args.projectId))
        ? await resolveProjectId(ctx, args.projectId, args.actorUserId)
        : await ensureDesk(ctx, args.actorUserId);
    const ts = nowIso();
    const id = args.agentId ?? newId();
    const existing = await getAgent(ctx, id);
    if (existing && existing.projectId !== projectId) {
      await ctx.db.patch(existing._id, { projectId, lastSeenAt: ts });
    }

    const saved = existing
      ? await (async () => {
          await ctx.db.patch(existing._id, {
            projectId,
            name: args.name,
            platform: args.platform,
            model: args.model,
            lastSeenAt: ts,
          });
          return { ...existing, projectId, name: args.name, platform: args.platform, model: args.model, lastSeenAt: ts };
        })()
      : {
          id,
          projectId,
          name: args.name,
          platform: args.platform,
          model: args.model,
          status: "idle" as const,
          lastSeenAt: ts,
          createdAt: ts,
        };

    if (!existing) {
      await ctx.db.insert("agents", saved);
      await emit(ctx, {
        projectId,
        type: "agent_registered",
        agentId: saved.id,
        payload: { name: saved.name, platform: saved.platform, model: saved.model, summary: `${saved.name} registered` },
      });
    }

    return {
      agent: saved,
      ...(await compactSnapshotFresh(ctx, projectId, args.actorUserId)),
      protocol: await protocolStatus(ctx, projectId, saved.id),
    };
  },
});

export const createTask = internalMutation({
  args: {
    projectId: v.optional(v.string()),
    actorUserId,
    title: v.string(),
    description: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    await requireProject(ctx, projectId);
    const replayed = await findByIdempotency(ctx, projectId, args.idempotencyKey);
    if (replayed) {
      const payload = replayed.payload as { taskId?: string };
      const task = payload.taskId
        ? await ctx.db
            .query("tasks")
            .withIndex("by_public_id", (q) => q.eq("id", payload.taskId!))
            .unique()
        : undefined;
      return { replayed: true, task, event: compactEvent(replayed as EventLike) };
    }

    const ts = nowIso();
    const task = {
      id: newId(),
      projectId,
      title: args.title,
      description: args.description,
      status: "todo" as const,
      createdAt: ts,
      updatedAt: ts,
    };
    await ctx.db.insert("tasks", task);
    await emit(ctx, {
      projectId,
      type: "task_created",
      taskId: task.id,
      idempotencyKey: args.idempotencyKey,
      payload: { taskId: task.id, title: task.title, summary: `Task created: ${task.title}` },
    });
    return { replayed: false, task };
  },
});

export const claimTask = internalMutation({
  args: { projectId: v.optional(v.string()), actorUserId, taskId: v.string(), agentId: v.string() },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    const agent = await requireAgentInProject(ctx, args.agentId, projectId);
    const existing = await requireTaskInProject(ctx, args.taskId, projectId);
    const ts = nowIso();

    if (existing.assignedAgentId && existing.assignedAgentId !== args.agentId && existing.status !== "todo") {
      return {
        ok: false as const,
        code: ErrorCodes.TASK_ALREADY_CLAIMED,
        message: `Task already claimed by ${existing.assignedAgentId}`,
        task: existing,
      };
    }

    await ctx.db.patch(existing._id, {
      status: "in_progress",
      assignedAgentId: args.agentId,
      updatedAt: ts,
    });
    await ctx.db.patch(agent._id, { status: "working", currentTaskId: existing.id, lastSeenAt: ts });
    await emit(ctx, {
      projectId,
      type: "task_claimed",
      agentId: agent.id,
      taskId: existing.id,
      payload: { title: existing.title, summary: `${agent.name} claimed "${existing.title}"` },
    });
    await emit(ctx, {
      projectId,
      type: "task_started",
      agentId: agent.id,
      taskId: existing.id,
      payload: { title: existing.title, summary: `Work started on "${existing.title}"` },
    });

    return {
      ok: true as const,
      task: { ...existing, status: "in_progress" as const, assignedAgentId: args.agentId, updatedAt: ts },
    };
  },
});

export const updateTaskStatus = internalMutation({
  args: {
    projectId: v.optional(v.string()),
    actorUserId,
    taskId: v.string(),
    agentId: v.string(),
    status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("blocked"), v.literal("done")),
  },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    const agent = await requireAgentInProject(ctx, args.agentId, projectId);
    const task = await requireTaskInProject(ctx, args.taskId, projectId);
    const ts = nowIso();

    if (task.assignedAgentId && task.assignedAgentId !== agent.id) {
      throw new AppError(ErrorCodes.TASK_NOT_ASSIGNED, `Task ${task.id} is assigned to another agent`, {
        taskId: task.id,
        assignedAgentId: task.assignedAgentId,
      });
    }

    const assignedAgentId =
      args.status === "todo" ? undefined : args.status === "done" ? task.assignedAgentId ?? agent.id : agent.id;
    await ctx.db.patch(task._id, { status: args.status, assignedAgentId, updatedAt: ts });

    const agentStatus =
      args.status === "done" || args.status === "todo" ? "idle" : args.status === "blocked" ? "blocked" : "working";
    await ctx.db.patch(agent._id, {
      status: agentStatus,
      currentTaskId: args.status === "done" || args.status === "todo" ? undefined : task.id,
      lastSeenAt: ts,
    });

    if (args.status === "done") {
      const mine = await listActiveClaimsByAgent(ctx, projectId, agent.id, 100);
      for (const claim of mine.filter((item) => item.taskId === task.id)) {
        await ctx.db.patch(claim._id, { status: "released", releasedAt: ts });
      }
      await emit(ctx, {
        projectId,
        type: "task_completed",
        agentId: agent.id,
        taskId: task.id,
        payload: { title: task.title, summary: `Task completed: ${task.title}` },
      });
    } else if (args.status === "in_progress") {
      await emit(ctx, {
        projectId,
        type: "task_started",
        agentId: agent.id,
        taskId: task.id,
        payload: { title: task.title, summary: `Task started: ${task.title}` },
      });
    } else {
      await emit(ctx, {
        projectId,
        type: "agent_status_changed",
        agentId: agent.id,
        taskId: task.id,
        payload: { status: args.status, summary: `${agent.name} set task to ${args.status}` },
      });
    }

    return { task: { ...task, status: args.status, assignedAgentId, updatedAt: ts } };
  },
});

export const declareChangeIntent = internalMutation({
  args: {
    projectId: v.optional(v.string()),
    actorUserId,
    agentId: v.string(),
    taskId: v.optional(v.string()),
    summary: v.string(),
    resources: v.array(
      v.object({
        type: v.union(v.literal("file"), v.literal("directory"), v.literal("glob")),
        path: v.string(),
      }),
    ),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    const agent = await requireAgentInProject(ctx, args.agentId, projectId);
    if (args.taskId) {
      await requireTaskInProject(ctx, args.taskId, projectId);
    }
    const replayed = await findByIdempotency(ctx, projectId, args.idempotencyKey);
    if (replayed) {
      return {
        replayed: true,
        claims: await listActiveClaims(ctx, projectId, LIMITS.claims),
        warnings: await computeWarnings(ctx, projectId),
        note: "Coordination warning only — this is not a Git lock.",
        protocol: await protocolStatus(ctx, projectId, agent.id),
      };
    }

    const ts = nowIso();
    await ctx.db.patch(agent._id, { status: "working", lastSeenAt: ts });
    const active = await listActiveClaims(ctx, projectId, 100);
    const overlaps = findOverlaps(
      args.resources.map(asResource),
      active.filter((claim) => claim.agentId !== agent.id),
    );
    const created = [];
    for (const resource of args.resources) {
      const claim = {
        id: newId(),
        projectId,
        agentId: agent.id,
        taskId: args.taskId,
        resourceType: resource.type,
        resourcePath: resource.path,
        status: "active" as const,
        createdAt: ts,
      };
      await ctx.db.insert("claims", claim);
      created.push(claim);
    }

    await emit(ctx, {
      projectId,
      type: "intent_declared",
      agentId: agent.id,
      taskId: args.taskId,
      idempotencyKey: args.idempotencyKey,
      payload: { summary: args.summary, resources: args.resources },
    });

    if (overlaps.length > 0) {
      await emit(ctx, {
        projectId,
        type: "conflict_detected",
        agentId: agent.id,
        taskId: args.taskId,
        payload: {
          summary: `Overlap warning on ${overlaps.map((claim) => claim.resourcePath).join(", ")}`,
          resourcePaths: [...new Set(overlaps.map((claim) => claim.resourcePath))],
          overlappingClaimIds: overlaps.map((claim) => claim.id),
          overlappingAgentIds: [...new Set(overlaps.map((claim) => claim.agentId))],
          note: "Declared overlap. This does not prevent Git conflicts.",
        },
      });
    }

    return {
      replayed: false,
      claims: created,
      warnings: await computeWarnings(ctx, projectId),
      overlappingClaims: overlaps.map((claim) => ({
        id: claim.id,
        agentId: claim.agentId,
        path: claim.resourcePath,
        type: claim.resourceType,
      })),
      note: "Coordination warning only — resource claims are not a Git lock and do not guarantee a conflict-free merge.",
      protocol: await protocolStatus(ctx, projectId, agent.id),
    };
  },
});

export const reportChange = internalMutation({
  args: {
    projectId: v.optional(v.string()),
    actorUserId,
    agentId: v.string(),
    taskId: v.optional(v.string()),
    summary: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        action: v.union(v.literal("created"), v.literal("modified"), v.literal("deleted")),
        description: v.string(),
      }),
    ),
    affectedAreas: v.array(v.string()),
    interfacesChanged: v.array(v.object({ name: v.string(), description: v.string() })),
    behaviorChanges: v.array(v.string()),
    breakingChange: v.boolean(),
    tests: v.object({
      status: v.union(v.literal("not_run"), v.literal("passed"), v.literal("failed"), v.literal("partial")),
      summary: v.optional(v.string()),
    }),
    nextSteps: v.array(v.string()),
    commitHash: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    const agent = await requireAgentInProject(ctx, args.agentId, projectId);
    if (args.taskId) {
      await requireTaskInProject(ctx, args.taskId, projectId);
    }
    const replayed = await findByIdempotency(ctx, projectId, args.idempotencyKey);
    if (replayed) {
      const payload = replayed.payload as { reportId?: string };
      const report = payload.reportId
        ? await ctx.db
            .query("changeReports")
            .withIndex("by_public_id", (q) => q.eq("id", payload.reportId!))
            .unique()
        : undefined;
      return {
        replayed: true,
        confirmation: report ? compactReport(report as ReportLike) : compactEvent(replayed as EventLike),
        source: "agent_declared" as const,
      };
    }

    const ts = nowIso();
    await ctx.db.patch(agent._id, { lastSeenAt: ts });
    const report = {
      id: newId(),
      projectId,
      taskId: args.taskId,
      agentId: agent.id,
      source: "agent_declared" as const,
      summary: args.summary,
      files: args.files,
      affectedAreas: args.affectedAreas,
      interfacesChanged: args.interfacesChanged,
      behaviorChanges: args.behaviorChanges,
      breakingChange: args.breakingChange,
      tests: args.tests,
      nextSteps: args.nextSteps,
      commitHash: args.commitHash,
      createdAt: ts,
    };
    await ctx.db.insert("changeReports", report);
    await emit(ctx, {
      projectId,
      type: "change_reported",
      agentId: agent.id,
      taskId: args.taskId,
      idempotencyKey: args.idempotencyKey,
      payload: {
        reportId: report.id,
        summary: compactReport(report).summary,
        affectedAreas: report.affectedAreas,
      },
    });

    return {
      replayed: false,
      confirmation: compactReport(report),
      detailed: report,
      source: "agent_declared" as const,
      note: "This is an agent-declared report, not a verified Git diff.",
      protocol: await protocolStatus(ctx, projectId, agent.id),
    };
  },
});

export const releaseClaims = internalMutation({
  args: {
    projectId: v.optional(v.string()),
    actorUserId,
    agentId: v.string(),
    claimIds: v.optional(v.array(v.string())),
    paths: v.optional(v.array(v.string())),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    const agent = await requireAgentInProject(ctx, args.agentId, projectId);
    const mine = await listActiveClaimsByAgent(ctx, projectId, agent.id, 100);
    const selected = mine.filter((claim) => {
      const byId = args.claimIds ? args.claimIds.includes(claim.id) : false;
      const byPath = args.paths ? args.paths.includes(claim.resourcePath) : false;
      if (!args.claimIds && !args.paths) {
        return true;
      }
      return byId || byPath;
    });

    if (selected.length === 0) {
      return {
        released: 0,
        claims: [],
        remainingClaims: mine,
        note: "Nothing to release. You can only release your own active claims.",
      };
    }

    const ts = nowIso();
    for (const claim of selected) {
      await ctx.db.patch(claim._id, { status: "released", releasedAt: ts });
    }
    const paths = selected.map((claim) => claim.resourcePath);
    await emit(ctx, {
      projectId,
      type: "claims_released",
      agentId: agent.id,
      payload: {
        summary: `${agent.name} released ${selected.length} claim${selected.length === 1 ? "" : "s"}: ${paths.join(", ")}`,
        resourcePaths: paths,
        reason: args.reason,
      },
    });

    return {
      released: selected.length,
      claims: selected.map((claim) => ({
        id: claim.id,
        type: claim.resourceType,
        path: claim.resourcePath,
      })),
      remainingClaims: await listActiveClaimsByAgent(ctx, projectId, agent.id, LIMITS.claims),
      warnings: await computeWarnings(ctx, projectId),
    };
  },
});

export const createHandoff = internalMutation({
  args: {
    projectId: v.optional(v.string()),
    actorUserId,
    fromAgentId: v.string(),
    toAgentId: v.optional(v.string()),
    taskId: v.optional(v.string()),
    summary: v.string(),
    completedWork: v.array(v.string()),
    remainingWork: v.array(v.string()),
    importantFiles: v.array(v.string()),
    knownIssues: v.array(v.string()),
    nextSteps: v.array(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = await resolveProjectId(ctx, args.projectId, args.actorUserId);
    const from = await requireAgentInProject(ctx, args.fromAgentId, projectId);
    if (args.toAgentId) {
      await requireAgentInProject(ctx, args.toAgentId, projectId);
    }
    if (args.taskId) {
      await requireTaskInProject(ctx, args.taskId, projectId);
    }
    const replayed = await findByIdempotency(ctx, projectId, args.idempotencyKey);
    if (replayed) {
      const payload = replayed.payload as { handoffId?: string };
      const items = await listHandoffs(ctx, projectId, LIMITS.handoffs);
      return {
        replayed: true,
        handoff: items.find((item) => item.id === payload.handoffId) ?? items[0],
      };
    }

    const ts = nowIso();
    await ctx.db.patch(from._id, { lastSeenAt: ts });
    const handoff = {
      id: newId(),
      projectId,
      fromAgentId: from.id,
      toAgentId: args.toAgentId,
      taskId: args.taskId,
      summary: args.summary,
      completedWork: args.completedWork,
      remainingWork: args.remainingWork,
      importantFiles: args.importantFiles,
      knownIssues: args.knownIssues,
      nextSteps: args.nextSteps,
      createdAt: ts,
    };
    await ctx.db.insert("handoffs", handoff);
    await emit(ctx, {
      projectId,
      type: "handoff_created",
      agentId: from.id,
      taskId: args.taskId,
      idempotencyKey: args.idempotencyKey,
      payload: {
        handoffId: handoff.id,
        toAgentId: handoff.toAgentId,
        summary: handoff.summary,
      },
    });
    return { replayed: false, handoff };
  },
});

export const createProject = mutation({
  args: { name: v.string(), id: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, "Sign in on the website first.", undefined, 401);
    }
    let id = args.id ?? slugifyProjectId(args.name);
    if (await getProject(ctx, id)) {
      if (args.id) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, `Project id already exists: ${id}`, { id }, 409);
      }
      id = `${id}-${newId().slice(0, 8)}`;
    }
    const ts = nowIso();
    const project = { id, name: args.name, createdAt: ts, updatedAt: ts };
    await ctx.db.insert("projects", project);
    await addProjectMember(ctx, userId, id, "owner");
    if ((await listProjectsForUser(ctx, userId)).length === 1) {
      await setDeskProjectId(ctx, id, userId);
    }
    return project;
  },
});

export const setActiveProject = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, "Sign in on the website first.", undefined, 401);
    }
    await setDeskProjectId(ctx, args.projectId, userId);
    return { activeProjectId: args.projectId };
  },
});

export const markAllStaleOffline = internalMutation({
  args: {},
  handler: async (ctx) => {
    const projects = await listProjects(ctx);
    for (const project of projects) {
      await markStaleAgentsOffline(ctx, project.id);
    }
  },
});
