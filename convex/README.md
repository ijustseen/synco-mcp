# Convex backend

Hosted coordination for synco-mcp. Agents talk to `https://<deployment>.convex.site/mcp`. The local Express + SQLite server in `src/` stays the self-host option.

## What you do once

1. Create a free account at [dashboard.convex.dev](https://dashboard.convex.dev).
2. From the repo root:

```bash
npm install
npx convex dev
```

The CLI opens a browser login, creates a project, writes `.env.local`, and generates `convex/_generated`. Leave it running.

3. In another terminal, set a machine key (required — Convex HTTP is public):

```bash
npx convex env set SYNCO_API_KEY "$(openssl rand -hex 24)"
```

Copy the key. Agents send it as `Authorization: Bearer <key>`.

4. In the Convex dashboard, copy **HTTP Actions URL** — it ends in `.convex.site`, not `.convex.cloud`.

5. Point hosts at that URL:

```bash
npx synco-mcp init --url=https://<deployment>.convex.site
```

Cursor MCP config:

```json
{
  "mcpServers": {
    "synco-mcp": {
      "url": "https://<deployment>.convex.site/mcp",
      "headers": {
        "Authorization": "Bearer <SYNCO_API_KEY>"
      }
    }
  }
}
```

6. Check:

```bash
curl https://<deployment>.convex.site/health
```

## Dashboard

The Vite desk reads Convex directly (`VITE_CONVEX_URL` = `.convex.cloud`). Copy `dashboard/.env.example` to `dashboard/.env.local` and run:

```bash
npm --prefix dashboard install
npm --prefix dashboard run dev
```

Open http://127.0.0.1:5173/ — no Express login. Live updates come from Convex subscriptions.

Vercel: set `VITE_CONVEX_URL` to the same `.convex.cloud` URL. Do not proxy `/mcp` through Vercel. Agents call `.convex.site` directly.

Convex Auth (browser login) is not here yet. Mutations on the desk are public on this deployment.
