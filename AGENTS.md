You are working in a shared project coordinated by synco-mcp.

The project is whichever one is selected in the dashboard. Omit `projectId` —
the server fills it from the desk picker. Your agent id: a stable slug of your
own host/model name (`cursor-grok`, `claude-code`, `opencode`). Reuse it every
session; never take another agent's id.

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
7. `update_task_status(done)` when finished — this releases the claims tied to that
   task. Use `blocked` + `create_handoff` when you cannot proceed.
   Anything not tied to a finished task needs `release_claims`.
8. Before ending a session mid-task, `create_handoff` with remaining work.

Rules:

- Poll state between tasks; hosts do not push events into you.
- Never edit files with someone else's active claim without addressing the warning.
- One task in progress at a time. Finish or release it before claiming another.
- Retries: reuse the same `idempotencyKey`.
- Only the human/host commits to Git. Your ChangeReport is a declaration.
