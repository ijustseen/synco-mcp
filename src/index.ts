import { createRuntime } from "./application/runtime.js";
import { assertBindSafe } from "./server/auth.js";
import { createHttpApp, dashboardUrl } from "./server/http.js";
import { config } from "./shared/config.js";

assertBindSafe();

const runtime = createRuntime();
const app = createHttpApp(runtime);

const server = app.listen(config.port, config.host, () => {
  console.log(`synco-mcp HTTP listening on ${config.host}:${config.port}`);
  console.log(`Dashboard: ${dashboardUrl()}`);
  console.log(`MCP:       ${dashboardUrl()}mcp`);
  console.log(`Health:    ${dashboardUrl()}health`);
});

function shutdown() {
  server.close(() => {
    runtime.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
