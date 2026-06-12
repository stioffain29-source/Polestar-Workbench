import type { Incident, SpotReport } from "@workspace/api-client-react";

// Brand palette — mirrors the values used by the other report previews so a
// Spot Report sits visually alongside the scheduled products. Extreme uses the
// reserved subdued red (#A33232); the rest follow the established severity ramp
// used on every map/badge surface in the workbench.
export const NAVY = "#0b0a3d";
export const ELECTRIC = "#465bff";
export const DUSK = "#363636";
export const POLAR = "#e2e2e2";

export const SPOT_SEV_COLOR: Record<string, string> = {
  extreme: "#A33232",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#B8C2CC",
};

export const SPOT_SEV_LABEL: Record<string, string> = {
  extreme: "Extreme",
  high: "High",
  moderate: "Moderate",
  low: "Low",
  insignificant: "Insignificant",
};

export function spotSevKey(s?: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

export const SPOT_STATUSES = ["draft", "final"] as const;

export const DISCLAIMER_TEXT =
  "Polestar Advisory Pte. Ltd. is an independent company registered in Singapore. " +
  "The information in this report is based on open sources and is assessed as accurate at the time of writing. " +
  "It is provided for general informational purposes only and does not constitute advice or a comprehensive " +
  "assessment of all risks. No reliance should be placed on this information for decision making without " +
  "further independent verification.";

/** Human-readable location line from the granular location fields. */
export function spotLocationLabel(report: {
  city?: string | null;
  province?: string | null;
  country?: string | null;
}): string {
  return [report.city, report.province, report.country]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export interface SpotMapPoint {
  key: string;
  lat: number;
  lng: number;
  severity: string;
  title: string;
  primary: boolean;
}

/**
 * Resolve the points to plot on the incident map. The report's own coordinates
 * (if set) are the PRIMARY point; every linked incident that carries
 * coordinates is a related point. Records without coordinates are kept in the
 * report but not plotted.
 */
export function buildSpotMapPoints(
  report: SpotReport,
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
  // Analyst-placed extra markers (report.mapPoints). Each carries its own
  // coordinates and an optional label/severity; a point with no severity
  // inherits the report's severity colour. These plot alongside the primary
  // point and any linked incidents.
  const manualPoints = report.mapPoints ?? [];
  manualPoints.forEach((m, idx) => {
    if (typeof m.lat === "number" && typeof m.lng === "number") {
      const label = (m.label ?? "").trim();
      // A point with no (or blank) severity inherits the report's severity
      // colour — `||` rather than `??` so an empty-string severity also falls
      // back instead of rendering the off-palette neutral fallback.
      const severity = spotSevKey(m.severity) || spotSevKey(report.severity);
      points.push({
        key: `m-${idx}`,
        lat: m.lat,
        lng: m.lng,
        severity,
        title: label || spotLocationLabel(report) || report.title,
        primary: false,
      });
    }
  });
  return points;
}

export interface SpotSection {
  heading: string;
  body: string;
  /** Recommended Actions renders as bullets in every surface. */
  bullets?: boolean;
}

/**
 * The ordered narrative sections, single source of truth for the on-screen
 * preview AND every export (PDF/Word/text) so they can never disagree. Only
 * sections with content are returned.
 */
export function spotReportSections(report: SpotReport): SpotSection[] {
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

/** Split free text into bullet items (mirrors the report preview helpers). */
export function toBullets(text?: string | null, max = 12): string[] {
  const s = (text ?? "").trim();
  if (!s) return [];
  const marked = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^([-*\u2022])\s+/.test(l))
    .map((l) => l.replace(/^([-*\u2022])\s+/, "").trim())
    .filter(Boolean);
  let out: string[];
  if (marked.length > 0) out = marked;
  else
    out = s
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  return out.slice(0, max);
}

export interface QualityResult {
  errors: string[];
  warnings: string[];
}

/**
 * Pre-export quality check. ERRORS block a client-facing export (critical fields
 * missing); WARNINGS are advisory (non-blocking) and can be overridden.
 */
export function checkSpotReportQuality(
  report: SpotReport,
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
      warnings.push(
        "The incident map is enabled but no coordinates are available to plot.",
      );
    }
  }

  const ids = report.linkedIncidentIds ?? [];
  if (new Set(ids).size !== ids.length) {
    warnings.push("The same incident is linked more than once.");
  }
  const resolved = new Set(incidents.map((i) => i.id));
  if (ids.some((id) => !resolved.has(id))) {
    warnings.push("A linked incident could not be found and may have been deleted.");
  }

  const reportTime = new Date(report.reportDate).getTime();
  const STALE_MS = 30 * 24 * 60 * 60 * 1000;
  const stale = incidents.some(
    (i) => reportTime - new Date(i.occurredAt).getTime() > STALE_MS,
  );
  if (stale) {
    warnings.push(
      "A linked incident occurred more than 30 days before the report date and may be stale.",
    );
  }

  if (!report.currentSituation?.trim()) warnings.push("Current Situation is empty.");
  if (!report.outlook?.trim()) warnings.push("Outlook (24\u201372h) is empty.");

  return { errors, warnings };
}
