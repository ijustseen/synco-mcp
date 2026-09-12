import { useMemo, useState, type ReactNode } from "react";
import { addManualLog } from "./api";
import { useDeskLive } from "./live";
import type { DashboardState, FeedEvent } from "./types";

type FileRow = {
  key: string;
  when: string;
  action: string;
  path: string;
  agent: string;
  note: string;
};

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function agentName(state: DashboardState, id?: string): string {
  if (!id) return "—";
  return state.agents.find((agent) => agent.id === id)?.name ?? id;
}

function taskTitle(state: DashboardState, id?: string): string {
  if (!id) return "—";
  return state.tasks.find((task) => task.id === id)?.title ?? id;
}

function lastAction(state: DashboardState, agentId: string): string | undefined {
  return state.events.find((event) => event.agentId === agentId)?.summary;
}

function formatWhen(value: string, now: number): string {
  const diff = now - new Date(value).getTime();
  if (diff < 15_000) return "just now";
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  return formatTime(value);
}

function activityByHour(events: FeedEvent[]): Array<{ label: string; count: number }> {
  if (events.length === 0) return [];
  const buckets = new Map<string, number>();
  for (const event of events) {
    const date = new Date(event.createdAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([key, count]) => ({
      label: `${String(Number(key.split("-").at(-1))).padStart(2, "0")}:00`,
      count,
    }));
}

function fileRows(state: DashboardState): FileRow[] {
  const rows: FileRow[] = [];
  for (const report of state.reports) {
    for (const file of report.files) {
      rows.push({
        key: `${report.id}-${file.path}`,
        when: report.createdAt,
        action: file.action,
        path: file.path,
        agent: agentName(state, report.agentId),
        note: file.description,
      });
    }
  }
  return rows;
}

function GoldButton({
  children,
  onClick,
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-full bg-[#E8B84A] px-3.5 py-1.5 text-sm font-medium text-[#070707] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[16px] border border-white/10 bg-[#111111] ${className}`}>{children}</div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="flex min-h-0 flex-col p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium tracking-tight">{title}</h2>
        {hint && <p className="text-[13px] text-[#9A9A94]">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

function AddLogForm({ onClose }: { onClose: () => void }) {
  const [author, setAuthor] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/75 px-4">
      <form
        className="w-full max-w-md rounded-[16px] border border-white/10 bg-[#111111] p-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await addManualLog({ summary: summary.trim(), author: author.trim() || undefined });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not add log");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="text-lg font-medium tracking-tight">Add log</h2>
        <p className="mt-1 text-[13px] text-[#9A9A94]">Human note in the work log. Not a ChangeReport.</p>
        <label className="mt-4 block text-[13px] text-[#9A9A94]">
          Author
          <input
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#070707] px-3 py-2 text-sm text-[#F5F5F2] outline-none focus:border-[#E8B84A]"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            placeholder="Your name"
          />
        </label>
        <label className="mt-3 block text-[13px] text-[#9A9A94]">
          Note
          <textarea
            className="mt-1.5 min-h-24 w-full rounded-lg border border-white/10 bg-[#070707] px-3 py-2 text-sm text-[#F5F5F2] outline-none focus:border-[#E8B84A]"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="What should the next agent see?"
            required
          />
        </label>
        {error && <p className="mt-2 text-[13px] text-[#E8B4B4]">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/15 px-3.5 py-1.5 text-sm text-[#9A9A94]"
          >
            Cancel
          </button>
          <GoldButton type="submit" disabled={busy || !summary.trim()}>
            {busy ? "Saving…" : "Add log"}
          </GoldButton>
        </div>
      </form>
    </div>
  );
}

export function App() {
  const { state, error, live, freshIds, now } = useDeskLive();
  const [logOpen, setLogOpen] = useState(false);

  const lead = state?.reports[0];
  const activity = useMemo(() => (state ? activityByHour(state.events) : []), [state]);
  const files = useMemo(() => (state ? fileRows(state) : []), [state]);
  const maxActivity = activity.reduce((max, row) => Math.max(max, row.count), 1);

  if (error && !state) {
    return (
      <main className="px-6 py-12">
        <h1 className="text-xl font-medium">Could not load the desk</h1>
        <p className="mt-2 text-sm text-[#9A9A94]">{error}</p>
      </main>
    );
  }

  if (!state) {
    return <main className="px-6 py-12 text-sm text-[#9A9A94]">Loading the coordination desk…</main>;
  }

  return (
    <main className="min-h-screen bg-[#070707] text-[#F5F5F2]">
      {logOpen && <AddLogForm onClose={() => setLogOpen(false)} />}

      <header className="border-b border-white/10 px-5 py-3">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <p className="text-[15px] font-semibold tracking-tight">synco-mcp</p>
            <span className="font-data text-[12px] text-[#9A9A94]">{state.project.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-[13px] text-[#9A9A94]">
              <span className={`h-1.5 w-1.5 rounded-full ${live === "sse" ? "live-dot bg-[#E8B84A]" : "bg-[#737373]"}`} />
              {live === "sse" ? "Live" : live === "poll" ? "Polling" : "Connecting"}
            </span>
            <GoldButton onClick={() => setLogOpen(true)}>Add log</GoldButton>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-5 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Agents", state.counts.agents],
            ["Events", state.events.length],
            ["Files", files.length],
            ["Warnings", state.counts.warnings],
          ].map(([label, value]) => (
            <Card key={String(label)} className="px-4 py-3">
              <p className="text-[12px] text-[#9A9A94]">{label}</p>
              <p className="mt-1 text-2xl font-medium tracking-tight">{value}</p>
            </Card>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <Panel title="Latest change" hint="Agent-declared">
            {lead ? (
              <div>
                <p className="text-[17px] font-medium leading-snug tracking-tight">{lead.summary}</p>
                <p className="mt-2 text-[13px] text-[#9A9A94]">
                  {agentName(state, lead.agentId)}
                  {lead.taskId ? ` · ${taskTitle(state, lead.taskId)}` : ""} · tests{" "}
                  {lead.tests.status.replaceAll("_", " ")}
                  {lead.breakingChange ? " · breaking" : ""}
                </p>
                <div className="mt-3 space-y-2">
                  {lead.files.map((file) => (
                    <div key={file.path} className="rounded-lg bg-[#070707] px-3 py-2">
                      <p className="font-data text-[12px] text-[#E8B84A]">{file.action}</p>
                      <p className="font-data mt-0.5 text-[13px]">{file.path}</p>
                      <p className="mt-1 text-[13px] text-[#9A9A94]">{file.description}</p>
                    </div>
                  ))}
                </div>
                {lead.nextSteps[0] && (
                  <p className="mt-3 text-[13px] text-[#D4D4D0]">Next: {lead.nextSteps.join(" ")}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-[#9A9A94]">No ChangeReports yet. An agent must call report_change.</p>
            )}
          </Panel>

          <Panel title="Activity" hint="Events by hour">
            {activity.length === 0 ? (
              <p className="text-sm text-[#9A9A94]">No events yet.</p>
            ) : (
              <div className="flex h-40 items-end gap-2">
                {activity.map((col) => (
                  <div key={col.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                    <span className="font-data text-[11px] text-[#9A9A94]">{col.count}</span>
                    <div
                      className="w-full rounded-t bg-[#E8B84A]"
                      style={{ height: `${Math.max(8, (col.count / maxActivity) * 120)}px` }}
                    />
                    <span className="font-data text-[11px] text-[#9A9A94]">{col.label}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.4fr_280px]">
          <Panel title="Work log">
            {state.events.length === 0 ? (
              <p className="text-sm text-[#9A9A94]">The log is empty.</p>
            ) : (
              <div className="max-h-[420px] overflow-auto">
                {state.events.map((event) => (
                  <div
                    key={event.id}
                    className={`flex gap-3 border-b border-white/10 py-2.5 last:border-0 ${freshIds.includes(event.id) ? "log-fresh" : ""}`}
                  >
                    <span className="font-data w-14 shrink-0 text-[12px] text-[#9A9A94]">
                      {formatWhen(event.createdAt, now)}
                    </span>
                    <div className="min-w-0">
                      <p className="font-data text-[11px] uppercase tracking-[0.12em] text-[#E8B84A]">{event.type}</p>
                      <p className="mt-0.5 text-sm leading-snug">{event.summary}</p>
                      <p className="mt-0.5 text-[12px] text-[#9A9A94]">
                        {agentName(state, event.agentId)}
                        {event.taskId ? ` · ${taskTitle(state, event.taskId)}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Agents">
            {state.agents.length === 0 ? (
              <p className="text-sm text-[#9A9A94]">None registered.</p>
            ) : (
              <div className="space-y-3">
                {state.agents.map((agent) => (
                  <div key={agent.id} className="border-b border-white/10 pb-3 last:border-0 last:pb-0">
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className="font-data mt-0.5 text-[12px] text-[#9A9A94]">
                      {agent.platform}
                      {agent.model ? ` · ${agent.model}` : ""} · {agent.status}
                    </p>
                    <p className="mt-1 text-[13px] text-[#D4D4D0]">
                      {lastAction(state, agent.id) ??
                        (agent.currentTaskId ? `Working on ${taskTitle(state, agent.currentTaskId)}` : "Idle")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Files they touched" hint="From ChangeReports">
          {files.length === 0 ? (
            <p className="text-sm text-[#9A9A94]">No declared file changes yet.</p>
          ) : (
            <div className="max-h-56 overflow-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
                <thead className="sticky top-0 bg-[#161616]">
                  <tr className="text-[12px] text-[#9A9A94]">
                    <th className="px-2 py-2 font-medium">When</th>
                    <th className="px-2 py-2 font-medium">Action</th>
                    <th className="px-2 py-2 font-medium">Path</th>
                    <th className="px-2 py-2 font-medium">By</th>
                    <th className="px-2 py-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((row) => (
                    <tr key={row.key} className="border-t border-white/10">
                      <td className="px-2 py-2 font-data text-[#9A9A94]">{formatTime(row.when)}</td>
                      <td className="px-2 py-2 text-[#E8B84A]">{row.action}</td>
                      <td className="px-2 py-2 font-data">{row.path}</td>
                      <td className="px-2 py-2 text-[#9A9A94]">{row.agent}</td>
                      <td className="px-2 py-2 text-[#D4D4D0]">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="grid gap-3 sm:grid-cols-2">
          <Panel title="Corrections" hint="Overlap, not Git locks">
            {state.warnings.length === 0 ? (
              <p className="text-sm text-[#9A9A94]">No overlapping claims.</p>
            ) : (
              <div className="space-y-2">
                {state.warnings.map((warning) => (
                  <div key={`${warning.resourcePath}-${warning.detectedAt}`} className="rounded-lg bg-[#070707] px-3 py-2">
                    <p className="font-data text-[13px]">{warning.resourcePath}</p>
                    <p className="mt-1 text-[13px] text-[#9A9A94]">
                      {warning.agentIds.map((id) => agentName(state, id)).join(" and ")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Handoffs">
            {state.handoffs.length === 0 ? (
              <p className="text-sm text-[#9A9A94]">No handoffs yet.</p>
            ) : (
              <div className="space-y-3">
                {state.handoffs.map((handoff) => (
                  <div key={handoff.id}>
                    <p className="font-data text-[11px] uppercase tracking-[0.12em] text-[#E8B84A]">
                      {agentName(state, handoff.fromAgentId)} →{" "}
                      {handoff.toAgentId ? agentName(state, handoff.toAgentId) : "next agent"}
                    </p>
                    <p className="mt-1 text-sm">{handoff.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}
