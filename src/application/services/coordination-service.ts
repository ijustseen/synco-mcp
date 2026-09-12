import { AppError, ErrorCodes } from "../../domain/errors.js";
import type {
  Agent,
  ChangeReport,
  ConflictWarning,
  EventType,
  Handoff,
  ProjectEvent,
  ResourceClaim,
  Task,
  TaskStatus,
} from "../../domain/types.js";
import { DEFAULT_LIMITS } from "../../domain/types.js";
import type { EventBus } from "../../infrastructure/events/event-bus.js";
import type { Repositories } from "../../infrastructure/repositories/sqlite-repos.js";
import { config } from "../../shared/config.js";
import { findOverlaps, type ResourceRef } from "../../shared/utils/overlap.js";
import { newId, nowIso } from "../../shared/utils/ids.js";
import { compactChangeSummary, compactEvent, compactReport } from "../../shared/utils/summaries.js";
import {
  addManualLogInput,
  createHandoffInput,
  createTaskInput,
  declareIntentInput,
  reportChangeInput,
} from "../../shared/validation/schemas.js";

function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Invalid input", error);
  }
}

export type CoordinationService = ReturnType<typeof createCoordinationService>;

export function createCoordinationService(repos: Repositories, bus: EventBus) {
  function emit(event: Omit<ProjectEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }): ProjectEvent {
    const stored: ProjectEvent = {
      id: event.id ?? newId(),
      createdAt: event.createdAt ?? nowIso(),
      projectId: event.projectId,
      type: event.type,
      agentId: event.agentId,
      taskId: event.taskId,
      payload: event.payload,
      correlationId: event.correlationId,
      idempotencyKey: event.idempotencyKey,
    };
    repos.events.insert(stored);
    bus.publish(stored);
    return stored;
  }

  function replayIfDuplicate(projectId: string, idempotencyKey: string | undefined): ProjectEvent | undefined {
    if (!idempotencyKey) {
      return undefined;
    }
    return repos.events.findByIdempotency(projectId, idempotencyKey);
  }

  function computeWarnings(projectId: string): ConflictWarning[] {
    const active = repos.claims.listActive(projectId, 100);
    const groups = new Map<string, ResourceClaim[]>();

    for (let i = 0; i < active.length; i += 1) {
      const current = active[i]!;
      for (let j = i + 1; j < active.length; j += 1) {
        const other = active[j]!;
        if (
          findOverlaps([{ type: current.resourceType, path: current.resourcePath }], [other]).length > 0
        ) {
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

    return repos.events.listByTypes(projectId, ["conflict_detected"], 8).map((event) => {
      const payload = (event.payload ?? {}) as {
        summary?: string;
        overlappingAgentIds?: string[];
      };
      return {
        resourcePath: payload.summary ?? "Resource overlap",
        agentIds: payload.overlappingAgentIds ?? (event.agentId ? [event.agentId] : []),
        taskIds: event.taskId ? [event.taskId] : [],
        claimIds: [],
        detectedAt: event.createdAt,
        status: "resolved" as const,
      };
    });
  }

  function snapshot(projectId: string) {
    const project = repos.projects.require(projectId);
    const activeAgents = repos.agents.listByProject(projectId, DEFAULT_LIMITS.agents);
    const activeTasks = repos.tasks
      .listByProject(projectId, DEFAULT_LIMITS.tasks)
      .filter((task) => task.status !== "done");
    const activeClaims = repos.claims.listActive(projectId, DEFAULT_LIMITS.claims);
    const recentReports = repos.reports.listByProject(projectId, DEFAULT_LIMITS.reports);
    const recentEvents = repos.events.listByProject(projectId, DEFAULT_LIMITS.events);
    const recentHandoffs = repos.handoffs.listByProject(projectId, DEFAULT_LIMITS.handoffs);
    const warnings = computeWarnings(projectId);

    return {
      project,
      activeAgents,
      activeTasks,
      activeClaims,
      recentReports,
      recentEvents,
      recentHandoffs,
      warnings,
    };
  }

  function compactSnapshot(projectId: string) {
    const state = snapshot(projectId);
    return {
      project: { id: state.project.id, name: state.project.name },
      activeAgents: state.activeAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        platform: agent.platform,
        model: agent.model,
        status: agent.status,
        currentTaskId: agent.currentTaskId,
        lastSeenAt: agent.lastSeenAt,
      })),
      activeTasks: state.activeTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        assignedAgentId: task.assignedAgentId,
      })),
      activeClaims: state.activeClaims.map((claim) => ({
        id: claim.id,
        agentId: claim.agentId,
        taskId: claim.taskId,
        type: claim.resourceType,
        path: claim.resourcePath,
      })),
      recentChangeReports: state.recentReports.map(compactReport),
      recentEvents: state.recentEvents.map(compactEvent),
      warnings: state.warnings,
    };
  }

  return {
    seedDefaultProject() {
      const existing = repos.projects.getById(config.defaultProjectId);
      if (existing) {
        return existing;
      }
      const ts = nowIso();
      return repos.projects.insert({
        id: config.defaultProjectId,
        name: config.defaultProjectName,
        createdAt: ts,
        updatedAt: ts,
      });
    },

    getProjectState(projectId: string) {
      return compactSnapshot(projectId);
    },

    getDashboardState(projectId: string) {
      const state = snapshot(projectId);
      const reports = repos.reports.listByProject(projectId, 12);
      const events = repos.events.listByProject(projectId, 40);
      return {
        project: state.project,
        agents: state.activeAgents,
        tasks: repos.tasks.listByProject(projectId, DEFAULT_LIMITS.tasks),
        claims: state.activeClaims,
        reports,
        events: events.map((event) => ({
          ...compactEvent(event),
          payload: event.payload,
        })),
        handoffs: state.recentHandoffs,
        warnings: state.warnings,
        counts: {
          agents: state.activeAgents.length,
          tasks: state.activeTasks.length,
          claims: state.activeClaims.length,
          warnings: state.warnings.filter((warning) => warning.status === "active").length,
        },
      };
    },

    listEventsAfter(projectId: string, afterId: string | undefined, limit = 50) {
      repos.projects.require(projectId);
      if (!afterId) {
        return repos.events.listByProject(projectId, limit).reverse();
      }
      return repos.events.listAfter(projectId, afterId, limit);
    },

    registerAgent(input: {
      projectId: string;
      agentId?: string;
      name: string;
      platform: string;
      model?: string;
    }) {
      repos.projects.require(input.projectId);
      const ts = nowIso();
      const id = input.agentId ?? newId();
      const existing = repos.agents.getById(id);
      if (existing && existing.projectId !== input.projectId) {
        throw new AppError(
          ErrorCodes.AGENT_PROJECT_MISMATCH,
          `Agent ${id} already belongs to another project`,
          { id, projectId: input.projectId, actualProjectId: existing.projectId },
        );
      }

      const agent: Agent = {
        id,
        projectId: input.projectId,
        name: input.name,
        platform: input.platform,
        model: input.model,
        status: existing?.status ?? "idle",
        currentTaskId: existing?.currentTaskId,
        lastSeenAt: ts,
        createdAt: existing?.createdAt ?? ts,
      };
      const saved = repos.agents.upsert(agent);
      if (!existing) {
        emit({
          projectId: input.projectId,
          type: "agent_registered",
          agentId: saved.id,
          payload: { name: saved.name, platform: saved.platform, model: saved.model, summary: `${saved.name} registered` },
        });
      }
      return {
        agent: saved,
        ...compactSnapshot(input.projectId),
      };
    },

    createTask(raw: {
      projectId: string;
      title: string;
      description?: string;
      idempotencyKey?: string;
    }) {
      const input = parse(createTaskInput, raw);
      repos.projects.require(input.projectId);
      const replayed = replayIfDuplicate(input.projectId, input.idempotencyKey);
      if (replayed) {
        const payload = replayed.payload as { taskId?: string };
        const task = payload.taskId ? repos.tasks.getById(payload.taskId) : undefined;
        return { replayed: true, task, event: compactEvent(replayed) };
      }

      const ts = nowIso();
      const task: Task = {
        id: newId(),
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        status: "todo",
        createdAt: ts,
        updatedAt: ts,
      };
      repos.tasks.insert(task);
      emit({
        projectId: input.projectId,
        type: "task_created",
        taskId: task.id,
        idempotencyKey: input.idempotencyKey,
        payload: { taskId: task.id, title: task.title, summary: `Task created: ${task.title}` },
      });
      return { replayed: false, task };
    },

    claimTask(input: { projectId: string; taskId: string; agentId: string }) {
      repos.projects.require(input.projectId);
      const agent = repos.agents.requireInProject(input.agentId, input.projectId);
      const existing = repos.tasks.requireInProject(input.taskId, input.projectId);
      const ts = nowIso();

      const claimed = repos.tasks.tryClaim({
        taskId: input.taskId,
        projectId: input.projectId,
        agentId: input.agentId,
        updatedAt: ts,
      });

      if (!claimed) {
        const latest = repos.tasks.requireInProject(input.taskId, input.projectId);
        return {
          ok: false as const,
          code: ErrorCodes.TASK_ALREADY_CLAIMED,
          message: `Task already claimed by ${latest.assignedAgentId ?? "another agent"}`,
          task: latest,
        };
      }

      repos.agents.touch(agent.id, ts, { status: "working", currentTaskId: claimed.id });
      emit({
        projectId: input.projectId,
        type: "task_claimed",
        agentId: agent.id,
        taskId: claimed.id,
        payload: { title: existing.title, summary: `${agent.name} claimed "${existing.title}"` },
      });
      emit({
        projectId: input.projectId,
        type: "task_started",
        agentId: agent.id,
        taskId: claimed.id,
        payload: { title: existing.title, summary: `Work started on "${existing.title}"` },
      });

      return { ok: true as const, task: claimed };
    },

    updateTaskStatus(input: {
      projectId: string;
      taskId: string;
      agentId: string;
      status: TaskStatus;
    }) {
      repos.projects.require(input.projectId);
      const agent = repos.agents.requireInProject(input.agentId, input.projectId);
      const task = repos.tasks.requireInProject(input.taskId, input.projectId);
      const ts = nowIso();

      if (task.assignedAgentId && task.assignedAgentId !== agent.id) {
        throw new AppError(
          ErrorCodes.TASK_NOT_ASSIGNED,
          `Task ${task.id} is assigned to another agent`,
          { taskId: task.id, assignedAgentId: task.assignedAgentId },
        );
      }

      const assignedAgentId =
        input.status === "todo" ? null : input.status === "done" ? task.assignedAgentId ?? agent.id : agent.id;
      const updated = repos.tasks.updateStatus({
        taskId: task.id,
        status: input.status,
        assignedAgentId,
        updatedAt: ts,
      });

      const agentStatus = input.status === "done" || input.status === "todo" ? "idle" : input.status === "blocked" ? "blocked" : "working";
      repos.agents.touch(agent.id, ts, {
        status: agentStatus,
        currentTaskId: input.status === "done" || input.status === "todo" ? undefined : task.id,
      });

      if (input.status === "done") {
        repos.claims.releaseByTask(input.projectId, agent.id, task.id, ts);
        emit({
          projectId: input.projectId,
          type: "task_completed",
          agentId: agent.id,
          taskId: task.id,
          payload: { title: task.title, summary: `Task completed: ${task.title}` },
        });
      } else if (input.status === "in_progress") {
        emit({
          projectId: input.projectId,
          type: "task_started",
          agentId: agent.id,
          taskId: task.id,
          payload: { title: task.title, summary: `Task started: ${task.title}` },
        });
      } else {
        emit({
          projectId: input.projectId,
          type: "agent_status_changed",
          agentId: agent.id,
          taskId: task.id,
          payload: { status: input.status, summary: `${agent.name} set task to ${input.status}` },
        });
      }

      return { task: updated };
    },

    declareChangeIntent(raw: {
      projectId: string;
      agentId: string;
      taskId?: string;
      summary: string;
      resources: ResourceRef[];
      idempotencyKey?: string;
    }) {
      const input = parse(declareIntentInput, raw);
      repos.projects.require(input.projectId);
      const agent = repos.agents.requireInProject(input.agentId, input.projectId);
      if (input.taskId) {
        repos.tasks.requireInProject(input.taskId, input.projectId);
      }
      const replayed = replayIfDuplicate(input.projectId, input.idempotencyKey);
      if (replayed) {
        return {
          replayed: true,
          claims: repos.claims.listActive(input.projectId, DEFAULT_LIMITS.claims),
          warnings: computeWarnings(input.projectId),
          note: "Coordination warning only — this is not a Git lock.",
        };
      }

      const ts = nowIso();
      repos.agents.touch(agent.id, ts, { status: "working" });
      const active = repos.claims.listActive(input.projectId, 100);
      const overlaps = findOverlaps(input.resources, active.filter((claim) => claim.agentId !== agent.id));
      const created = input.resources.map((resource) =>
        repos.claims.insert({
          id: newId(),
          projectId: input.projectId,
          agentId: agent.id,
          taskId: input.taskId,
          resourceType: resource.type,
          resourcePath: resource.path,
          status: "active",
          createdAt: ts,
        }),
      );

      emit({
        projectId: input.projectId,
        type: "intent_declared",
        agentId: agent.id,
        taskId: input.taskId,
        idempotencyKey: input.idempotencyKey,
        payload: {
          summary: input.summary,
          resources: input.resources,
        },
      });

      if (overlaps.length > 0) {
        emit({
          projectId: input.projectId,
          type: "conflict_detected",
          agentId: agent.id,
          taskId: input.taskId,
          payload: {
            summary: `Overlap warning on ${overlaps.map((claim) => claim.resourcePath).join(", ")}`,
            overlappingClaimIds: overlaps.map((claim) => claim.id),
            overlappingAgentIds: [...new Set(overlaps.map((claim) => claim.agentId))],
            note: "Declared overlap. This does not prevent Git conflicts.",
          },
        });
      }

      return {
        replayed: false,
        claims: created,
        warnings: computeWarnings(input.projectId),
        overlappingClaims: overlaps.map((claim) => ({
          id: claim.id,
          agentId: claim.agentId,
          path: claim.resourcePath,
          type: claim.resourceType,
        })),
        note: "Coordination warning only — resource claims are not a Git lock and do not guarantee a conflict-free merge.",
      };
    },

    reportChange(raw: {
      projectId: string;
      agentId: string;
      taskId?: string;
      summary: string;
      files: ChangeReport["files"];
      affectedAreas: string[];
      interfacesChanged: ChangeReport["interfacesChanged"];
      behaviorChanges: string[];
      breakingChange: boolean;
      tests: ChangeReport["tests"];
      nextSteps: string[];
      commitHash?: string;
      idempotencyKey?: string;
    }) {
      const input = parse(reportChangeInput, raw);
      repos.projects.require(input.projectId);
      const agent = repos.agents.requireInProject(input.agentId, input.projectId);
      if (input.taskId) {
        repos.tasks.requireInProject(input.taskId, input.projectId);
      }
      const replayed = replayIfDuplicate(input.projectId, input.idempotencyKey);
      if (replayed) {
        const payload = replayed.payload as { reportId?: string };
        const report = payload.reportId ? repos.reports.getById(payload.reportId) : undefined;
        return {
          replayed: true,
          confirmation: report ? compactReport(report) : compactEvent(replayed),
          source: "agent_declared" as const,
        };
      }

      const ts = nowIso();
      repos.agents.touch(agent.id, ts);
      const report: ChangeReport = {
        id: newId(),
        projectId: input.projectId,
        taskId: input.taskId,
        agentId: agent.id,
        source: "agent_declared",
        summary: input.summary,
        files: input.files,
        affectedAreas: input.affectedAreas,
        interfacesChanged: input.interfacesChanged,
        behaviorChanges: input.behaviorChanges,
        breakingChange: input.breakingChange,
        tests: input.tests,
        nextSteps: input.nextSteps,
        commitHash: input.commitHash,
        createdAt: ts,
      };
      repos.reports.insert(report);
      emit({
        projectId: input.projectId,
        type: "change_reported",
        agentId: agent.id,
        taskId: input.taskId,
        idempotencyKey: input.idempotencyKey,
        payload: {
          reportId: report.id,
          summary: compactChangeSummary(report),
          affectedAreas: report.affectedAreas,
        },
      });

      return {
        replayed: false,
        confirmation: compactReport(report),
        detailed: report,
        source: "agent_declared" as const,
        note: "This is an agent-declared report, not a verified Git diff.",
      };
    },

    getRecentChanges(input: {
      projectId: string;
      limit?: number;
      since?: string;
      area?: string;
      detail?: "compact" | "full";
    }) {
      repos.projects.require(input.projectId);
      const limit = Math.min(input.limit ?? DEFAULT_LIMITS.reports, DEFAULT_LIMITS.reports);
      const reports = repos.reports.listByProject(input.projectId, limit, input.since, input.area);
      if (input.detail === "full") {
        return { source: "agent_declared" as const, reports };
      }
      return { source: "agent_declared" as const, reports: reports.map(compactReport) };
    },

    getResourceClaims(input: { projectId: string; path?: string }) {
      repos.projects.require(input.projectId);
      const claims = repos.claims.listActive(input.projectId, DEFAULT_LIMITS.claims);
      const filtered = input.path
        ? claims.filter(
            (claim) =>
              findOverlaps([{ type: "file", path: input.path! }], [claim]).length > 0 ||
              claim.resourcePath.includes(input.path!),
          )
        : claims;
      return {
        claims: filtered,
        note: "Claims are a coordination signal, not exclusive Git locks.",
      };
    },

    createHandoff(raw: {
      projectId: string;
      fromAgentId: string;
      toAgentId?: string;
      taskId?: string;
      summary: string;
      completedWork: string[];
      remainingWork: string[];
      importantFiles: string[];
      knownIssues: string[];
      nextSteps: string[];
      idempotencyKey?: string;
    }) {
      const input = parse(createHandoffInput, raw);
      repos.projects.require(input.projectId);
      const from = repos.agents.requireInProject(input.fromAgentId, input.projectId);
      if (input.toAgentId) {
        repos.agents.requireInProject(input.toAgentId, input.projectId);
      }
      if (input.taskId) {
        repos.tasks.requireInProject(input.taskId, input.projectId);
      }
      const replayed = replayIfDuplicate(input.projectId, input.idempotencyKey);
      if (replayed) {
        const payload = replayed.payload as { handoffId?: string };
        const items = repos.handoffs.listByProject(input.projectId, DEFAULT_LIMITS.handoffs);
        return {
          replayed: true,
          handoff: items.find((item) => item.id === payload.handoffId) ?? items[0],
        };
      }

      const ts = nowIso();
      repos.agents.touch(from.id, ts);
      const handoff: Handoff = {
        id: newId(),
        projectId: input.projectId,
        fromAgentId: from.id,
        toAgentId: input.toAgentId,
        taskId: input.taskId,
        summary: input.summary,
        completedWork: input.completedWork,
        remainingWork: input.remainingWork,
        importantFiles: input.importantFiles,
        knownIssues: input.knownIssues,
        nextSteps: input.nextSteps,
        createdAt: ts,
      };
      repos.handoffs.insert(handoff);
      emit({
        projectId: input.projectId,
        type: "handoff_created",
        agentId: from.id,
        taskId: input.taskId,
        idempotencyKey: input.idempotencyKey,
        payload: {
          handoffId: handoff.id,
          toAgentId: handoff.toAgentId,
          summary: handoff.summary,
        },
      });
      return { replayed: false, handoff };
    },

    addManualLog(raw: { projectId: string; summary: string; author?: string }) {
      const input = parse(addManualLogInput, raw);
      repos.projects.require(input.projectId);
      const author = input.author ?? "desk";
      const event = emit({
        projectId: input.projectId,
        type: "manual_log",
        payload: {
          author,
          summary: input.summary,
          source: "dashboard",
        },
      });
      return { event: compactEvent(event) };
    },

    getAgentContext(input: { projectId: string; agentId: string }) {
      repos.projects.require(input.projectId);
      const agent = repos.agents.requireInProject(input.agentId, input.projectId);
      repos.agents.touch(agent.id, nowIso());
      const task = agent.currentTaskId ? repos.tasks.getById(agent.currentTaskId) : undefined;
      const claims = repos.claims
        .listActive(input.projectId, DEFAULT_LIMITS.claims)
        .filter((claim) => claim.agentId === agent.id);
      const reports = repos.reports.listByProject(input.projectId, 5);
      const handoffs = repos.handoffs
        .listByProject(input.projectId, 8)
        .filter((item) => item.toAgentId === agent.id || item.fromAgentId === agent.id || !item.toAgentId);
      const relevantEvents = repos.events.listByTypes(
        input.projectId,
        [
          "change_reported",
          "intent_declared",
          "handoff_created",
          "conflict_detected",
          "task_claimed",
          "manual_log",
        ] satisfies EventType[],
        10,
      );

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
        recentReports: reports.map(compactReport),
        handoffs: handoffs.map((item) => ({
          id: item.id,
          fromAgentId: item.fromAgentId,
          toAgentId: item.toAgentId,
          summary: item.summary,
          remainingWork: item.remainingWork,
          nextSteps: item.nextSteps,
        })),
        warnings: computeWarnings(input.projectId),
        recentSignals: relevantEvents.map(compactEvent),
      };
    },
  };
}
