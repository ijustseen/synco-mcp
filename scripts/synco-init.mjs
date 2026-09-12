#!/usr/bin/env node
// synco init — wires the edit guard into every agent host installed on this
// machine, at the user level, so it covers all repositories at once.
//
// A repository opts in by having .synco.json. Without that file the guard stays
// silent, so installing globally does not disturb unrelated projects.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SOURCE = join(REPO, "integrations");
const HOME = homedir();

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DRY = flag("dry-run");
const URL_ = value("url", "http://127.0.0.1:3847");
const PROJECT_ID = value("project", undefined);
const API_KEY = value("api-key", process.env.SYNCO_API_KEY);
// Every host needs its own id, so this only overrides the per-host default.
const AGENT_ID = value("agent-id", undefined);
const PROJECT_DIR = resolve(value("dir", process.cwd()));
const ONLY = args.filter((arg) => ["cursor", "claude", "opencode"].includes(arg));

const log = [];
function note(action, target) {
  log.push({ action, target });
}

function write(file, contents) {
  if (DRY) {
    note("would write", file);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  note("wrote", file);
}

function readJson(file, fallback) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
  } catch {
    console.warn(`! ${file} is not valid JSON. Leaving it alone.`);
    return undefined;
  }
}

// A re-run must not silently reset an agentId someone customised — several
// agents share this machine and any of them may run the installer.
function mergeHostConfig(targetDir, defaults) {
  const existing = readJson(join(targetDir, "synco-host.json"), {}) ?? {};
  return {
    url: URL_,
    ...(PROJECT_ID ? { projectId: PROJECT_ID } : {}),
    ...defaults,
    ...existing,
    ...(AGENT_ID ? { agentId: AGENT_ID } : {}),
    ...(API_KEY ? { apiKey: API_KEY } : {}),
  };
}

function copyRuntime(targetDir, files, hostConfig) {
  if (DRY) {
    note("would copy", `${files.join(", ")} -> ${targetDir}`);
  } else {
    mkdirSync(targetDir, { recursive: true });
    for (const file of files) {
      copyFileSync(join(SOURCE, file), join(targetDir, file));
    }
    note("copied", `${files.join(", ")} -> ${targetDir}`);
  }
  write(
    join(targetDir, "synco-host.json"),
    `${JSON.stringify(mergeHostConfig(targetDir, hostConfig), null, 2)}\n`,
  );
}

// --- project opt-in -------------------------------------------------------

function installProjectMarker() {
  const file = join(PROJECT_DIR, ".synco.json");
  if (existsSync(file)) {
    note("kept", `${file} (already present)`);
    return;
  }
  write(file, `${JSON.stringify({ url: URL_, ...(PROJECT_ID ? { projectId: PROJECT_ID } : {}) }, null, 2)}\n`);
}

// --- Cursor ---------------------------------------------------------------

function installCursor() {
  const dir = join(HOME, ".cursor");
  if (!existsSync(dir)) {
    note("skipped", "Cursor (~/.cursor not found)");
    return;
  }
  const runtime = join(dir, "hooks", "synco");
  copyRuntime(runtime, ["synco-guard.mjs", "cursor-hook.mjs"], { agentId: "cursor" });

  const file = join(dir, "hooks.json");
  const current = readJson(file, { version: 1, hooks: {} });
  if (!current) {
    return;
  }
  current.version ??= 1;
  current.hooks ??= {};
  const command = "./hooks/synco/cursor-hook.mjs";
  const existing = current.hooks.preToolUse ?? [];
  if (existing.some((hook) => hook.command === command)) {
    note("kept", `${file} (guard already wired)`);
  } else {
    // Preserve every unrelated hook the user already has.
    current.hooks.preToolUse = [...existing, { command, timeout: 10 }];
    write(file, `${JSON.stringify(current, null, 2)}\n`);
  }
}

// --- Claude Code ----------------------------------------------------------

function installClaudeCode() {
  const dir = join(HOME, ".claude");
  if (!existsSync(dir)) {
    note("skipped", "Claude Code (~/.claude not found)");
    return;
  }
  const runtime = join(dir, "hooks", "synco");
  copyRuntime(runtime, ["synco-guard.mjs", "claude-code-hook.mjs"], { agentId: "claude-code" });

  const file = join(dir, "settings.json");
  const current = readJson(file, {});
  if (!current) {
    return;
  }
  current.hooks ??= {};
  const command = `${join(runtime, "claude-code-hook.mjs")}`;
  const groups = current.hooks.PreToolUse ?? [];
  const wired = groups.some((group) =>
    (group.hooks ?? []).some((hook) => typeof hook.command === "string" && hook.command.includes("synco")),
  );
  if (wired) {
    note("kept", `${file} (guard already wired)`);
    return;
  }
  current.hooks.PreToolUse = [
    ...groups,
    {
      matcher: "Write|Edit|MultiEdit|NotebookEdit",
      hooks: [{ type: "command", command }],
    },
  ];
  write(file, `${JSON.stringify(current, null, 2)}\n`);
}

// --- opencode -------------------------------------------------------------

function installOpencode() {
  const dir = join(HOME, ".config", "opencode");
  if (!existsSync(dir)) {
    note("skipped", "opencode (~/.config/opencode not found)");
    return;
  }
  // The shared module lives one level down so opencode does not try to load it
  // as a plugin of its own.
  copyRuntime(join(dir, "plugins", "synco"), ["synco-guard.mjs"], { agentId: "opencode" });
  if (DRY) {
    note("would copy", "opencode-plugin.mjs -> plugins/synco-guard-plugin.mjs");
  } else {
    copyFileSync(join(SOURCE, "opencode-plugin.mjs"), join(dir, "plugins", "synco-guard-plugin.mjs"));
    note("copied", join(dir, "plugins", "synco-guard-plugin.mjs"));
  }
}

// --- run ------------------------------------------------------------------

if (flag("help")) {
  console.log(`synco init — install the edit guard for every detected agent host

Usage: synco init [hosts...] [options]

Hosts:      cursor, claude, opencode      (default: every host found)

Options:
  --dir=<path>        Project to mark as synco-enabled (default: cwd)
  --url=<url>         synco server URL (default: http://127.0.0.1:3847)
  --project=<id>      optional; omit it — the dashboard picker is the project
  --agent-id=<id>     Override the agentId for every installed host
  --api-key=<key>     API key for a shared/remote server
  --dry-run           Print what would change and touch nothing
  --help
`);
  process.exit(0);
}

installProjectMarker();
if (ONLY.length === 0 || ONLY.includes("cursor")) installCursor();
if (ONLY.length === 0 || ONLY.includes("claude")) installClaudeCode();
if (ONLY.length === 0 || ONLY.includes("opencode")) installOpencode();

console.log(DRY ? "synco init — dry run\n" : "synco init\n");
for (const entry of log) {
  console.log(`  ${entry.action.padEnd(12)} ${entry.target}`);
}
console.log(`
Each host got its own agentId (cursor, claude-code, opencode). Edit
synco-host.json in the host's hooks/synco directory to change it.

The guard only acts in repositories containing .synco.json, and it fails open if
the server is unreachable. Restart the host to load the new configuration.`);
