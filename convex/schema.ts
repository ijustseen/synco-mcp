import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const resourceType = v.union(v.literal("file"), v.literal("directory"), v.literal("glob"));
const claimStatus = v.union(v.literal("active"), v.literal("released"));
const agentStatus = v.union(
  v.literal("idle"),
  v.literal("working"),
  v.literal("blocked"),
  v.literal("offline"),
);
const taskStatus = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("done"),
);

export default defineSchema({
  ...authTables,

  projectMembers: defineTable({
    userId: v.id("users"),
    projectId: v.string(),
    role: v.union(v.literal("owner"), v.literal("member")),
    createdAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_project_user", ["projectId", "userId"]),

  userSettings: defineTable({
    userId: v.id("users"),
    deskProjectId: v.string(),
  }).index("by_user", ["userId"]),

  agentKeys: defineTable({
    userId: v.id("users"),
    name: v.string(),
    tokenHash: v.string(),
    prefix: v.string(),
    createdAt: v.string(),
    lastUsedAt: v.optional(v.string()),
    revokedAt: v.optional(v.string()),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_user", ["userId"]),

  projects: defineTable({
    id: v.string(),
    name: v.string(),
    repositoryUrl: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_public_id", ["id"]),

  agents: defineTable({
    id: v.string(),
    projectId: v.string(),
    name: v.string(),
    platform: v.string(),
    model: v.optional(v.string()),
    status: agentStatus,
    currentTaskId: v.optional(v.string()),
    lastSeenAt: v.string(),
    createdAt: v.string(),
  })
    .index("by_public_id", ["id"])
    .index("by_project", ["projectId"]),

  tasks: defineTable({
    id: v.string(),
    projectId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: taskStatus,
    assignedAgentId: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_public_id", ["id"])
    .index("by_project", ["projectId"]),

  changeReports: defineTable({
    id: v.string(),
    projectId: v.string(),
    taskId: v.optional(v.string()),
    agentId: v.string(),
    source: v.literal("agent_declared"),
    summary: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        action: v.union(v.literal("created"), v.literal("modified"), v.literal("deleted")),
        description: v.string(),
      }),
    ),
    affectedAreas: v.array(v.string()),
    interfacesChanged: v.array(
      v.object({
        name: v.string(),
        description: v.string(),
      }),
    ),
    behaviorChanges: v.array(v.string()),
    breakingChange: v.boolean(),
    tests: v.object({
      status: v.union(
        v.literal("not_run"),
        v.literal("passed"),
        v.literal("failed"),
        v.literal("partial"),
      ),
      summary: v.optional(v.string()),
    }),
    nextSteps: v.array(v.string()),
    commitHash: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_public_id", ["id"])
    .index("by_project_created", ["projectId", "createdAt"]),

  events: defineTable({
    id: v.string(),
    projectId: v.string(),
    type: v.string(),
    agentId: v.optional(v.string()),
    taskId: v.optional(v.string()),
    payload: v.any(),
    correlationId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_public_id", ["id"])
    .index("by_project_created", ["projectId", "createdAt"])
    .index("by_project_idempotency", ["projectId", "idempotencyKey"]),

  claims: defineTable({
    id: v.string(),
    projectId: v.string(),
    agentId: v.string(),
    taskId: v.optional(v.string()),
    resourceType: resourceType,
    resourcePath: v.string(),
    status: claimStatus,
    createdAt: v.string(),
    releasedAt: v.optional(v.string()),
  })
    .index("by_public_id", ["id"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_project_agent_status", ["projectId", "agentId", "status"]),

  handoffs: defineTable({
    id: v.string(),
    projectId: v.string(),
    fromAgentId: v.string(),
    toAgentId: v.optional(v.string()),
    taskId: v.optional(v.string()),
    summary: v.string(),
    completedWork: v.array(v.string()),
    remainingWork: v.array(v.string()),
    importantFiles: v.array(v.string()),
    knownIssues: v.array(v.string()),
    nextSteps: v.array(v.string()),
    createdAt: v.string(),
  })
    .index("by_public_id", ["id"])
    .index("by_project_created", ["projectId", "createdAt"]),

  workspaceSettings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});
