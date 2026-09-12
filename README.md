# synco-mcp

Self-hosted coordination server for multiple AI coding agents working on the same software project.

Agents register, claim tasks, declare file intents, publish structured ChangeReports, and hand off context. A local dashboard shows the same state in near real time.

Git remains the source of truth for source code. synco-mcp stores coordination metadata only. A ChangeReport is **agent-declared**, not a verified Git diff.

## Quick start

```bash
npm install
npm --prefix dashboard install
npm run dashboard:build
npm start
```

Then open [http://127.0.0.1:3847/](http://127.0.0.1:3847/) and connect an MCP client to `/mcp`. The dashboard starts empty until a real agent registers.

Optional env: copy `.env.example` and export the values before `npm start`.

```bash
cp .env.example .env
```

`tsx` does not auto-load `.env`. Export variables in the shell or use your process manager.

## What you get

| Endpoint | Role |
| --- | --- |
| `http://127.0.0.1:3847/` | Dashboard (login + project picker) |
| `POST /mcp` | MCP Streamable HTTP |
| `GET /api/auth/status` | Whether any user exists yet |
| `POST /api/auth/register` · `POST /api/auth/login` | Dashboard username/password |
| `GET /api/auth/me` · `PUT /api/auth/active-project` | Session + current project |
| `GET /api/projects` · `POST /api/projects` | List / create your projects |
| `GET /api/projects/:projectId` | Dashboard snapshot |
| `GET /api/projects/:projectId/events` | SSE live feed |
| `GET /api/guard/edit` | Edit guard for host hooks: may this agent write this path? |
| `GET /health` | Liveness |

Default bind: `127.0.0.1:3847`. A blank database seeds one leftover project named `default` so tests and first boot have somewhere to write; it is not the live desk.

stdio mode does **not** serve the page. For several agents on one project use HTTP. stdio is only for clients that must spawn a local process:

```bash
npm run stdio
```

Point both HTTP and stdio at the same `SYNCO_DATABASE_PATH` if you mix them. Prefer one HTTP process for a multi-agent demo.

## Architecture

```text
MCP tool / dashboard API
        ↓
application services
        ↓
repositories + event store
        ↓
SQLite (WAL)

persist event → in-process EventBus → dashboard SSE
```

- **MCP** is how agents talk to the system.
- **SQLite** is the source of truth for coordination state.
- **Git** is the source of truth for code. synco-mcp never claims a file changed just because an agent said so.
- **SSE** is for the dashboard. Agents should poll `get_project_state` / `get_recent_changes`. Hosts do not reliably push MCP notifications into a running model.

Hosted mode lives in `convex/`: same MCP tools and guard, Convex tables instead of SQLite. Local Express + SQLite in `src/` stays the self-host path. See [convex/README.md](convex/README.md).

## MCP tools

| Tool | Purpose |
| --- | --- |
| `register_agent` | Register and get a compact snapshot |
| `get_project_state` | Compact agents, tasks, claims, reports, warnings |
| `create_task` | Create a todo |
| `claim_task` | Transactional reserve; structured refusal if taken |
| `update_task_status` | `todo` / `in_progress` / `blocked` / `done` (done releases claims) |
| `declare_change_intent` | Resource claims + overlap warnings (not a Git lock) |
| `report_change` | Structured ChangeReport (`source: agent_declared`) |
| `get_recent_changes` | Compact by default; `detail: "full"` for the raw report |
| `get_resource_claims` | Active claims |
| `release_claims` | Drop your own claims. Needed when you claimed without a task |
| `create_handoff` | Structured context for the next agent |
| `get_agent_context` | Task, claims, reports, handoffs, warnings — not the full log |

Mutating tools accept optional `idempotencyKey`. The same key does not create a duplicate event.

## MCP client config

**HTTP is the product transport** (one server, many agents).

Cursor IDE (URL-based):

```json
{
  "mcpServers": {
    "synco-mcp": {
      "url": "http://127.0.0.1:3847/mcp"
    }
  }
}
```

Cursor CLI and Claude Code — use `"type": "http"`, not `"streamable-http"` (Cursor CLI currently drops the whole config on that alias):

```json
{
  "mcpServers": {
    "synco-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:3847/mcp"
    }
  }
}
```

stdio example is in `examples/mcp.stdio.json`. Run it from the repo root so `tsx src/stdio.ts` resolves.

If `SYNCO_API_KEY` is set, send `Authorization: Bearer <key>` on `/mcp`. Dashboard auth is a separate cookie session (see below).

## Make agents actually use synco-mcp

Connecting the MCP server only **exposes** the tools. Models treat `AGENT_INSTRUCTIONS.md` and the server `instructions` string as optional docs. After a long chat or a context summary they skip `register_agent` / `report_change` unless the **host** injects the protocol into every turn.

You cannot 100% force an LLM to call a tool. The stack below is what actually works, strongest last. Do all three.

The agent-facing protocol itself lives in [`AGENT_INSTRUCTIONS.md`](./AGENT_INSTRUCTIONS.md). This section is the **host** checklist.

### What “before and after every request” means

| Moment | Required calls | Skip when |
| --- | --- | --- |
| First tool calls in a session | `register_agent` once, then `get_agent_context` | Never skip on a new chat / after compaction |
| Start of every later turn | `get_agent_context` (poll `get_project_state` / `get_recent_changes` if taking new work) | Never skip if synco-mcp tools are available |
| Before any file edit | `declare_change_intent` with every path | Read-only turns |
| After a work unit that touched files | `report_change` in the **same** turn | Pure Q&A — do not invent a ChangeReport |
| End of a claimed task | `update_task_status(done)` or `blocked` + `create_handoff` | No owned task |

Give each host a **stable unique `agentId`** (`cursor-grok`, `claude-code`, `opencode`, …). Do not reuse another agent's id. **`projectId` is the dashboard picker.** Agents may omit it; the server uses the desk selection. `default` is only a leftover bootstrap id on a blank database, not a special project.

### 0. One command, every host, every repo

```bash
npm run init            # or: npx synco-mcp init
```

`npx synco-mcp init` installs the **edit guard** into every agent host it finds on the machine, at
the user level, so it covers all your repositories at once:

| Host | What it writes | Blocking mechanism |
| --- | --- | --- |
| Cursor | `~/.cursor/hooks.json` + `~/.cursor/hooks/synco/` | `preToolUse` returns `permission: deny` |
| Claude Code | `~/.claude/settings.json` + `~/.claude/hooks/synco/` | `PreToolUse` exits 2, stderr goes back to the model |
| opencode | `~/.config/opencode/plugins/` | plugin `tool.execute.before` throws |

Useful flags: `--dry-run`, `--agent-id=cursor-andrew`, `--url=https://synco.example.com`,
`--api-key=…`, `--project=<id>`, or a host name (`npx synco-mcp init cursor`) to limit the scope.
Existing hooks in those files are preserved, and re-running is a no-op.

**A repo opts in with `.synco.json`** at its root (`npx synco-mcp init` writes one in the current
project):

```json
{ "url": "http://127.0.0.1:3847" }
```

Without that file the guard stays completely silent, so a global install does not interfere
with unrelated repositories. Per-host identity lives in `synco-host.json` next to the
adapter — that is where each host gets its own `agentId`.

### How the guard decides

The policy lives on the server, not in the hook. Before a file write the adapter asks
`GET /api/guard/edit?projectId=…&agentId=…&path=…`, and the server answers whether that
agent holds an active claim covering that exact path:

| Answer | Meaning |
| --- | --- |
| `NOT_REGISTERED` | Call `register_agent` first |
| `NO_INTENT` | No active claim at all — call `declare_change_intent` |
| `PATH_NOT_DECLARED` | Claims exist but not for this file; the message lists what was declared |
| `OK` | Allowed, plus `overlappingAgentIds` if someone else claims the same path |

This is why it is host-agnostic: adding a host means writing a ~20-line adapter that
translates one payload shape and one refusal format. It is also why the check survives
opencode never firing `tool.execute.before` for MCP calls — nothing local has to observe
the `declare_change_intent` call.

The adapters **fail open** on every unknown: no `.synco.json`, no `agentId`, an unreachable
server, a non-write tool, or a malformed payload all allow the edit. A coordination tool
must not be able to make a repository uneditable. Note that shell commands are not gated —
an agent that runs `sed -i` bypasses the guard.

### 1. Project files that every host reads

Put the copy-paste block from `AGENT_INSTRUCTIONS.md` into files the agent host loads automatically. A file the agent must `Read` on its own is not enough.

| Host | File | Notes |
| --- | --- | --- |
| Cursor | `.cursor/rules/synco-mcp.mdc` with `alwaysApply: true` | Injected into every conversation in this repo |
| Cursor, Claude Code, Codex, many others | `AGENTS.md` at the repo root | Same block; keep `agentId` as a placeholder or per-clone value |
| Claude Code | `CLAUDE.md` | Paste the same block if you do not rely on `AGENTS.md` |

This repo ships `.cursor/rules/synco-mcp.mdc` already. Its shape:

```markdown
---
description: Mandatory synco-mcp protocol before and after every turn
alwaysApply: true
---

# synco-mcp is mandatory

If synco-mcp tools are available, you MUST use them. Documentation is not optional.

The project is the dashboard picker. Omit `projectId`. Agent id: `<AGENT_ID>`.

First tool calls in a session: `register_agent` then `get_agent_context`.
Start of every later turn: `get_agent_context` before other work.
Before any file edit: `declare_change_intent` with every path you will touch.
After file edits in this turn: `report_change` before the final user-facing reply.
No file edits: do not invent a ChangeReport.

Git is the source of truth. ChangeReports are agent-declared, not verified diffs.
Claims warn; they do not lock. Poll — hosts do not push events into you.
```

The shipped rule tells each host to derive a stable `agentId` from its own name instead of
carrying a `<AGENT_ID>` placeholder that an agent would paste literally. `AGENTS.md` at the
root covers hosts that do not read `.cursor/rules`.

### 2. User rule in the editor (survives chat summaries)

Project rules still get dropped under context pressure. A **user-level** rule is what makes one developer's agent keep the protocol after Cursor compact/summarize.

**Cursor:** Settings → Rules → add a user rule. Scope it so it only fires when synco-mcp tools exist (otherwise it will nag in unrelated repos):

```text
When synco-mcp / user-synco-mcp tools are available, the protocol is mandatory.

First tools this session: register_agent (once) then get_agent_context.
Every later user message: get_agent_context before any other work.
Before Write/StrReplace/edit: declare_change_intent.
If you edited files this turn: report_change before the final answer.
If you only answered a question: do not fake a ChangeReport.

Stable agentId for this host. Do not skip because the turn looks small.
```

Do this on every machine / every developer profile that talks to the shared server.

### 3. Hooks — the only layer that interrupts the agent

Rules can still be ignored. Hooks run outside the model.

The blocking guard comes from `npx synco-mcp init` (section 0) because it needs a per-developer
`agentId`. On top of it, this repo ships `.cursor/hooks.json` with three prompt hooks that
nudge the protocol at session, turn and stop boundaries:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "prompt",
        "prompt": "synco-mcp is connected. Your first tools this session must be register_agent then get_agent_context. Do not answer the user before those calls."
      }
    ],
    "beforeSubmitPrompt": [
      {
        "type": "prompt",
        "prompt": "Remind the agent: call get_agent_context before other work. If this turn will edit files, declare_change_intent first. If this turn edited files, report_change before the final reply."
      }
    ],
    "stop": [
      {
        "type": "prompt",
        "prompt": "If this turn created or edited files and the agent did not call report_change, send a follow-up that it must call report_change now. If it only answered a question, do nothing.",
        "loop_limit": 1
      }
    ]
  }
}
```

Check Cursor → Hooks after pulling; restart Cursor if they do not load.

### 4. What reaches hosts with no hook system at all

Windsurf, Cline, Copilot and friends have rules but no interception point. For them the
server does the talking, and it needs no local setup:

- The MCP `instructions` string states the protocol as mandatory at connect time.
- `register_agent`, `get_agent_context`, `declare_change_intent` and `report_change` all
  return a `protocol` object with `nextRequiredCall`, plus `openItems` naming actual
  lapses — for example an `in_progress` task with declared intent and no ChangeReport, or
  claims held with no open task.

That is advisory, not enforcement, but it lands inside the model's context on every call
and cannot be skipped by a developer forgetting to configure something.

### Checklist

A new developer on a shared project is not done after `npm start` and pasting the MCP URL. They need:

1. HTTP MCP client pointed at `http://127.0.0.1:3847/mcp` (see above).
2. `npm run init` once per machine, with `--agent-id=` if they want a personal id.
3. `.synco.json` in every repo that should be guarded.
4. User rule on their own Cursor (or other host) profile.
5. Confirmation on the dashboard: after the first real prompt, an `agent_registered` event and later `intent_declared` / `change_reported` — not only chat replies.

If the dashboard stays empty, the agent is not using MCP. Fix the host, not the server.

## Dashboard login and projects

The desk is no longer an open single-project page.

1. Open `/`. If nobody has registered yet, create the first account.
2. The first user on a blank install inherits an unowned leftover project if one exists (historically named `default`). That id is not special.
3. Later users start with no projects — they create one from the desk. They never see someone else's leftover.
4. The header select is the **active project**. Snapshot, live events, and Add log follow that project.
5. `+ Project` creates another project and switches to it.

Username: 3–32 characters, starts with a letter. Password: at least 8 characters. Session cookie: `synco_session` (httpOnly, 30 days).

Agents do **not** log in. The project they write to is the one selected in the dashboard picker. `projectId` on MCP tools is optional and ignored when a desk selection exists.

## Security

- Without `SYNCO_API_KEY` the server **refuses** to bind anything except loopback.
- Dashboard `/api/*` (except register/login/status) requires a signed-in user who is a member of that project.
- `/mcp` still uses the optional shared `SYNCO_API_KEY`, not the dashboard password.
- Do not expose `/mcp` or `/api` to the internet without a key.
- Secrets and tokens are not logged.
- This is username/password on a self-hosted box, not OAuth or per-agent ACLs.

## Tests

```bash
npm test
```

Coverage includes transactional task claims, idempotent task creation, resource overlap, declared ChangeReports, handoffs, SSE fan-out, and MCP Streamable HTTP tool calls.

## Limitations (MVP)

- ChangeReports are declared by agents. There is no Git verification.
- Resource claims warn; they do not lock files or prevent merge conflicts.
- Dashboard live updates do not imply that an LLM host will interrupt a running agent.
- One Node process, in-memory EventBus. Not multi-instance.
- No OAuth, RAG, vector DB, or agent orchestration engine.
- Dashboard users only see projects they own. `default` is not shared and is not the live desk unless someone actually selects it.
- Agent ids are global. Registering again on a new desk selection moves the agent to that project.
- An agent is marked `offline` after `SYNCO_AGENT_OFFLINE_MS` (default 5 min) without a tool call. It is inferred from `lastSeenAt`, not a real heartbeat.

## Stack

Node.js 20+, TypeScript, `@modelcontextprotocol/sdk` **v1.x** (currently installed from npm), Zod, Express, better-sqlite3, Drizzle ORM, Vite, React, Tailwind CSS, Vitest.

v1 is a compatibility choice for current Cursor / Claude Code hosts. The official SDK main branch is v2; this repo can migrate later.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | HTTP + MCP + dashboard |
| `npm run dev` | HTTP with reload |
| `npm run dashboard:dev` | Vite on :5173, proxies API to :3847 |
| `npm run stdio` | MCP over stdio |
| `npm test` | Vitest |
