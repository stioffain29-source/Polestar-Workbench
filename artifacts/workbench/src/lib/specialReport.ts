import type {
  Incident,
  SpecialReport,
  SpecialReportBlock,
} from "@workspace/api-client-react";
import {
  spotSevKey,
  spotLocationLabel,
  toBullets,
  type SpotMapPoint,
} from "./spotReport";

export type { SpecialReportBlock } from "@workspace/api-client-react";

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

/**
 * The single authority that turns a report into the ordered block list every
 * surface renders. Saved blocks win; a never-migrated (legacy) row is
 * synthesised from its fixed narrative/map/chart/photo/incident fields in the
 * exact order the pre-block preview used, so old rows look unchanged and there
 * is only ever ONE renderer (preview == PDF). Pure — no data is duplicated:
 * the map and incidents blocks are singleton references that render from the
 * report-level coordinates / linkedIncidentIds at draw time.
 */
export function resolveSpecialReportBlocks(
  report: SpecialReport,
): SpecialReportBlock[] {
  const saved = report.blocks ?? [];
  if (saved.length > 0) return saved;

  const blocks: SpecialReportBlock[] = [];
  const sections = specialReportSections(report);
  const bluf = sections.find((s) => s.heading === "Bottom Line Up Front");
  const others = sections.filter((s) => s !== bluf);
  const photos = (report.photos ?? []).filter((p) => p && p.dataUrl);
  const charts = (report.charts ?? []).filter((c) =>
    (c.points ?? []).some((p) => (p.label ?? "").trim().length > 0),
  );

  let n = 0;
  const pushSection = (s: SpecialSection) => {
    blocks.push({ id: `legacy-h-${n}`, type: "heading", text: s.heading });
    blocks.push({
      id: `legacy-b-${n}`,
      type: s.bullets ? "bullets" : "text",
      body: s.body,
    });
    n += 1;
  };
  const pushImagery = () => {
    if (photos.length === 0) return;
    blocks.push({ id: "legacy-h-img", type: "heading", text: "Imagery" });
    photos.forEach((p, i) =>
      blocks.push({
        id: `legacy-img-${i}`,
        type: "image",
        dataUrl: p.dataUrl,
        caption: (p.caption ?? "").trim() || undefined,
      }),
    );
  };

  if (bluf) pushSection(bluf);
  if (report.mapEnabled) {
    blocks.push({ id: "legacy-h-map", type: "heading", text: "Location Map" });
    blocks.push({ id: "legacy-map", type: "map" });
  }
  const hasIncidentDetails = others.some((s) => s.heading === "Incident Details");
  if (!hasIncidentDetails) pushImagery();
  for (const s of others) {
    pushSection(s);
    if (s.heading === "Incident Details") pushImagery();
  }
  if (charts.length > 0) {
    blocks.push({ id: "legacy-h-charts", type: "heading", text: "Charts" });
    charts.forEach((c, i) =>
      blocks.push({ id: `legacy-chart-${i}`, type: "chart", chart: c }),
    );
  }
  if ((report.linkedIncidentIds ?? []).length > 0) {
    blocks.push({
      id: "legacy-h-inc",
      type: "heading",
      text: "Reference Incidents",
    });
    blocks.push({ id: "legacy-inc", type: "incidents" });
  }
  return blocks;
}

export interface QualityResult {
  errors: string[];
  warnings: string[];
}

/**
 * Pre-export quality check. Special Reports are FREE-FORM: the analyst composes
 * the body from whatever blocks they choose, so the ONLY hard requirement is a
 * title (it names the report in lists and the export filename). A map block with
 * no plottable coordinates stays an ERROR because it exports a broken-looking
 * empty base map. Everything else is an advisory WARNING (non-blocking).
 */
export function checkSpecialReportQuality(
  report: SpecialReport,
  incidents: Incident[],
): QualityResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const blocks = resolveSpecialReportBlocks(report);

  if (!report.title?.trim()) errors.push("Title is required.");

  const hasMapBlock = blocks.some((b) => b.type === "map");
  if (hasMapBlock) {
    const hasReportCoords =
      typeof report.latitude === "number" && typeof report.longitude === "number";
    const hasIncidentCoords = incidents.some(
      (i) => typeof i.latitude === "number" && typeof i.longitude === "number",
    );
    const hasManualPoints = (report.mapPoints ?? []).some(
      (m) => typeof m.lat === "number" && typeof m.lng === "number",
    );
    if (!hasReportCoords && !hasIncidentCoords && !hasManualPoints) {
      errors.push(
        "A map block is present but no coordinates are available to plot. Add coordinates or remove the map block before exporting.",
      );
    }
  }

  blocks.forEach((b, idx) => {
    if (b.type === "chart") {
      const points = (b.chart?.points ?? []).filter((p) => (p.label ?? "").trim());
      if (points.length === 0) {
        warnings.push(
          `Chart block ${idx + 1}${b.chart?.title ? ` (“${b.chart.title}”)` : ""} has no data points and will not render.`,
        );
      }
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

  if (blocks.length === 0) {
    warnings.push("The report has no content blocks yet.");
  }

  return { errors, warnings };
}
