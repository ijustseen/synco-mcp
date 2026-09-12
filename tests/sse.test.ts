import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createInProcessEventBus } from "../src/infrastructure/events/event-bus.js";
import { attachProjectSse } from "../src/infrastructure/realtime/sse.js";
import type { ProjectEvent } from "../src/domain/types.js";

function fakeResponse() {
  const emitter = new EventEmitter();
  let body = "";
  const res = Object.assign(emitter, {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    flushHeaders() {},
    write(chunk: string) {
      body += chunk;
      return true;
    },
    snapshot: () => body,
  });
  return res;
}

describe("SSE", () => {
  it("replays history and streams new events for the same project", () => {
    const bus = createInProcessEventBus();
    const res = fakeResponse();
    const past: ProjectEvent = {
      id: "evt-1",
      projectId: "default",
      type: "task_created",
      payload: { summary: "past" },
      createdAt: new Date().toISOString(),
    };

    attachProjectSse({
      res: res as never,
      projectId: "default",
      bus,
      replay: [past],
    });

    bus.publish({
      id: "evt-2",
      projectId: "default",
      type: "change_reported",
      payload: { summary: "live" },
      createdAt: new Date().toISOString(),
    });
    bus.publish({
      id: "evt-3",
      projectId: "other",
      type: "task_created",
      payload: { summary: "other project" },
      createdAt: new Date().toISOString(),
    });

    const body = res.snapshot();
    expect(body).toContain("id: evt-1");
    expect(body).toContain("id: evt-2");
    expect(body).not.toContain("id: evt-3");
    expect(body).toContain("event: ready");
  });
});
