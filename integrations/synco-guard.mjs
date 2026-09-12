// Shared edit-guard logic for every host adapter.
//
// The policy lives on the synco server, not here: this asks
// GET /api/guard/edit whether the agent declared intent covering the path.
// Adapters only translate their host's payload and refusal format.
//
// Everything fails open. A missing config, an unreachable server, or an
// unexpected payload allows the edit — a coordination tool must never be able
// to make a repository uneditable.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const PROJECT_FILE = ".synco.json";
const HOST_FILE = "synco-host.json";
const WRITE_TOOLS =
  /^(write|str_?replace|multi_?edit|edit|edit_?file|create_?file|search_?replace|apply_?patch|patch|delete|remove|edit_?notebook)$/i;
const PATH_KEYS = [
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "path",
  "absolute_path",
  "absolutePath",
  "file",
  "filename",
];
const NESTED_KEYS = ["tool_input", "toolInput", "args", "arguments", "input", "parameters", "params"];
const ROOT_KEYS = [
  "workspace_root",
  "workspaceRoot",
  "workspace_roots",
  "workspaceRoots",
  "project_dir",
  "projectDir",
  "directory",
  "worktree",
  "cwd",
];

// A repo opts in by committing .synco.json. Without it the guard stays silent,
// so a user-level hook installed once does not nag in unrelated projects.
export function findProject(startDir) {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 30; depth += 1) {
    const candidate = join(dir, PROJECT_FILE);
    if (existsSync(candidate)) {
      try {
        return { root: dir, config: JSON.parse(readFileSync(candidate, "utf8")) };
      } catch {
        return { root: dir, config: {} };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
  return undefined;
}

function hostConfig(adapterDir) {
  try {
    const file = join(adapterDir, HOST_FILE);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  } catch {
    return {};
  }
}

// A user-level hook runs from the host's own config directory, not from the
// project, so cwd is the least reliable clue. The edited file's own path is the
// most reliable one.
export function projectSearchStarts(payload, cwd, editedPath) {
  const starts = [];
  if (editedPath && isAbsolute(editedPath)) {
    starts.push(dirname(editedPath));
  }
  for (const key of ROOT_KEYS) {
    const value = payload?.[key];
    if (typeof value === "string" && value.length > 0) {
      starts.push(value);
    } else if (Array.isArray(value) && typeof value[0] === "string") {
      starts.push(value[0]);
    }
  }
  if (cwd) {
    starts.push(cwd);
  }
  return starts;
}

export function resolveConfig({ cwd, adapterDir, env = {}, payload, editedPath }) {
  let project;
  for (const start of projectSearchStarts(payload, cwd, editedPath)) {
    project = findProject(start);
    if (project) {
      break;
    }
  }
  if (!project) {
    return undefined;
  }
  const host = adapterDir ? hostConfig(adapterDir) : {};
  const agentId = env.SYNCO_AGENT_ID ?? host.agentId ?? project.config.agentId;
  if (!agentId) {
    return undefined;
  }
  return {
    root: project.root,
    url: (env.SYNCO_URL ?? host.url ?? project.config.url ?? "http://127.0.0.1:3847").replace(/\/$/, ""),
    projectId: env.SYNCO_PROJECT_ID ?? host.projectId ?? project.config.projectId,
    apiKey: env.SYNCO_API_KEY ?? host.apiKey ?? project.config.apiKey,
    agentId,
  };
}

export function isWriteTool(name) {
  if (typeof name !== "string" || name.length === 0) {
    return false;
  }
  const bare = name.split(/[.:\s/]/).pop() ?? name;
  return WRITE_TOOLS.test(bare);
}

export function extractPath(payload) {
  const scopes = [payload];
  for (const key of NESTED_KEYS) {
    const nested = payload?.[key];
    if (nested && typeof nested === "object") {
      scopes.push(nested);
    }
  }
  for (const scope of scopes) {
    for (const key of PATH_KEYS) {
      const value = scope?.[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

// Claims are stored repo-relative; hosts hand us absolute paths.
export function toRepoPath(filePath, root) {
  if (!filePath) {
    return undefined;
  }
  const rel = isAbsolute(filePath) ? relative(root, filePath) : filePath;
  return rel.startsWith("..") ? undefined : rel.split("\\").join("/");
}

export async function checkEdit({ payload, cwd, adapterDir, env = {}, host }) {
  if (host && !looksLikeHost(host, payload, env)) {
    return { allowed: true, reason: "wrong-host" };
  }

  const toolName = payload?.tool_name ?? payload?.toolName ?? payload?.tool ?? payload?.name;
  if (!isWriteTool(typeof toolName === "object" ? toolName?.name : toolName)) {
    return { allowed: true, reason: "not-a-write-tool" };
  }

  const editedPath = extractPath(payload);
  const config = resolveConfig({ cwd, adapterDir, env, payload, editedPath });
  if (!config) {
    return { allowed: true, reason: "not-a-synco-project" };
  }

  const path = toRepoPath(editedPath, config.root);
  const query = new URLSearchParams({ agentId: config.agentId });
  if (config.projectId) {
    query.set("projectId", config.projectId);
  }
  if (path) {
    query.set("path", path);
  }

  try {
    const response = await fetch(`${config.url}/api/guard/edit?${query.toString()}`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(Number(env.SYNCO_GUARD_TIMEOUT_MS ?? 2000)),
    });
    if (!response.ok) {
      return { allowed: true, reason: `server-${response.status}` };
    }
    const body = await response.json();
    return {
      allowed: body.allowed !== false,
      reason: body.code,
      message: body.message,
      overlappingAgentIds: body.overlappingAgentIds ?? [],
      agentId: config.agentId,
      configPath: adapterDir ? join(adapterDir, HOST_FILE) : undefined,
      path,
    };
  } catch {
    return { allowed: true, reason: "server-unreachable" };
  }
}

export function readStdin() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function denialMessage(result) {
  const overlap =
    result.overlappingAgentIds?.length > 0
      ? ` Another agent also claims this path: ${result.overlappingAgentIds.join(", ")}.`
      : "";
  // An unregistered id is nearly always a config mistake, so name the file that
  // chose it instead of leaving the agent guessing.
  const source =
    result.reason === "NOT_REGISTERED" && result.configPath
      ? ` The id "${result.agentId}" comes from ${result.configPath} — either register under it or correct that file.`
      : "";
  return `synco-mcp blocked this edit. ${result.message ?? "Declare your change intent first."}${overlap}${source}`;
}

// Several host configs can live on one machine, and hosts read each other's
// files: Cursor executes hooks declared in ~/.claude/settings.json. An adapter
// that fires inside the wrong host would judge the edit under the wrong agentId,
// so each one checks for its own host and stays silent otherwise.
export function looksLikeHost(host, payload, env = {}) {
  if (env.SYNCO_HOOK_FORCE_HOST === host) {
    return true;
  }
  if (host === "claude-code") {
    return Boolean(
      env.CLAUDE_PROJECT_DIR ||
        env.CLAUDECODE ||
        env.CLAUDE_CODE_ENTRYPOINT ||
        payload?.transcript_path ||
        payload?.hook_event_name,
    );
  }
  return true;
}
