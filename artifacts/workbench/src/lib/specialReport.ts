import type { Incident, SpecialReport } from "@workspace/api-client-react";
import {
  spotSevKey,
  spotLocationLabel,
  toBullets,
  type SpotMapPoint,
} from "./spotReport";

// Special Reports share the Spot Report brand palette, severity ramp, disclaimer
// and pure text helpers — re-exported here so the Special Report components have
// a single import surface and the two products can never drift on colour or
// severity vocabulary.
export {
  NAVY,
  ELECTRIC,
  DUSK,
  POLAR,
  SLATE,
  SPOT_SEV_COLOR as SEV_COLOR,
  SPOT_SEV_LABEL as SEV_LABEL,
  spotSevKey as sevKey,
  spotLocationLabel as specialLocationLabel,
  toBullets,
  DISCLAIMER_TEXT,
  spotReportSaveErrorMessage as specialReportSaveErrorMessage,
  type SpotMapPoint as SpecialMapPoint,
} from "./spotReport";

export const SPECIAL_STATUSES = ["draft", "final"] as const;

/**
 * Resolve the points to plot on the incident map. Mirrors buildSpotMapPoints:
 * the report's own coordinates (if set) are the PRIMARY point; every linked
 * incident that carries coordinates is a related point; analyst-placed extra
 * markers (report.mapPoints) plot alongside, inheriting the report severity
 * colour when they carry none. Records without coordinates are kept but not
 * plotted.
 */
export function buildSpecialMapPoints(
  report: SpecialReport,
  incidents: Incident[],
): SpotMapPoint[] {
  const points: SpotMapPoint[] = [];
  if (typeof report.latitude === "number" && typeof report.longitude === "number") {
    points.push({
      key: "primary",
      lat: report.latitude,
      lng: report.longitude,
      severity: spotSevKey(report.severity),
      title: spotLocationLabel(report) || report.title,
      primary: true,
    });
  }
  for (const i of incidents) {
    if (typeof i.latitude === "number" && typeof i.longitude === "number") {
      points.push({
        key: `i-${i.id}`,
        lat: i.latitude,
        lng: i.longitude,
        severity: spotSevKey(i.severity),
        title: (i.displayTitle?.trim() || i.title || "Incident").trim(),
        primary: false,
      });
    }
  }
  const manualPoints = report.mapPoints ?? [];
  manualPoints.forEach((m, idx) => {
    if (typeof m.lat === "number" && typeof m.lng === "number") {
      const label = (m.label ?? "").trim();
      const severity = spotSevKey(m.severity) || spotSevKey(report.severity);
      points.push({
        key: `m-${idx}`,
        lat: m.lat,
        lng: m.lng,
        severity,
        title: label || spotLocationLabel(report) || report.title,
        primary: false,
        label: label || undefined,
      });
    }
  });
  return points;
}

export interface SpecialSection {
  heading: string;
  body: string;
  /** Recommended Actions renders as bullets in every surface. */
  bullets?: boolean;
}

/**
 * The ordered narrative sections — single source of truth for the on-screen
 * preview AND every export so they can never disagree. Only sections with
 * content are returned.
 */
export function specialReportSections(report: SpecialReport): SpecialSection[] {
  const defs: Array<{ heading: string; body?: string | null; bullets?: boolean }> = [
    { heading: "Bottom Line Up Front", body: report.bluf },
    { heading: "Incident Details", body: report.incidentDetails },
    { heading: "Current Situation", body: report.currentSituation },
    { heading: "Operational Impact", body: report.operationalImpact },
    { heading: "Polestar View", body: report.assessment },
    { heading: "Outlook (24\u201372h)", body: report.outlook },
    { heading: "Recommended Actions", body: report.recommendedActions, bullets: true },
  ];
  return defs
    .filter((d) => (d.body ?? "").trim().length > 0)
    .map((d) => ({ heading: d.heading, body: (d.body ?? "").trim(), bullets: d.bullets }));
}

export interface QualityResult {
  errors: string[];
  warnings: string[];
}

/**
 * Pre-export quality check. ERRORS block a client-facing export (critical fields
 * missing); WARNINGS are advisory (non-blocking) and can be overridden. Mirrors
 * the Spot Report gate, plus a check that every manually-entered chart has a
 * title and at least one point.
 */
export function checkSpecialReportQuality(
  report: SpecialReport,
  incidents: Incident[],
): QualityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!report.title?.trim()) errors.push("Title is required.");
  if (!report.bluf?.trim()) errors.push("Bottom Line Up Front (BLUF) is required.");
  if (!spotLocationLabel(report)) {
    errors.push("A location (country, province, or town) is required.");
  }
  if (!report.severity) errors.push("A severity rating is required.");
  if (!report.assessment?.trim()) errors.push("Polestar View is required.");
  if (!report.recommendedActions?.trim()) {
    errors.push("Recommended actions are required.");
  }

  if (report.mapEnabled) {
    const hasReportCoords =
      typeof report.latitude === "number" && typeof report.longitude === "number";
    const hasIncidentCoords = incidents.some(
      (i) => typeof i.latitude === "number" && typeof i.longitude === "number",
    );
    if (!hasReportCoords && !hasIncidentCoords) {
      errors.push(
        "The incident map is enabled but no coordinates are available to plot. Add coordinates or turn the map off before exporting.",
      );
    }
  }

  const charts = report.charts ?? [];
  charts.forEach((c, idx) => {
    const points = (c.points ?? []).filter((p) => (p.label ?? "").trim());
    if (points.length === 0) {
      warnings.push(
        `Chart ${idx + 1}${c.title ? ` (“${c.title}”)` : ""} has no data points and will not render.`,
      );
    }
  });

  const ids = report.linkedIncidentIds ?? [];
  if (new Set(ids).size !== ids.length) {
    warnings.push("The same incident is linked more than once.");
  }
  const resolved = new Set(incidents.map((i) => i.id));
  if (ids.some((id) => !resolved.has(id))) {
    warnings.push("A linked incident could not be found and may have been deleted.");
  }

  if (!report.currentSituation?.trim()) warnings.push("Current Situation is empty.");
  if (!report.outlook?.trim()) warnings.push("Outlook (24\u201372h) is empty.");

  return { errors, warnings };
}
