import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { DashboardState } from "./types";

export type LiveStatus = "live" | "connecting";

export function useDeskLive(projectId: string) {
  const state = useQuery(api.dashboard.getDesk, { projectId }) as DashboardState | undefined;
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!state) {
      return;
    }
    const incoming = state.events.filter((event) => !seen.current.has(event.id)).map((event) => event.id);
    if (seen.current.size === 0) {
      for (const event of state.events) {
        seen.current.add(event.id);
      }
      return;
    }
    if (incoming.length === 0) {
      return;
    }
    for (const id of incoming) {
      seen.current.add(id);
    }
    setFreshIds((prev) => [...incoming, ...prev].slice(0, 20));
    const timer = window.setTimeout(() => {
      setFreshIds((prev) => prev.filter((id) => !incoming.includes(id)));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [state]);

  return {
    state: state ?? null,
    error: null,
    live: state ? ("live" as const) : ("connecting" as const),
    freshIds,
    now,
    updatedAt: state ? Date.now() : null,
  };
}
