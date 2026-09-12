import type { Response } from "express";
import type { ProjectEvent } from "../../domain/types.js";
import type { EventBus } from "../events/event-bus.js";

function flush(res: Response): void {
  const flushable = res as Response & { flush?: () => void };
  flushable.flush?.();
}

export function writeSse(res: Response, event: ProjectEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  flush(res);
}

export function attachProjectSse(options: {
  res: Response;
  projectId: string;
  lastEventId?: string;
  bus: EventBus;
  replay: ProjectEvent[];
}): () => void {
  const { res, projectId, bus, replay } = options;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  for (const event of replay) {
    writeSse(res, event);
  }

  res.write(`event: ready\ndata: ${JSON.stringify({ projectId })}\n\n`);

  const unsubscribe = bus.subscribe((event) => {
    if (event.projectId === projectId) {
      writeSse(res, event);
    }
  });

  const heartbeat = setInterval(() => {
    res.write(`: keepalive\n\n`);
    flush(res);
  }, 15000);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  res.on("close", close);
  return close;
}
