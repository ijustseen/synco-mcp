#!/usr/bin/env node
// Claude Code PreToolUse adapter. Exit code 2 blocks the call and feeds stderr
// back to the model, which is exactly the channel we want for the instruction.
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { checkEdit, denialMessage, readStdin } from "./synco-guard.mjs";

// Cursor also executes hooks declared in ~/.claude/settings.json, so this
// adapter must stay silent unless it is really running inside Claude Code.
const result = await checkEdit({
  payload: readStdin(),
  cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  adapterDir: dirname(fileURLToPath(import.meta.url)),
  env: process.env,
  host: "claude-code",
});

if (result.allowed) {
  process.exit(0);
}

process.stderr.write(denialMessage(result));
process.exit(2);
