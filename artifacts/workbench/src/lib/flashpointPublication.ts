/**
 * Flashpoint adapter for the shared final-report evidence audit.
 * Preview and PDF must call finalizeFlashpointPublication so they cannot
 * diverge. The auditor itself stays topic-agnostic.
 */
import { format } from "date-fns";
import {
  auditFinalReportEvidence,
  FinalReportEvidenceAuditError,
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
    ...ds.forecastFuture.map((row) => ({
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

export function validateFlashpointFinalEvidenceAudit(
  model: FlashpointRenderedModel,
): FinalReportEvidenceAuditIssue[] {
  return auditFinalReportEvidence(flashpointEvidenceAuditInput(model));
}

export function finalizeFlashpointPublication(opts: {
  incidents: FlashpointReportIncident[];
  topic?: string;
  issueDate: string;
  report?: FlashpointResolvedProseInput | null;
  ai?: FlashpointResolvedAiInput | null;
  renderedModel?: FlashpointRenderedModel;
}): FlashpointPublicationBundle {
  const topic = opts.topic ?? "flashpoint";
  const model =
    opts.renderedModel ??
    resolveFlashpointRenderedModel({
      dataset: buildFlashpointReportDataset(opts.incidents, topic, opts.issueDate),
      report: opts.report,
      ai: opts.ai,
    });
  return {
    model,
    auditIssues: validateFlashpointFinalEvidenceAudit(model),
  };
}

export function assertFlashpointPublication(bundle: FlashpointPublicationBundle): void {
  assertFlashpointRenderedModelValid(bundle.model);
  if (bundle.auditIssues.length) {
    throw new FinalReportEvidenceAuditError(bundle.auditIssues);
  }
}
