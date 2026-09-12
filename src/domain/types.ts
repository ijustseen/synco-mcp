export const AGENT_STATUSES = ["idle", "working", "blocked", "offline"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RESOURCE_TYPES = ["file", "directory", "glob"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const CLAIM_STATUSES = ["active", "released"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const FILE_ACTIONS = ["created", "modified", "deleted"] as const;
export type FileAction = (typeof FILE_ACTIONS)[number];

export const TEST_STATUSES = ["not_run", "passed", "failed", "partial"] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export const EVENT_TYPES = [
  "agent_registered",
  "task_created",
  "task_claimed",
  "task_started",
  "intent_declared",
  "change_reported",
  "task_completed",
  "handoff_created",
  "conflict_detected",
  "agent_status_changed",
  "manual_log",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type ReportSource = "agent_declared";

export type Project = {
  id: string;
  name: string;
  repositoryUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type Agent = {
  id: string;
  projectId: string;
  name: string;
  platform: string;
  model?: string;
  status: AgentStatus;
  currentTaskId?: string;
  lastSeenAt: string;
  createdAt: string;
};

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignedAgentId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ChangeFile = {
  path: string;
  action: FileAction;
  description: string;
};

export type InterfaceChange = {
  name: string;
  description: string;
};

export type ChangeTests = {
  status: TestStatus;
  summary?: string;
};

export type ChangeReport = {
  id: string;
  projectId: string;
  taskId?: string;
  agentId: string;
  source: ReportSource;
  summary: string;
  files: ChangeFile[];
  affectedAreas: string[];
  interfacesChanged: InterfaceChange[];
  behaviorChanges: string[];
  breakingChange: boolean;
  tests: ChangeTests;
  nextSteps: string[];
  commitHash?: string;
  createdAt: string;
};

export type ProjectEvent = {
  id: string;
  projectId: string;
  type: EventType;
  agentId?: string;
  taskId?: string;
  payload: unknown;
  correlationId?: string;
  idempotencyKey?: string;
  createdAt: string;
};

export type ResourceClaim = {
  id: string;
  projectId: string;
  agentId: string;
  taskId?: string;
  resourceType: ResourceType;
  resourcePath: string;
  status: ClaimStatus;
  createdAt: string;
  releasedAt?: string;
};

export type Handoff = {
  id: string;
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
  createdAt: string;
};

export type ConflictWarning = {
  resourcePath: string;
  agentIds: string[];
  taskIds: string[];
  claimIds: string[];
  detectedAt: string;
  status: "active" | "resolved";
};

export type ProjectLimits = {
  agents: number;
  tasks: number;
  claims: number;
  events: number;
  reports: number;
  handoffs: number;
};

export const DEFAULT_LIMITS: ProjectLimits = {
  agents: 20,
  tasks: 20,
  claims: 20,
  events: 15,
  reports: 5,
  handoffs: 10,
};

export const MAX_QUERY_LIMIT = 20;
