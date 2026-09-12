import { useEffect, useState } from "react";
import { eventsUrl, loadState } from "./api";
import type { DashboardState, FeedEvent } from "./types";

export type LiveStatus = "sse" | "poll" | "connecting";

const EVENT_TYPES = [
  "agent_registered",
  "task_created",
  "task_claimed",
  "task_started",
  "intent_declared",
  "change_reported",
  "task_completed",
  "handoff_created",
  "conflict_detected",
  "agent_status_changed",
  "manual_log",
] as const;

type StreamEvent = {
  id: string;
  type: string;
  agentId?: string;
  taskId?: string;
  createdAt: string;
  payload?: { summary?: string };
};

function parseStreamEvent(raw: string): StreamEvent | undefined {
  try {
    const parsed = JSON.parse(raw) as StreamEvent;
    return parsed.id && parsed.type ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function toFeedEvent(event: StreamEvent): FeedEvent {
  return {
    id: event.id,
    type: event.type,
    agentId: event.agentId,
    taskId: event.taskId,
    createdAt: event.createdAt,
    summary: event.payload?.summary ?? event.type,
  };
}

export function useDeskLive() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveStatus>("connecting");
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let poll: number | undefined;
    let refreshTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let ready = false;

    const markFresh = (id: string) => {
      setFreshIds((prev) => (prev.includes(id) ? prev : [id, ...prev].slice(0, 20)));
      window.setTimeout(() => {
        setFreshIds((prev) => prev.filter((item) => item !== id));
      }, 5000);
    };

    const applyEvent = (raw: string) => {
      const parsed = parseStreamEvent(raw);
      if (!parsed) return;
      markFresh(parsed.id);
      setState((prev) => {
        if (!prev || prev.events.some((event) => event.id === parsed.id)) return prev;
        return { ...prev, events: [toFeedEvent(parsed), ...prev.events].slice(0, 40) };
      });
    };

    const refresh = async () => {
      try {
        const next = await loadState();
        if (cancelled) return;
        setState(next);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load project state");
      }
    };

    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refresh();
      }, 80);
    };

    const onTypedEvent = (event: MessageEvent<string>) => {
      if (!ready) return;
      applyEvent(event.data);
      scheduleRefresh();
    };

    const stopPoll = () => {
      if (poll) {
        window.clearInterval(poll);
        poll = undefined;
      }
    };

    const startPoll = () => {
      if (poll || cancelled) return;
      poll = window.setInterval(() => {
        void refresh();
      }, 2500);
    };

    const connect = () => {
      source?.close();
      source = new EventSource(eventsUrl());
      ready = false;

      source.onopen = () => {
        if (cancelled) return;
        setLive("sse");
        stopPoll();
      };

      source.addEventListener("ready", () => {
        ready = true;
        if (cancelled) return;
        setLive("sse");
        stopPoll();
      });

      source.onmessage = onTypedEvent;
      EVENT_TYPES.forEach((type) => source?.addEventListener(type, onTypedEvent));

      source.onerror = () => {
        if (cancelled) return;
        if (source?.readyState === EventSource.CLOSED) {
          setLive("poll");
          startPoll();
          if (reconnectTimer) window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(() => {
            if (!cancelled) connect();
          }, 1500);
          return;
        }
        setLive("connecting");
        startPoll();
      };
    };

    void refresh();
    connect();

    return () => {
      cancelled = true;
      source?.close();
      stopPoll();
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
  }, []);

  return { state, error, live, freshIds, now, updatedAt };
}
