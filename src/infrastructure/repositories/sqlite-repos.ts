import { and, asc, desc, eq, gt, gte, isNull } from "drizzle-orm";
import { AppError, ErrorCodes } from "../../domain/errors.js";
import type {
  Agent,
  ChangeReport,
  EventType,
  Handoff,
  Project,
  ProjectEvent,
  ResourceClaim,
  Task,
  TaskStatus,
} from "../../domain/types.js";
import type { DatabaseContext } from "../database/client.js";
import {
  agents,
  changeReports,
  handoffs,
  projectEvents,
  projects,
  resourceClaims,
  tasks,
} from "../database/schema.js";
import {
  mapAgent,
  mapClaim,
  mapEvent,
  mapHandoff,
  mapProject,
  mapReport,
  mapTask,
} from "./mappers.js";

export function createRepositories(ctx: DatabaseContext) {
  const { db } = ctx;

  return {
    projects: {
      getById(id: string): Project | undefined {
        const row = db.select().from(projects).where(eq(projects.id, id)).get();
        return row ? mapProject(row) : undefined;
      },
      require(id: string): Project {
        const project = this.getById(id);
        if (!project) {
          throw new AppError(ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${id}`, { id }, 404);
        }
        return project;
      },
      insert(project: Project): Project {
        db.insert(projects)
          .values({
            id: project.id,
            name: project.name,
            repositoryUrl: project.repositoryUrl ?? null,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          })
          .run();
        return project;
      },
    },

    agents: {
      getById(id: string): Agent | undefined {
        const row = db.select().from(agents).where(eq(agents.id, id)).get();
        return row ? mapAgent(row) : undefined;
      },
      requireInProject(id: string, projectId: string): Agent {
        const agent = this.getById(id);
        if (!agent) {
          throw new AppError(ErrorCodes.AGENT_NOT_FOUND, `Agent not found: ${id}`, { id }, 404);
        }
        if (agent.projectId !== projectId) {
          throw new AppError(
            ErrorCodes.AGENT_PROJECT_MISMATCH,
            `Agent ${id} does not belong to project ${projectId}`,
            { id, projectId, actualProjectId: agent.projectId },
          );
        }
        return agent;
      },
      listByProject(projectId: string, limit: number): Agent[] {
        return db
          .select()
          .from(agents)
          .where(eq(agents.projectId, projectId))
          .orderBy(desc(agents.lastSeenAt))
          .limit(limit)
          .all()
          .map(mapAgent);
      },
      upsert(agent: Agent): Agent {
        const existing = this.getById(agent.id);
        if (existing) {
          db.update(agents)
            .set({
              name: agent.name,
              platform: agent.platform,
              model: agent.model ?? null,
              status: agent.status,
              currentTaskId: agent.currentTaskId ?? null,
              lastSeenAt: agent.lastSeenAt,
            })
            .where(eq(agents.id, agent.id))
            .run();
          return this.getById(agent.id)!;
        }
        db.insert(agents)
          .values({
            id: agent.id,
            projectId: agent.projectId,
            name: agent.name,
            platform: agent.platform,
            model: agent.model ?? null,
            status: agent.status,
            currentTaskId: agent.currentTaskId ?? null,
            lastSeenAt: agent.lastSeenAt,
            createdAt: agent.createdAt,
          })
          .run();
        return agent;
      },
      touch(id: string, lastSeenAt: string, extra?: Partial<Pick<Agent, "status" | "currentTaskId">>) {
        db.update(agents)
          .set({
            lastSeenAt,
            ...(extra?.status ? { status: extra.status } : {}),
            ...(extra && "currentTaskId" in extra ? { currentTaskId: extra.currentTaskId ?? null } : {}),
          })
          .where(eq(agents.id, id))
          .run();
      },
    },

    tasks: {
      getById(id: string): Task | undefined {
        const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
        return row ? mapTask(row) : undefined;
      },
      requireInProject(id: string, projectId: string): Task {
        const task = this.getById(id);
        if (!task || task.projectId !== projectId) {
          throw new AppError(ErrorCodes.TASK_NOT_FOUND, `Task not found: ${id}`, { id, projectId }, 404);
        }
        return task;
      },
      listByProject(projectId: string, limit: number): Task[] {
        return db
          .select()
          .from(tasks)
          .where(eq(tasks.projectId, projectId))
          .orderBy(desc(tasks.updatedAt))
          .limit(limit)
          .all()
          .map(mapTask);
      },
      insert(task: Task): Task {
        db.insert(tasks)
          .values({
            id: task.id,
            projectId: task.projectId,
            title: task.title,
            description: task.description ?? null,
            status: task.status,
            assignedAgentId: task.assignedAgentId ?? null,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          })
          .run();
        return task;
      },
      tryClaim(input: {
        taskId: string;
        projectId: string;
        agentId: string;
        updatedAt: string;
      }): Task | undefined {
        const result = db
          .update(tasks)
          .set({
            assignedAgentId: input.agentId,
            status: "in_progress",
            updatedAt: input.updatedAt,
          })
          .where(
            and(
              eq(tasks.id, input.taskId),
              eq(tasks.projectId, input.projectId),
              isNull(tasks.assignedAgentId),
              eq(tasks.status, "todo"),
            ),
          )
          .run();
        if (result.changes === 0) {
          return undefined;
        }
        return this.getById(input.taskId);
      },
      updateStatus(input: {
        taskId: string;
        status: TaskStatus;
        assignedAgentId?: string | null;
        updatedAt: string;
      }): Task {
        db.update(tasks)
          .set({
            status: input.status,
            updatedAt: input.updatedAt,
            ...(input.assignedAgentId !== undefined
              ? { assignedAgentId: input.assignedAgentId }
              : {}),
          })
          .where(eq(tasks.id, input.taskId))
          .run();
        return this.getById(input.taskId)!;
      },
    },

    events: {
      getById(id: string): ProjectEvent | undefined {
        const row = db.select().from(projectEvents).where(eq(projectEvents.id, id)).get();
        return row ? mapEvent(row) : undefined;
      },
      insert(event: ProjectEvent): ProjectEvent {
        db.insert(projectEvents)
          .values({
            id: event.id,
            projectId: event.projectId,
            type: event.type,
            agentId: event.agentId ?? null,
            taskId: event.taskId ?? null,
            payload: JSON.stringify(event.payload ?? {}),
            correlationId: event.correlationId ?? null,
            idempotencyKey: event.idempotencyKey ?? null,
            createdAt: event.createdAt,
          })
          .run();
        return event;
      },
      findByIdempotency(projectId: string, idempotencyKey: string): ProjectEvent | undefined {
        const row = db
          .select()
          .from(projectEvents)
          .where(
            and(eq(projectEvents.projectId, projectId), eq(projectEvents.idempotencyKey, idempotencyKey)),
          )
          .get();
        return row ? mapEvent(row) : undefined;
      },
      listByProject(projectId: string, limit: number): ProjectEvent[] {
        return db
          .select()
          .from(projectEvents)
          .where(eq(projectEvents.projectId, projectId))
          .orderBy(desc(projectEvents.createdAt))
          .limit(limit)
          .all()
          .map(mapEvent);
      },
      listAfter(projectId: string, afterId: string, limit: number): ProjectEvent[] {
        const after = this.getById(afterId);
        if (!after || after.projectId !== projectId) {
          return db
            .select()
            .from(projectEvents)
            .where(eq(projectEvents.projectId, projectId))
            .orderBy(asc(projectEvents.createdAt))
            .limit(limit)
            .all()
            .map(mapEvent);
        }
        return db
          .select()
          .from(projectEvents)
          .where(and(eq(projectEvents.projectId, projectId), gt(projectEvents.createdAt, after.createdAt)))
          .orderBy(asc(projectEvents.createdAt))
          .limit(limit)
          .all()
          .map(mapEvent);
      },
      listSince(projectId: string, since: string, limit: number): ProjectEvent[] {
        return db
          .select()
          .from(projectEvents)
          .where(and(eq(projectEvents.projectId, projectId), gte(projectEvents.createdAt, since)))
          .orderBy(desc(projectEvents.createdAt))
          .limit(limit)
          .all()
          .map(mapEvent);
      },
      listByTypes(projectId: string, types: EventType[], limit: number): ProjectEvent[] {
        const rows = db
          .select()
          .from(projectEvents)
          .where(eq(projectEvents.projectId, projectId))
          .orderBy(desc(projectEvents.createdAt))
          .limit(80)
          .all()
          .map(mapEvent);
        return rows.filter((event) => types.includes(event.type)).slice(0, limit);
      },
    },

    reports: {
      insert(report: ChangeReport): ChangeReport {
        db.insert(changeReports)
          .values({
            id: report.id,
            projectId: report.projectId,
            taskId: report.taskId ?? null,
            agentId: report.agentId,
            source: report.source,
            summary: report.summary,
            files: JSON.stringify(report.files),
            affectedAreas: JSON.stringify(report.affectedAreas),
            interfacesChanged: JSON.stringify(report.interfacesChanged),
            behaviorChanges: JSON.stringify(report.behaviorChanges),
            breakingChange: report.breakingChange ? "true" : "false",
            tests: JSON.stringify(report.tests),
            nextSteps: JSON.stringify(report.nextSteps),
            commitHash: report.commitHash ?? null,
            createdAt: report.createdAt,
          })
          .run();
        return report;
      },
      getById(id: string): ChangeReport | undefined {
        const row = db.select().from(changeReports).where(eq(changeReports.id, id)).get();
        return row ? mapReport(row) : undefined;
      },
      listByProject(projectId: string, limit: number, since?: string, area?: string): ChangeReport[] {
        const rows = db
          .select()
          .from(changeReports)
          .where(
            since
              ? and(eq(changeReports.projectId, projectId), gte(changeReports.createdAt, since))
              : eq(changeReports.projectId, projectId),
          )
          .orderBy(desc(changeReports.createdAt))
          .limit(limit * 3)
          .all()
          .map(mapReport);

        const filtered = area
          ? rows.filter((report) =>
              report.affectedAreas.some((item) => item.toLowerCase().includes(area.toLowerCase())),
            )
          : rows;
        return filtered.slice(0, limit);
      },
    },

    claims: {
      insert(claim: ResourceClaim): ResourceClaim {
        db.insert(resourceClaims)
          .values({
            id: claim.id,
            projectId: claim.projectId,
            agentId: claim.agentId,
            taskId: claim.taskId ?? null,
            resourceType: claim.resourceType,
            resourcePath: claim.resourcePath,
            status: claim.status,
            createdAt: claim.createdAt,
            releasedAt: claim.releasedAt ?? null,
          })
          .run();
        return claim;
      },
      listActive(projectId: string, limit: number): ResourceClaim[] {
        return db
          .select()
          .from(resourceClaims)
          .where(and(eq(resourceClaims.projectId, projectId), eq(resourceClaims.status, "active")))
          .orderBy(desc(resourceClaims.createdAt))
          .limit(limit)
          .all()
          .map(mapClaim);
      },
      releaseByTask(projectId: string, agentId: string, taskId: string, releasedAt: string): number {
        const result = db
          .update(resourceClaims)
          .set({ status: "released", releasedAt })
          .where(
            and(
              eq(resourceClaims.projectId, projectId),
              eq(resourceClaims.agentId, agentId),
              eq(resourceClaims.taskId, taskId),
              eq(resourceClaims.status, "active"),
            ),
          )
          .run();
        return result.changes;
      },
    },

    handoffs: {
      insert(handoff: Handoff): Handoff {
        db.insert(handoffs)
          .values({
            id: handoff.id,
            projectId: handoff.projectId,
            fromAgentId: handoff.fromAgentId,
            toAgentId: handoff.toAgentId ?? null,
            taskId: handoff.taskId ?? null,
            summary: handoff.summary,
            completedWork: JSON.stringify(handoff.completedWork),
            remainingWork: JSON.stringify(handoff.remainingWork),
            importantFiles: JSON.stringify(handoff.importantFiles),
            knownIssues: JSON.stringify(handoff.knownIssues),
            nextSteps: JSON.stringify(handoff.nextSteps),
            createdAt: handoff.createdAt,
          })
          .run();
        return handoff;
      },
      listByProject(projectId: string, limit: number): Handoff[] {
        return db
          .select()
          .from(handoffs)
          .where(eq(handoffs.projectId, projectId))
          .orderBy(desc(handoffs.createdAt))
          .limit(limit)
          .all()
          .map(mapHandoff);
      },
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
