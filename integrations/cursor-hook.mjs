#!/usr/bin/env node
// Cursor preToolUse adapter. Returns a permission decision on stdout.
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { checkEdit, denialMessage, readStdin } from "./synco-guard.mjs";

const result = await checkEdit({
  payload: readStdin(),
  cwd: process.cwd(),
  adapterDir: dirname(fileURLToPath(import.meta.url)),
  env: process.env,
});

if (result.allowed) {
  process.stdout.write(JSON.stringify({ permission: "allow" }));
} else {
  process.stdout.write(
    JSON.stringify({
      permission: "deny",
      agent_message: denialMessage(result),
      user_message: "Edit blocked: no declared change intent in synco-mcp for this path.",
    }),
  );
}

process.exit(0);
