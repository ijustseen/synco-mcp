import { z } from "zod";
import {
  FILE_ACTIONS,
  MAX_QUERY_LIMIT,
  RESOURCE_TYPES,
  TASK_STATUSES,
  TEST_STATUSES,
} from "../../domain/types.js";

const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalShort = (max: number) => z.string().trim().min(1).max(max).optional();
const stringList = (maxItems: number, maxLen: number) =>
  z.array(z.string().trim().min(1).max(maxLen)).max(maxItems);

export const registerAgentInput = z.object({
  projectId: optionalShort(80),
  agentId: optionalShort(80),
  name: shortText(80),
  platform: shortText(80),
  model: optionalShort(120),
});

export const projectIdInput = z.object({
  projectId: optionalShort(80),
});

export const createTaskInput = z.object({
  projectId: optionalShort(80),
  title: shortText(160),
  description: optionalShort(2000),
  idempotencyKey: optionalShort(120),
});

export const claimTaskInput = z.object({
  projectId: optionalShort(80),
  taskId: shortText(80),
  agentId: shortText(80),
});

export const updateTaskStatusInput = z.object({
  projectId: optionalShort(80),
  taskId: shortText(80),
  agentId: shortText(80),
  status: z.enum(TASK_STATUSES),
});

export const resourceInput = z.object({
  type: z.enum(RESOURCE_TYPES),
  path: shortText(400),
});

export const declareIntentInput = z.object({
  projectId: optionalShort(80),
  agentId: shortText(80),
  taskId: optionalShort(80),
  summary: shortText(400),
  resources: z.array(resourceInput).min(1).max(20),
  idempotencyKey: optionalShort(120),
});

export const reportChangeInput = z.object({
  projectId: optionalShort(80),
  agentId: shortText(80),
  taskId: optionalShort(80),
  summary: shortText(400),
  files: z
    .array(
      z.object({
        path: shortText(400),
        action: z.enum(FILE_ACTIONS),
        description: shortText(300),
      }),
    )
    .min(1)
    .max(30),
  affectedAreas: stringList(12, 80),
  interfacesChanged: z
    .array(
      z.object({
        name: shortText(120),
        description: shortText(300),
      }),
    )
    .max(20),
  behaviorChanges: stringList(12, 300),
  breakingChange: z.boolean(),
  tests: z.object({
    status: z.enum(TEST_STATUSES),
    summary: optionalShort(300),
  }),
  nextSteps: stringList(8, 200),
  commitHash: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{7,40}$/)
    .optional(),
  idempotencyKey: optionalShort(120),
});

export const getRecentChangesInput = z.object({
  projectId: optionalShort(80),
  limit: z.number().int().min(1).max(MAX_QUERY_LIMIT).optional(),
  since: optionalShort(40),
  area: optionalShort(80),
  detail: z.enum(["compact", "full"]).optional(),
});

export const getResourceClaimsInput = z.object({
  projectId: optionalShort(80),
  path: optionalShort(400),
});

export const createHandoffInput = z.object({
  projectId: optionalShort(80),
  fromAgentId: shortText(80),
  toAgentId: optionalShort(80),
  taskId: optionalShort(80),
  summary: shortText(400),
  completedWork: stringList(12, 200),
  remainingWork: stringList(12, 200),
  importantFiles: stringList(20, 400),
  knownIssues: stringList(12, 200),
  nextSteps: stringList(8, 200),
  idempotencyKey: optionalShort(120),
});

export const getAgentContextInput = z.object({
  projectId: optionalShort(80),
  agentId: shortText(80),
});

export const editGuardInput = z.object({
  projectId: optionalShort(80),
  agentId: shortText(80),
  path: optionalShort(400),
});

export const releaseClaimsInput = z.object({
  projectId: optionalShort(80),
  agentId: shortText(80),
  claimIds: z.array(shortText(80)).min(1).max(20).optional(),
  paths: z.array(shortText(400)).min(1).max(20).optional(),
  reason: optionalShort(200),
});

export const addManualLogInput = z.object({
  projectId: shortText(80),
  summary: shortText(400),
  author: optionalShort(80),
});

export const authCredentialsInput = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/, "Username must start with a letter"),
  password: z.string().min(8).max(128),
});

export const createProjectInput = z.object({
  name: shortText(80),
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Project id must be lowercase letters, digits, and hyphens")
    .optional(),
});

export const setActiveProjectInput = z.object({
  projectId: shortText(80),
});
