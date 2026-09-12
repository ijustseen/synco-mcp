import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime, type Runtime } from "../src/application/runtime.js";
import { createHttpApp } from "../src/server/http.js";

function parseTool(result: unknown) {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === "text")?.text;
  expect(text).toBeTruthy();
  return JSON.parse(text!) as Record<string, unknown>;
}

describe("MCP tools over Streamable HTTP", () => {
  let runtime: Runtime;
  let url: string;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synco-mcp-"));
    runtime = createRuntime(path.join(dir, "test.sqlite"));
    const app = createHttpApp(runtime);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind test server");
    }
    url = `http://127.0.0.1:${address.port}`;
    closeServer = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  afterAll(async () => {
    await closeServer();
    runtime.close();
  });

  async function connect() {
    const client = new Client({ name: "synco-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
    await client.connect(transport);
    return client;
  }

  it("lists coordination tools", async () => {
    const client = await connect();
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "register_agent",
        "get_project_state",
        "create_task",
        "claim_task",
        "report_change",
        "release_claims",
        "create_handoff",
      ]),
    );
    await client.close();
  });

  it("registers an agent and claims a task through MCP", async () => {
    const client = await connect();
    const registered = parseTool(
      await client.callTool({
        name: "register_agent",
        arguments: {
          projectId: "default",
          agentId: "agent-a",
          name: "Backend",
          platform: "cursor",
        },
      }),
    );
    expect(registered.agent).toMatchObject({ id: "agent-a", name: "Backend" });

    const created = parseTool(
      await client.callTool({
        name: "create_task",
        arguments: { projectId: "default", title: "Add authentication API" },
      }),
    );
    const task = created.task as { id: string };

    const claimed = parseTool(
      await client.callTool({
        name: "claim_task",
        arguments: { projectId: "default", taskId: task.id, agentId: "agent-a" },
      }),
    );
    expect(claimed.ok).toBe(true);
    await client.close();
  });

  it("accepts MCP calls that omit projectId and writes to the desk", async () => {
    const client = await connect();
    const registered = parseTool(
      await client.callTool({
        name: "register_agent",
        arguments: {
          agentId: "agent-desk",
          name: "Desk writer",
          platform: "cursor",
        },
      }),
    );
    expect(registered.agent).toMatchObject({ id: "agent-desk", projectId: "default" });
    expect(registered.desk).toMatchObject({ id: "default" });

    const created = parseTool(
      await client.callTool({
        name: "create_task",
        arguments: { title: "Follow the dashboard picker" },
      }),
    );
    const task = created.task as { id: string; projectId: string };
    expect(task.projectId).toBe("default");

    const context = parseTool(
      await client.callTool({
        name: "get_agent_context",
        arguments: { agentId: "agent-desk" },
      }),
    );
    expect(context.agent).toMatchObject({ id: "agent-desk" });
    await client.close();
  });
});
