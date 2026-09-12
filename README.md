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
| `http://127.0.0.1:3847/` | Dashboard |
| `POST /mcp` | MCP Streamable HTTP |
| `GET /api/projects/:projectId` | Dashboard snapshot |
| `GET /api/projects/:projectId/events` | SSE live feed |
| `GET /health` | Liveness |

Default bind: `127.0.0.1:3847`. Default project id: `default`.

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

Later hosted mode (Convex + Render) is out of scope. Services do not import `better-sqlite3`, so storage can be swapped without rewriting tools.

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

If `SYNCO_API_KEY` is set, send `Authorization: Bearer <key>`.

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

Give each host a **stable unique `agentId`** (`cursor-grok`, `claude-code`, `opencode`, …). Do not reuse another agent's id. Default `projectId` is `default`.

### 1. Project files that every host reads

Put the copy-paste block from `AGENT_INSTRUCTIONS.md` into files the agent host loads automatically. A file the agent must `Read` on its own is not enough.

| Host | File | Notes |
| --- | --- | --- |
| Cursor | `.cursor/rules/synco-mcp.mdc` with `alwaysApply: true` | Injected into every conversation in this repo |
| Cursor, Claude Code, Codex, many others | `AGENTS.md` at the repo root | Same block; keep `agentId` as a placeholder or per-clone value |
| Claude Code | `CLAUDE.md` | Paste the same block if you do not rely on `AGENTS.md` |

Example Cursor rule:

```markdown
---
description: Mandatory synco-mcp protocol before and after every turn
alwaysApply: true
---

# synco-mcp is mandatory

If synco-mcp tools are available, you MUST use them. Documentation is not optional.

Project id: `default`. Agent id: `<AGENT_ID>`.

First tool calls in a session: `register_agent` then `get_agent_context`.
Start of every later turn: `get_agent_context` before other work.
Before any file edit: `declare_change_intent` with every path you will touch.
After file edits in this turn: `report_change` before the final user-facing reply.
No file edits: do not invent a ChangeReport.

Git is the source of truth. ChangeReports are agent-declared, not verified diffs.
Claims warn; they do not lock. Poll — hosts do not push events into you.
```

Replace `<AGENT_ID>` per host. Commit the rule and `AGENTS.md` so every clone gets them.

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

**Cursor** project hooks (`.cursor/hooks.json`), committed to the repo:

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

Stronger (optional): a `preToolUse` command hook that **denies** `Write` / `StrReplace` until a `declare_change_intent` ran in the same session. That is the closest thing to a hard “before”. Check Cursor → Hooks after adding files; restart Cursor if they do not load.

Other hosts: use their equivalent of session-start / stop hooks, or put the same block in the system prompt. synco-mcp cannot reach into Claude Code or opencode for you.

### Checklist

A new developer on a shared project is not done after `npm start` and pasting the MCP URL. They need:

1. HTTP MCP client pointed at `http://127.0.0.1:3847/mcp` (see above).
2. Unique `agentId` filled into the project rule / `AGENTS.md`.
3. User rule on their own Cursor (or other host) profile.
4. Project hooks committed and enabled.
5. Confirmation on the dashboard: after the first real prompt, an `agent_registered` event and later `intent_declared` / `change_reported` — not only chat replies.

If the dashboard stays empty, the agent is not using MCP. Fix the host, not the server.

## Security

- Without `SYNCO_API_KEY` the server **refuses** to bind anything except loopback.
- Do not expose `/mcp` or `/api` to the internet without a key.
- Secrets and tokens are not logged.
- API keys are MVP auth, not a full permission model.

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
- Default UI is a single project (`default`).

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
