/**
 * Flashpoint adapter for the shared final-report evidence audit.
 * Preview and PDF must call finalizeFlashpointPublication so they cannot
 * diverge. The auditor itself stays topic-agnostic.
 */
import { format } from "date-fns";
import {
  auditFinalReportEvidence,
  FinalReportEvidenceAuditError,
  isFinalReportIssueBlocking,
  type FinalReportEvidenceAuditIssue,
  type FinalReportEvidenceAuditInput,
  type FinalReportTypedReference,
} from "./finalReportEvidenceAudit";
import {
  buildFlashpointReportDataset,
  resolveFlashpointRenderedModel,
  assertFlashpointRenderedModelValid,
  type FlashpointReportIncident,
  type FlashpointRenderedModel,
  type FlashpointResolvedProseInput,
  type FlashpointResolvedAiInput,
} from "./flashpointReportDataset";
import { resolveReportWindow } from "./reportWindow";
import {
  type ProtestScheduleModel,
} from "./protestScheduleModel";

export interface FlashpointPublicationBundle {
  model: FlashpointRenderedModel;
  auditIssues: FinalReportEvidenceAuditIssue[];
}

export function flashpointEvidenceAuditInput(
  model: FlashpointRenderedModel,
): FinalReportEvidenceAuditInput {
  const ds = model.dataset;
  const win = resolveReportWindow("flashpoint", ds.canonical.issueDate);
  const evidence = ds.canonical.periodRows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    country: row.country,
    location: row.location,
    occurredAt: row.semanticEventDate || format(row.date, "yyyy-MM-dd"),
    severity: row.severity,
    themes: [row.bucket],
  }));
  const developments: FinalReportTypedReference[] = evidence.map((row) => ({
    id: `incident-${row.id}`,
    type: "development",
    text: [row.title, row.summary, row.country, row.location].filter(Boolean).join(" "),
    evidenceId: row.id,
  }));
  const forward: FinalReportTypedReference[] = [
    ...model.forecastRows.map((row) => ({
      id: `forecast-${row.sourceIncidentId}`,
      type: "forward-indicator" as const,
      text: [row.country, row.signal, row.meaning, row.date].filter(Boolean).join(" "),
      evidenceId: row.sourceIncidentId,
    })),
    ...ds.autoWatchNext
      .split(/\n+/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .map((text, index) => ({
        id: `watch-${index}`,
        type: "forward-indicator" as const,
        text,
      })),
    ...(model.protestSchedule?.schedule ?? []).map((row) => ({
      id: `protest-${row.id}`,
      type: "forward-indicator" as const,
      text: [
        row.country,
        row.city,
        row.venue,
        row.eventType,
        row.issue,
        row.organiser,
        row.eventDate,
        row.status,
      ]
        .filter(Boolean)
        .join(" "),
    })),
    ...(model.protestSchedule?.watchlist ?? []).map((row) => ({
      id: `protest-watch-${row.id}`,
      type: "forward-indicator" as const,
      text: [
        row.country,
        row.city,
        row.venue,
        row.eventType,
        row.issue,
        row.organiser,
        row.eventDate,
        row.status,
      ]
        .filter(Boolean)
        .join(" "),
    })),
  ];
  return {
    topic: "flashpoint",
    issueDate: ds.canonical.issueDate,
    window: {
      start: format(win.start, "yyyy-MM-dd"),
      end: format(win.end, "yyyy-MM-dd"),
    },
    evidence,
    sections: { ...model.prose },
    validatedForwardIndicators: forward,
    typedReferences: [...developments, ...forward],
  };
}

function validateProtestSchedule(
  schedule: ProtestScheduleModel,
  issueDate: string,
): FinalReportEvidenceAuditIssue[] {
  const issues: FinalReportEvidenceAuditIssue[] = [];
  const start = new Date(`${issueDate}T00:00:00Z`).getTime();
  const end = start + 7 * 24 * 60 * 60 * 1000;
  for (const row of [...schedule.schedule, ...schedule.watchlist]) {
    if (row.status === "Cancelled" || row.status === "Postponed") {
      issues.push({
        code: "PROTEST_SCHEDULE_STATUS",
        section: "protestSchedule",
        message: `Cancelled or postponed event ${row.id} cannot appear in the active schedule.`,
        level: "ERROR",
      });
    }
    if (row.eventDate) {
      const date = Date.parse(row.eventDate);
      if (!Number.isFinite(date) || date < start || date > end) {
        issues.push({
          code: "PROTEST_SCHEDULE_DATE",
          section: "protestSchedule",
          message: `Event ${row.id} falls outside the report's next-seven-day schedule window.`,
          level: "ERROR",
        });
      }
    }
    if (schedule.schedule.includes(row) && row.status !== "Confirmed" && row.status !== "Planned") {
      issues.push({
        code: "PROTEST_SCHEDULE_STATUS",
        section: "protestSchedule",
        message: `Main schedule event ${row.id} must be Confirmed or Planned.`,
        level: "ERROR",
      });
    }
    if (schedule.watchlist.includes(row) && row.status !== "Possible") {
      issues.push({
        code: "PROTEST_SCHEDULE_STATUS",
        section: "protestSchedule",
        message: `Watchlist event ${row.id} must be Possible.`,
        level: "ERROR",
      });
    }
  }
  return issues;
}

export function validateFlashpointFinalEvidenceAudit(
  model: FlashpointRenderedModel,
): FinalReportEvidenceAuditIssue[] {
  return [
    ...auditFinalReportEvidence(flashpointEvidenceAuditInput(model)),
    ...validateProtestSchedule(model.protestSchedule, model.dataset.canonical.issueDate),
  ];
}

export function finalizeFlashpointPublication(opts: {
  incidents: FlashpointReportIncident[];
  topic?: string;
  issueDate: string;
  report?: FlashpointResolvedProseInput | null;
  ai?: FlashpointResolvedAiInput | null;
  protestSchedule?: ProtestScheduleModel | null;
  renderedModel?: FlashpointRenderedModel;
}): FlashpointPublicationBundle {
  const topic = opts.topic ?? "flashpoint";
  const model =
    opts.renderedModel ??
    resolveFlashpointRenderedModel({
      dataset: buildFlashpointReportDataset(opts.incidents, topic, opts.issueDate),
      report: opts.report,
      ai: opts.ai,
      protestSchedule: opts.protestSchedule,
    });
  return {
    model,
    auditIssues: validateFlashpointFinalEvidenceAudit(model),
  };
}

export function assertFlashpointPublication(bundle: FlashpointPublicationBundle): void {
  assertFlashpointRenderedModelValid(bundle.model);
  const blockingIssues = bundle.auditIssues.filter(isFinalReportIssueBlocking);
  if (blockingIssues.length) {
    throw new FinalReportEvidenceAuditError(blockingIssues);
  }
}
