import type { ChangeReport, ConflictWarning, ProjectEvent } from "../../domain/types.js";

const SUMMARY_MAX = 400;

export function compactChangeSummary(report: ChangeReport): string {
  const files = report.files
    .slice(0, 4)
    .map((file) => `\`${file.path}\``)
    .join(", ");
  const extra = report.files.length > 4 ? ` (+${report.files.length - 4} more)` : "";
  const breaking = report.breakingChange
    ? "Potential breaking changes declared."
    : "No breaking API changes declared.";
  const tests = report.tests.summary
    ? `Tests: ${report.tests.status} — ${report.tests.summary}`
    : `Tests: ${report.tests.status}.`;
  const next = report.nextSteps[0] ? ` Next: ${report.nextSteps[0]}` : "";

  const text = [
    report.summary,
    files ? `Files: ${files}${extra}.` : null,
    report.affectedAreas.length > 0 ? `Areas: ${report.affectedAreas.slice(0, 5).join(", ")}.` : null,
    breaking,
    tests,
    next,
    "Source: agent_declared (not a verified Git diff).",
  ]
    .filter(Boolean)
    .join(" ");

  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;
}

export function eventHeadline(event: ProjectEvent): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const summary = typeof payload.summary === "string" ? payload.summary : undefined;
  switch (event.type) {
    case "agent_registered":
      return summary ?? "Agent registered";
    case "task_created":
      return summary ?? "Task created";
    case "task_claimed":
      return summary ?? "Task claimed";
    case "task_started":
      return summary ?? "Task started";
    case "intent_declared":
      return summary ?? "Change intent declared";
    case "change_reported":
      return summary ?? "Change report published";
    case "task_completed":
      return summary ?? "Task completed";
    case "handoff_created":
      return summary ?? "Handoff created";
    case "conflict_detected":
      return summary ?? "Resource overlap warning";
    case "claims_released":
      return summary ?? "Resource claims released";
    case "agent_status_changed":
      return summary ?? "Agent status changed";
    case "manual_log": {
      const author = typeof payload.author === "string" ? payload.author : undefined;
      if (summary && author) return `${author}: ${summary}`;
      return summary ?? "Manual log";
    }
    default:
      return event.type;
  }
}

export function compactEvent(event: ProjectEvent) {
  return {
    id: event.id,
    type: event.type,
    agentId: event.agentId,
    taskId: event.taskId,
    createdAt: event.createdAt,
    summary: eventHeadline(event),
  };
}

export function compactReport(report: ChangeReport) {
  return {
    id: report.id,
    source: report.source,
    agentId: report.agentId,
    taskId: report.taskId,
    summary: compactChangeSummary(report),
    breakingChange: report.breakingChange,
    tests: report.tests.status,
    affectedAreas: report.affectedAreas.slice(0, 8),
    fileCount: report.files.length,
    createdAt: report.createdAt,
  };
}

export function warningsFromClaims(
  overlaps: Array<{ resourcePath: string; claims: import("../../domain/types.js").ResourceClaim[] }>,
  detectedAt: string,
): ConflictWarning[] {
  return overlaps.map((group) => ({
    resourcePath: group.resourcePath,
    agentIds: [...new Set(group.claims.map((claim) => claim.agentId))],
    taskIds: [...new Set(group.claims.map((claim) => claim.taskId).filter(Boolean))] as string[],
    claimIds: group.claims.map((claim) => claim.id),
    detectedAt,
    status: "active" as const,
  }));
}
