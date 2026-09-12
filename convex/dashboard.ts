import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { AppError, ErrorCodes } from "./lib/errors.js";
import { compactEvent, type EventLike } from "./lib/summaries.js";
import {
  computeWarnings,
  deskProjectId,
  emit,
  listActiveClaims,
  listEvents,
  listHandoffs,
  listProjectsForUser,
  listReports,
  requireProjectMember,
  setDeskProjectId,
} from "./lib/store.js";

function newestFirst<T extends { createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export const listWorkspace = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const user = await ctx.db.get(userId);
    const projects = await listProjectsForUser(ctx, userId);
    const listed = [];
    for (const project of projects) {
      const count = (
        await ctx.db
          .query("events")
          .withIndex("by_project_created", (q) => q.eq("projectId", project.id))
          .collect()
      ).length;
      listed.push({
        id: project.id,
        name: project.name,
        repositoryUrl: project.repositoryUrl,
        eventCount: count,
      });
    }
    let activeProjectId: string | null = null;
    try {
      activeProjectId = await deskProjectId(ctx, userId);
    } catch {
      activeProjectId = listed[0]?.id ?? null;
    }
    return {
      user: {
        id: userId,
        username: user?.name || user?.email || "user",
        createdAt: "",
      },
      projects: listed,
      activeProjectId,
    };
  },
});

export const getDesk = query({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const project = await requireProjectMember(ctx, userId, args.projectId).then(async () => {
      return await ctx.db
        .query("projects")
        .withIndex("by_public_id", (q) => q.eq("id", args.projectId))
        .unique();
    });
    if (!project) {
      return null;
    }
    const agents = newestFirst(
      await ctx.db
        .query("agents")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
    );
    const tasks = newestFirst(
      await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
    );
    const claims = await listActiveClaims(ctx, args.projectId, 40);
    const reports = await listReports(ctx, args.projectId, 12);
    const events = await listEvents(ctx, args.projectId, 40);
    const handoffs = await listHandoffs(ctx, args.projectId, 10);
    const warnings = await computeWarnings(ctx, args.projectId);

    return {
      project: { id: project.id, name: project.name, repositoryUrl: project.repositoryUrl },
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        platform: agent.platform,
        model: agent.model,
        status: agent.status,
        currentTaskId: agent.currentTaskId,
        lastSeenAt: agent.lastSeenAt,
      })),
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        assignedAgentId: task.assignedAgentId,
        updatedAt: task.updatedAt,
      })),
      claims: claims.map((claim) => ({
        id: claim.id,
        agentId: claim.agentId,
        taskId: claim.taskId,
        resourceType: claim.resourceType,
        resourcePath: claim.resourcePath,
      })),
      reports: reports.map((report) => ({
        id: report.id,
        agentId: report.agentId,
        taskId: report.taskId,
        source: report.source,
        summary: report.summary,
        files: report.files,
        affectedAreas: report.affectedAreas,
        interfacesChanged: report.interfacesChanged,
        breakingChange: report.breakingChange,
        tests: report.tests,
        nextSteps: report.nextSteps,
        createdAt: report.createdAt,
      })),
      events: events.map((event) => compactEvent(event as EventLike)),
      handoffs: handoffs.map((item) => ({
        id: item.id,
        fromAgentId: item.fromAgentId,
        toAgentId: item.toAgentId,
        taskId: item.taskId,
        summary: item.summary,
        remainingWork: item.remainingWork,
        nextSteps: item.nextSteps,
        createdAt: item.createdAt,
      })),
      warnings,
      counts: {
        agents: agents.length,
        tasks: tasks.filter((task) => task.status !== "done").length,
        claims: claims.length,
        warnings: warnings.filter((warning) => warning.status === "active").length,
      },
    };
  },
});

export const addManualLog = mutation({
  args: {
    projectId: v.string(),
    summary: v.string(),
    author: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, "Sign in on the website first.", undefined, 401);
    }
    await requireProjectMember(ctx, userId, args.projectId);
    const user = await ctx.db.get(userId);
    const author =
      args.author && args.author.length > 0 ? args.author : user?.name || user?.email || "desk";
    await emit(ctx, {
      projectId: args.projectId,
      type: "manual_log",
      payload: {
        author,
        summary: args.summary,
        source: "dashboard",
      },
    });
  },
});

export const selectProject = mutation({
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
