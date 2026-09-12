export type Agent = {
  id: string;
  name: string;
  platform: string;
  model?: string;
  status: string;
  currentTaskId?: string;
  lastSeenAt: string;
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  status: string;
  assignedAgentId?: string;
  updatedAt: string;
};

export type Claim = {
  id: string;
  agentId: string;
  taskId?: string;
  resourceType: string;
  resourcePath: string;
};

export type Report = {
  id: string;
  agentId: string;
  taskId?: string;
  source: string;
  summary: string;
  files: Array<{ path: string; action: string; description: string }>;
  affectedAreas: string[];
  interfacesChanged: Array<{ name: string; description: string }>;
  breakingChange: boolean;
  tests: { status: string; summary?: string };
  nextSteps: string[];
  createdAt: string;
};

export type FeedEvent = {
  id: string;
  type: string;
  agentId?: string;
  taskId?: string;
  createdAt: string;
  summary: string;
};

export type Handoff = {
  id: string;
  fromAgentId: string;
  toAgentId?: string;
  taskId?: string;
  summary: string;
  remainingWork: string[];
  nextSteps: string[];
  createdAt: string;
};

export type Warning = {
  resourcePath: string;
  agentIds: string[];
  taskIds: string[];
  detectedAt: string;
  status?: "active" | "resolved";
};

export type DashboardState = {
  project: { id: string; name: string; repositoryUrl?: string };
  agents: Agent[];
  tasks: Task[];
  claims: Claim[];
  reports: Report[];
  events: FeedEvent[];
  handoffs: Handoff[];
  warnings: Warning[];
  counts: { agents: number; tasks: number; claims: number; warnings: number };
};

export type ProjectSummary = {
  id: string;
  name: string;
  repositoryUrl?: string;
  eventCount?: number;
};

export type SessionState = {
  user: { id: string; username: string; createdAt: string };
  projects: ProjectSummary[];
  activeProjectId: string | null;
};
