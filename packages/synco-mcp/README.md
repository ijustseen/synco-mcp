# synco-mcp

Lightweight installer for the synco-mcp **edit guard**. It does not start the
coordination server. Point `--url` at a running synco instance.

```bash
npx synco-mcp init
npx synco-mcp init --url=https://synco.example.com
npx synco-mcp init cursor --agent-id=cursor-andrew
```

`init` is optional. The command writes host hooks for every agent it finds
(Cursor, Claude Code, opencode) and a `.synco.json` marker in the current repo.
The guard stays silent in repositories without that file.

The live project is the one selected in the dashboard picker. You do not need
to pass a project id.
