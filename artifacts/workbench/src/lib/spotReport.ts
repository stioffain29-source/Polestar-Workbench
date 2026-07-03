import type { Incident, SpotReport } from "@workspace/api-client-react";

// Brand palette — mirrors the values used by the other report previews so a
// Spot Report sits visually alongside the scheduled products. Extreme uses the
// reserved subdued red (#A33232); the rest follow the established severity ramp
// used on every map/badge surface in the workbench.
export const NAVY = "#0b0a3d";
export const ELECTRIC = "#465bff";
export const DUSK = "#363636";
export const POLAR = "#e2e2e2";
// Mid neutral gray for de-emphasised / residual ("not reported") categories.
// Sits between DUSK and POLAR so it is clearly distinct from the near-black
// NAVY while staying legible on white. Neutral on purpose — never a risk colour.
export const SLATE = "#6b6b6b";

// Vessel-class composition palette — three CONTRASTING category hues shared by the
// Live Vessel Map legend and the Fleet Composition tiles so the two panels read as
// one system. These encode vessel TYPE (context), never severity: the reserved
// petrol #1B6B7A (Insignificant) and subdued red #A33232 (Extreme) are never used
// for a vessel class. All three are existing category-palette tones, legible on white.
export const VESSEL_TANKER = ELECTRIC; // Electric Blue
export const VESSEL_CARGO = "#E67E22"; // Amber
export const VESSEL_OTHER = "#2A9D8F"; // Teal

export const SPOT_SEV_COLOR: Record<string, string> = {
  extreme: "#A33232",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#1B6B7A",
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
  /** Analyst-typed caption drawn beside the marker on the map. */
  label?: string;
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
        // The analyst-typed label is drawn as text beside the marker on the map.
        label: label || undefined,
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
      errors.push(
        "The incident map is enabled but no coordinates are available to plot. Add coordinates or turn the map off before exporting.",
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

/**
 * Map a spot-report mutation failure to an actionable toast (title + optional
 * description). Spot reports are gated ONLY by the owner session (no admin
 * token), so 401 means the sign-in lapsed. For everything else we surface the
 * server's own `{ error }` message (photo size, validation) so the analyst
 * knows exactly what to fix instead of a bare "Failed to save".
 */
export function spotReportSaveErrorMessage(
  err: unknown,
  action: "create" | "save" | "delete",
): { title: string; description?: string } {
  const status =
    err && typeof err === "object" && typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : undefined;
  const data = err && typeof err === "object" ? (err as { data?: unknown }).data : undefined;
  const serverMsg =
    data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error.trim()
      : undefined;

  const failedTitle =
    action === "create"
      ? "Failed to create"
      : action === "delete"
        ? "Failed to delete"
        : "Failed to save";

  if (status === 401 || status === 403) {
    return {
      title: "Session expired",
      description: "Your sign-in has lapsed. Reload the page, sign in again, then retry.",
    };
  }
  if (status === 413) {
    return {
      title: "Attachments too large",
      description: "The photos exceed the upload limit. Remove or shrink some images, then save again.",
    };
  }
  if (status === 404) {
    return {
      title: "Report not found",
      description: "This spot report may have been deleted elsewhere. Reload the Spot Reports list.",
    };
  }
  if (status === 400) {
    return {
      title: "Check the report before saving",
      description: serverMsg ?? "Some fields are invalid. Check required fields and photo sizes.",
    };
  }
  return {
    title: failedTitle,
    description:
      serverMsg ??
      "The server could not be reached or returned an error. Check your connection and try again.",
  };
}
