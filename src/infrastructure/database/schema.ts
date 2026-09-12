import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  repositoryUrl: text("repository_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    model: text("model"),
    status: text("status").notNull(),
    currentTaskId: text("current_task_id"),
    lastSeenAt: text("last_seen_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("agents_project_idx").on(table.projectId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull(),
    assignedAgentId: text("assigned_agent_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("tasks_project_status_idx").on(table.projectId, table.status)],
);

export const changeReports = sqliteTable(
  "change_reports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    taskId: text("task_id"),
    agentId: text("agent_id").notNull(),
    source: text("source").notNull(),
    summary: text("summary").notNull(),
    files: text("files").notNull(),
    affectedAreas: text("affected_areas").notNull(),
    interfacesChanged: text("interfaces_changed").notNull(),
    behaviorChanges: text("behavior_changes").notNull(),
    breakingChange: text("breaking_change").notNull(),
    tests: text("tests").notNull(),
    nextSteps: text("next_steps").notNull(),
    commitHash: text("commit_hash"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("reports_project_created_idx").on(table.projectId, table.createdAt)],
);

export const projectEvents = sqliteTable(
  "project_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    type: text("type").notNull(),
    agentId: text("agent_id"),
    taskId: text("task_id"),
    payload: text("payload").notNull(),
    correlationId: text("correlation_id"),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("events_project_created_idx").on(table.projectId, table.createdAt),
    uniqueIndex("events_project_idempotency_idx").on(table.projectId, table.idempotencyKey),
  ],
);

export const resourceClaims = sqliteTable(
  "resource_claims",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    agentId: text("agent_id").notNull(),
    taskId: text("task_id"),
    resourceType: text("resource_type").notNull(),
    resourcePath: text("resource_path").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    releasedAt: text("released_at"),
  },
  (table) => [index("claims_project_status_idx").on(table.projectId, table.status)],
);

export const handoffs = sqliteTable(
  "handoffs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    fromAgentId: text("from_agent_id").notNull(),
    toAgentId: text("to_agent_id"),
    taskId: text("task_id"),
    summary: text("summary").notNull(),
    completedWork: text("completed_work").notNull(),
    remainingWork: text("remaining_work").notNull(),
    importantFiles: text("important_files").notNull(),
    knownIssues: text("known_issues").notNull(),
    nextSteps: text("next_steps").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("handoffs_project_created_idx").on(table.projectId, table.createdAt)],
);
