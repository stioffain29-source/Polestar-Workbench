// Durable analyst layout controls for the TOPIC reports (flashpoint, shipping,
// cargo, conflict, fuel and the generic energy/fertiliser topics). Mirrors the
// country brief's countrySectionOverrides.ts pattern so the two report families
// behave identically:
//
//   - hiddenSections      — canonical report sections dropped from BOTH the
//                           on-screen preview AND the DOM/jsPDF export, in
//                           lockstep (they gate on the SAME section keys).
//   - excludedIncidentIds — relevance-passing window incidents removed from the
//                           report. STRICT no-fabrication: the analyst can only
//                           exclude from the pool that already passed relevance,
//                           never add a hand-placed incident.
//   - severityDemotions   — DEMOTE-ONLY severity corrections (incident id -> a
//                           lower tier). An entry can only reduce an incident's
//                           severity below its stored tier; a raise is ignored.
//
// These persist per-report in reports.section_overrides (jsonb) and are applied
// to the shared incidentsForExport pool in ReportEditor BEFORE any topic dataset
// builder runs, so exclude/demote flows uniformly to every preview and PDF.

// The incident-curation helpers are identical to the country brief's, so we
// re-export them rather than duplicate the demote-guard logic.
export {
  applyIncidentCurations,
  type CountrySectionOverrides as TopicSectionOverrides,
} from "./countrySectionOverrides";

// The hideable canonical sections per topic, in render order. Keys are stable
// identifiers decoupled from the display title (so re-titling never orphans a
// saved override). Cover and Disclaimer are deliberately NOT hideable. Each
// key here MUST be gated in the matching preview component AND its PDF exporter
// (or the DOM-rasterised export) so preview == PDF.
export const TOPIC_SECTION_KEYS: Record<
  string,
  ReadonlyArray<{ key: string; label: string }>
> = {
  flashpoint: [
    { key: "executive-summary", label: "Executive Summary" },
    { key: "fast-facts", label: "Fast Facts" },
    { key: "activism", label: "Activism and Protest Read" },
    { key: "civil-unrest", label: "Civil Unrest and Public Order Read" },
    { key: "forecast", label: "Forecast: Next 7\u201314 Days" },
    { key: "regional", label: "Regional and Country View" },
    { key: "what-matters", label: "What Matters" },
    { key: "implications", label: "Implications for Business" },
    { key: "watch-next", label: "Watch Next" },
    { key: "polestar-view", label: "Polestar View" },
    { key: "related-incidents", label: "Related Incidents" },
  ],
  shipping: [
    { key: "maritime-intelligence", label: "Maritime Intelligence" },
    { key: "executive-summary", label: "Executive Summary" },
    { key: "fast-facts", label: "Fast Facts" },
    { key: "chokepoint-route", label: "Chokepoint / Route Read" },
    { key: "vessel-piracy", label: "Vessel Threat and Piracy Read" },
    { key: "maritime-security", label: "Maritime Security (ICC CCS / IMB)" },
    { key: "commercial-impact", label: "Commercial Impact on Shipping" },
    { key: "regional", label: "Regional and Country View" },
    { key: "what-matters", label: "What Matters" },
    { key: "implications", label: "Implications for Business" },
    { key: "watch-next", label: "Watch Next" },
    { key: "polestar-view", label: "Polestar View" },
    { key: "related-incidents", label: "Related Incidents" },
  ],
  conflict: [
    { key: "situation", label: "Situation" },
    { key: "fast-facts", label: "Fast Facts" },
    { key: "top-activity-areas", label: "Top Activity Areas" },
    { key: "other-watched", label: "Other Watched Theatres" },
    { key: "what-matters", label: "What Matters for Business" },
    { key: "watch-next", label: "Watch Next" },
    { key: "polestar-view", label: "Polestar View" },
    { key: "related-incidents", label: "Related Incidents" },
  ],
  cargo_watch: [
    { key: "executive-summary", label: "Executive Summary" },
    { key: "fast-facts", label: "Fast Facts" },
    { key: "map", label: "Activity Map" },
    { key: "weekly-trend", label: "Weekly Trend and Activity" },
    { key: "enforcement", label: "Enforcement Activity" },
    { key: "situation", label: "Situation" },
    { key: "what-matters", label: "What Matters" },
    { key: "implications", label: "Implications" },
    { key: "watch-next", label: "Watch Next" },
    { key: "key-incidents", label: "Key Incidents" },
    { key: "polestar-view", label: "Polestar View" },
    { key: "incident-annex", label: "Incident Annex" },
  ],
  fuel: [
    { key: "executive-summary", label: "Executive Summary" },
    { key: "fast-facts", label: "Fast Facts" },
    { key: "jet-fuel-trajectory", label: "Jet Fuel Price Trajectory" },
    { key: "market-read", label: "Market Read" },
    { key: "situation", label: "Situation" },
    { key: "what-happened", label: "What Happened" },
    { key: "operational-read", label: "Operational Read" },
    { key: "regional-highlights", label: "Regional Highlights" },
    { key: "gulf-hormuz", label: "Gulf and Hormuz Chokepoint Watch" },
    { key: "producer-buyer", label: "Producer and Buyer Actions" },
    { key: "what-matters", label: "What Matters" },
    { key: "implications", label: "Implications for Business" },
    { key: "watch-next", label: "Watch Next" },
    { key: "polestar-view", label: "Polestar View" },
  ],
  generic: [
    { key: "executive-summary", label: "Executive Summary" },
    { key: "fast-facts", label: "Fast Facts" },
    { key: "market-prices", label: "Market Prices" },
    { key: "situation", label: "Situation" },
    { key: "what-happened", label: "What Happened" },
    { key: "what-matters", label: "What Matters" },
    { key: "implications", label: "Implications for Business" },
    { key: "watch-next", label: "Watch Next" },
    { key: "polestar-view", label: "Polestar View" },
    { key: "related-incidents", label: "Related Incidents" },
  ],
};

// The editor curation panel keys off the report topic. protests shares the
// flashpoint layout; energy/fertiliser and any other news topic share the
// generic layout.
export function topicSectionKeys(
  topic: string | null | undefined,
): ReadonlyArray<{ key: string; label: string }> {
  const t = (topic ?? "").trim();
  if (t === "protests") return TOPIC_SECTION_KEYS.flashpoint;
  return TOPIC_SECTION_KEYS[t] ?? TOPIC_SECTION_KEYS.generic;
}

// Convenience gate for a preview/PDF: a section is visible unless its key is in
// the hidden list.
export function makeSectionGate(
  hiddenSections: string[] | null | undefined,
): (key: string) => boolean {
  const hidden = new Set(hiddenSections ?? []);
  return (key: string) => !hidden.has(key);
}
