import type {
  Agent,
  AgentStatus,
  ChangeReport,
  ClaimStatus,
  EventType,
  Handoff,
  Project,
  ProjectEvent,
  ProjectMember,
  ResourceClaim,
  ResourceType,
  Session,
  Task,
  TaskStatus,
  UserRecord,
} from "../../domain/types.js";
import type {
  agents,
  changeReports,
  handoffs,
  projectEvents,
  projectMembers,
  projects,
  resourceClaims,
  sessions,
  tasks,
  users,
} from "../database/schema.js";

type ProjectRow = typeof projects.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type ReportRow = typeof changeReports.$inferSelect;
type EventRow = typeof projectEvents.$inferSelect;
type ClaimRow = typeof resourceClaims.$inferSelect;
type HandoffRow = typeof handoffs.$inferSelect;
type UserRow = typeof users.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type MemberRow = typeof projectMembers.$inferSelect;

function optional(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

export function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    repositoryUrl: optional(row.repositoryUrl),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    platform: row.platform,
    model: optional(row.model),
    status: row.status as AgentStatus,
    currentTaskId: optional(row.currentTaskId),
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  };
}

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: optional(row.description),
    status: row.status as TaskStatus,
    assignedAgentId: optional(row.assignedAgentId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapReport(row: ReportRow): ChangeReport {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: optional(row.taskId),
    agentId: row.agentId,
    source: "agent_declared",
    summary: row.summary,
    files: JSON.parse(row.files),
    affectedAreas: JSON.parse(row.affectedAreas),
    interfacesChanged: JSON.parse(row.interfacesChanged),
    behaviorChanges: JSON.parse(row.behaviorChanges),
    breakingChange: row.breakingChange === "true",
    tests: JSON.parse(row.tests),
    nextSteps: JSON.parse(row.nextSteps),
    commitHash: optional(row.commitHash),
    createdAt: row.createdAt,
  };
}

export function mapEvent(row: EventRow): ProjectEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as EventType,
    agentId: optional(row.agentId),
    taskId: optional(row.taskId),
    payload: JSON.parse(row.payload),
    correlationId: optional(row.correlationId),
    idempotencyKey: optional(row.idempotencyKey),
    createdAt: row.createdAt,
  };
}

export function mapClaim(row: ClaimRow): ResourceClaim {
  return {
    id: row.id,
    projectId: row.projectId,
    agentId: row.agentId,
    taskId: optional(row.taskId),
    resourceType: row.resourceType as ResourceType,
    resourcePath: row.resourcePath,
    status: row.status as ClaimStatus,
    createdAt: row.createdAt,
    releasedAt: optional(row.releasedAt),
  };
}

export function mapHandoff(row: HandoffRow): Handoff {
  return {
    id: row.id,
    projectId: row.projectId,
    fromAgentId: row.fromAgentId,
    toAgentId: optional(row.toAgentId),
    taskId: optional(row.taskId),
    summary: row.summary,
    completedWork: JSON.parse(row.completedWork),
    remainingWork: JSON.parse(row.remainingWork),
    importantFiles: JSON.parse(row.importantFiles),
    knownIssues: JSON.parse(row.knownIssues),
    nextSteps: JSON.parse(row.nextSteps),
    createdAt: row.createdAt,
  };
}

export function mapUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    createdAt: row.createdAt,
  };
}

export function mapSession(row: SessionRow): Session {
  return {
    token: row.token,
    userId: row.userId,
    activeProjectId: optional(row.activeProjectId),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export function mapMember(row: MemberRow): ProjectMember {
  return {
    projectId: row.projectId,
    userId: row.userId,
    role: "owner",
    createdAt: row.createdAt,
  };
}
