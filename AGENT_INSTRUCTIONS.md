# Agent instructions for synco-mcp

This document defines the instruction every agent using synco-mcp should receive. Host it next to the repo, or paste the [copy-paste block](#copy-paste-block) into `AGENTS.md`, `CLAUDE.md`, or the agent's system prompt.

The instruction answers one question: **how does an agent behave correctly in a shared project coordinated by synco-mcp?**

## Design principles

The instruction must teach these invariants, in this order:

1. **Git is the source of truth for code.** synco-mcp stores coordination metadata only. A ChangeReport is agent-declared, never a verified diff.
2. **Claims warn, they do not lock.** A resource claim means "I intend to edit this"; others get an overlap warning, nothing is prevented.
3. **Poll, do not wait.** Hosts do not reliably push MCP notifications into a running model. The agent must call `get_project_state` / `get_recent_changes` itself.
4. **Declare, don't assume.** The agent publishes what it did and reads what others declared. It never treats another agent's report as ground truth about the filesystem.

## Required instruction sections

An agent instruction for synco-mcp should contain all of the following.

### 1. Identity

- Fixed `agentId` (e.g. `claude-code`, `opencode`, `cursor-1`). Omit `projectId` — the dashboard picker is the project.
- One agent id per host session. Do not reuse another agent's id.

### 2. Session lifecycle

```
register_agent
    ↓
get_agent_context                # my task, claims, handoffs, warnings
    ↓
work loop:
    claim_task → declare_change_intent → edit → report_change → update_task_status(done)
    ↓
create_handoff                   # if another agent continues
```

Rules per stage:

| Stage | Tool | Rule |
| --- | --- | --- |
| Start | `register_agent` | Always, at session start. Returns a snapshot — read it. |
| Situational awareness | `get_project_state`, `get_recent_changes`, `get_agent_context` | Poll before starting work and between tasks. `get_agent_context`, not the full log. |
| Task | `create_task`, `claim_task` | Claim before working. A refusal means the task is taken — pick another. Keep exactly one task `in_progress`. |
| Edit | `declare_change_intent` | Before touching files. Include every file and directory you will modify. |
| Report | `report_change` | After the work unit, with files, areas, behavior changes, tests status. |
| Finish | `update_task_status` | `done` releases the claims tied to that task. Use `blocked` with a handoff when stuck. |
| Let go | `release_claims` | Drop claims yourself. Required if you declared intent without a `taskId`, or set `blocked` — neither releases anything. |
| Handover | `create_handoff` | Structured context for the next agent: what is done, what remains, known issues. |

### 3. Behavioral rules

Mandatory rules, phrased so a model can follow them verbatim:

- Register once per session before any other tool call.
- Never start a claimed task without re-reading `get_agent_context` after idle time.
- Declare intent **before** editing files, with exact paths (globs for directories).
- If a warning shows overlapping claims, coordinate: change scope, sequence work, or stop and hand off.
- Report changes in the same session that made them. Do not batch reports across tasks.
- `report_change` describes intent and outcome; it is not a Git commit. Only the host commits.
- Set `breakingChange: true` honestly.
- Fill `tests.status` truthfully (`not_run` is a valid answer).
- Use `idempotencyKey` on retries so a failed call does not duplicate an event.
- Complete tasks you own; if you abandon one, set `blocked` and write a handoff.
- Release your claims when you stop editing. Only `update_task_status(done)` frees them automatically, and only those carrying that `taskId` — everything else needs `release_claims`.

### 4. Anti-patterns to forbid explicitly

- Treating another agent's ChangeReport as a verified diff.
- Editing files claimed by another agent without acknowledging the warning.
- Waiting passively for events — there is no push into the model.
- Holding claims on a `done` task.
- Writing coordination state anywhere except through the MCP tools (no side channels).

## Copy-paste block

```markdown
You are working in a shared project coordinated by synco-mcp.

The project is the dashboard picker. Omit `projectId`. Your agent id: `<AGENT_ID>`.

Git is the source of truth for code. synco-mcp only coordinates agents.
ChangeReports you publish or read are agent-declared, not verified diffs.
Resource claims warn about overlap; they do not lock files.

Follow this protocol:

1. At session start call `register_agent` (projectId, your agentId, name, platform).
2. Call `get_agent_context`. If you have a task, continue it. Otherwise call
   `get_project_state`, then `get_recent_changes` to see what others declared.
3. Pick work: `claim_task` (or `create_task` then `claim_task`). A refusal means
   the task is taken — pick another. Keep exactly one task `in_progress`.
4. Before editing, `declare_change_intent` with every file/directory you will touch.
5. Edit code. Verify with tests/lint when available.
6. Publish `report_change`: files, affected areas, interfaces, behavior changes,
   breakingChange, tests status, next steps. Honest `not_run` beats silent success.
7. `update_task_status(done)` when finished — this releases your claims.
   Use `blocked` + `create_handoff` when you cannot proceed.
8. Before ending a session mid-task, `create_handoff` with remaining work.

Rules:
- Poll state between tasks; hosts do not push events into you.
- Never edit files with someone else's active claim without addressing the warning.
- One task in progress at a time. Finish or release it before claiming another.
- Retries: reuse the same `idempotencyKey`.
- Only the human/host commits to Git. Your ChangeReport is a declaration.
```

## Host checklist

Before an agent can follow this instruction, the host must:

- Connect the MCP client to the shared server (`http://<host>:3847/mcp`, `Authorization: Bearer <key>` if set).
- Fill in `<AGENT_ID>` with a stable, unique value.
- Decide the commit policy and state it to the agent (synco-mcp never commits).
- Ensure the project exists on the server; agents cannot create projects.
