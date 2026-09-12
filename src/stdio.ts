import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuntime } from "./application/runtime.js";
import { createMcpServer } from "./server/mcp.js";

const runtime = createRuntime();
const server = createMcpServer(runtime.service);
const transport = new StdioServerTransport();

await server.connect(transport);

const shutdown = async () => {
  await server.close();
  runtime.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
