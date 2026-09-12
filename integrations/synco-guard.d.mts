// Types for the host adapters. The runtime files stay plain .mjs so any host can
// execute them with bare node, without a build step.
export type GuardConfig = {
  root: string;
  url: string;
  projectId: string;
  apiKey?: string;
  agentId: string;
};

export type GuardResult = {
  allowed: boolean;
  reason?: string;
  message?: string;
  overlappingAgentIds?: string[];
  agentId?: string;
  path?: string;
};

export type CheckEditArgs = {
  payload: Record<string, unknown>;
  cwd: string;
  adapterDir?: string;
  env?: Record<string, string | undefined>;
  host?: string;
};

export function findProject(startDir: string): { root: string; config: Record<string, unknown> } | undefined;
export function projectSearchStarts(
  payload: Record<string, unknown> | undefined,
  cwd: string | undefined,
  editedPath: string | undefined,
): string[];
export function resolveConfig(
  args: Partial<CheckEditArgs> & { editedPath?: string },
): GuardConfig | undefined;
export function isWriteTool(name: unknown): boolean;
export function extractPath(payload: Record<string, unknown>): string | undefined;
export function toRepoPath(filePath: string | undefined, root: string): string | undefined;
export function checkEdit(args: CheckEditArgs): Promise<GuardResult>;
export function readStdin(): Record<string, unknown>;
export function denialMessage(result: GuardResult): string;
