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
export { applyIncidentCurations } from "./countrySectionOverrides";
import type { CountrySectionOverrides } from "./countrySectionOverrides";

// Per-tile Fast Facts override. Keyed by the tile's AUTO label (stable per
// topic — e.g. "Total Records", "Highest Severity"), so a saved override
// re-attaches to the same tile even as the computed value changes week to
// week. Blank/absent fields fall back to the computed auto value — clearing
// an override always reverts to auto (STRICT no-fabrication: overrides only
// replace displayed text the owner typed, they never invent tiles).
export interface FastFactOverride {
  label?: string;
  value?: string;
  note?: string;
}

// Per-row Market Prices override, keyed "group:key" (e.g. "energy:brent").
export interface MarketPriceOverride {
  value?: string;
  change?: string;
}

export interface TopicSectionOverrides extends CountrySectionOverrides {
  /** Fast Facts tile overrides keyed by the tile's AUTO label. */
  fastFactOverrides?: Record<string, FastFactOverride>;
  /** Free-text overrides for hard-wired panels, keyed by the panel's stable
   *  section key (currently: "gulf-hormuz" — the Fuel Watch Gulf and Hormuz
   *  Chokepoint Watch read). Blank/absent = live auto text (pickRead). */
  panelReads?: Record<string, string>;
  /** Market Prices table row overrides keyed "group:key". */
  marketPriceOverrides?: Record<string, MarketPriceOverride>;
}

/** Stable panel key for the Fuel Watch Gulf & Hormuz Chokepoint Watch read. */
export const PANEL_READ_GULF_HORMUZ = "gulf-hormuz";

/**
 * Apply Fast Facts overrides to a computed card list. Works on every card
 * shape in the codebase ({label, value, note?, ...extras}) — extras such as
 * severity/accent pass through untouched so the accent strip still reflects
 * the underlying data. Match is by AUTO label; a non-blank override field
 * replaces the computed one, blank fields keep the auto text.
 */
export function applyFastFactOverrides<
  T extends { label: string; value: string; note?: string },
>(
  cards: T[],
  overrides: Record<string, FastFactOverride> | null | undefined,
): T[] {
  if (!overrides || Object.keys(overrides).length === 0) return cards;
  return cards.map((c) => {
    const ov = overrides[c.label];
    if (!ov) return c;
    const label = (ov.label ?? "").trim();
    const value = (ov.value ?? "").trim();
    const note = (ov.note ?? "").trim();
    if (!label && !value && !note) return c;
    return {
      ...c,
      label: label || c.label,
      value: value || c.value,
      ...(note ? { note } : {}),
    };
  });
}

/**
 * Apply Market Prices row overrides. Row identity is "group:key". The value
 * override must parse as a finite number (the card formats numerics); a
 * non-numeric value override is ignored rather than rendering garbage.
 */
export function applyMarketPriceOverrides<
  T extends { group: string; key: string; value: number; change?: string | null },
>(
  rows: T[],
  overrides: Record<string, MarketPriceOverride> | null | undefined,
): T[] {
  if (!overrides || Object.keys(overrides).length === 0) return rows;
  return rows.map((r) => {
    const ov = overrides[`${r.group}:${r.key}`];
    if (!ov) return r;
    const out = { ...r };
    const v = (ov.value ?? "").trim();
    if (v) {
      const n = Number(v);
      if (Number.isFinite(n)) out.value = n;
    }
    const ch = (ov.change ?? "").trim();
    if (ch) out.change = ch;
    return out;
  });
}

/**
 * Find Fast Facts override keys that no longer match any current auto tile
 * label. Happens when a dataset builder renames a tile: the saved override is
 * still persisted but silently stops applying (applyFastFactOverrides matches
 * by exact auto label). The editor surfaces these so the owner can re-attach
 * the edit to a current tile or clear it — nothing is migrated silently.
 */
export function orphanedFastFactOverrideKeys(
  cards: ReadonlyArray<{ label: string }>,
  overrides: Record<string, FastFactOverride> | null | undefined,
): string[] {
  if (!overrides) return [];
  const live = new Set(cards.map((c) => c.label));
  return Object.keys(overrides).filter((k) => !live.has(k));
}

/**
 * Re-key a Fast Facts override from an orphaned auto-label key to a current
 * tile's auto label. Pure/immutable. If the target tile already has an
 * override, the orphan's non-blank fields fill only the target's blank fields
 * (existing owner edits on the target are never overwritten). Returns the
 * input unchanged if the orphan key is absent or from === to.
 */
export function reattachFastFactOverride(
  overrides: Record<string, FastFactOverride> | null | undefined,
  from: string,
  to: string,
): Record<string, FastFactOverride> {
  const src = overrides ?? {};
  const orphan = src[from];
  if (!orphan || from === to) return src;
  const out: Record<string, FastFactOverride> = { ...src };
  delete out[from];
  const existing = out[to] ?? {};
  out[to] = {
    ...(existing.label?.trim() ? { label: existing.label } : orphan.label?.trim() ? { label: orphan.label } : {}),
    ...(existing.value?.trim() ? { value: existing.value } : orphan.value?.trim() ? { value: orphan.value } : {}),
    ...(existing.note?.trim() ? { note: existing.note } : orphan.note?.trim() ? { note: orphan.note } : {}),
  };
  return out;
}

/** Remove a Fast Facts override entry entirely (clear an orphan). Pure. */
export function clearFastFactOverride(
  overrides: Record<string, FastFactOverride> | null | undefined,
  key: string,
): Record<string, FastFactOverride> {
  const src = overrides ?? {};
  if (!(key in src)) return src;
  const out = { ...src };
  delete out[key];
  return out;
}

/**
 * Drop blank entries so the persisted jsonb holds only genuine overrides —
 * an all-blank tile/row entry is removed entirely (clearing = revert to auto).
 */
export function pruneTopicSectionOverrides(
  ov: TopicSectionOverrides,
): TopicSectionOverrides {
  const out: TopicSectionOverrides = {};
  if (ov.hiddenSections?.length) out.hiddenSections = ov.hiddenSections;
  if (ov.excludedIncidentIds?.length)
    out.excludedIncidentIds = ov.excludedIncidentIds;
  if (ov.severityDemotions && Object.keys(ov.severityDemotions).length)
    out.severityDemotions = ov.severityDemotions;
  const ff: Record<string, FastFactOverride> = {};
  for (const [k, v] of Object.entries(ov.fastFactOverrides ?? {})) {
    const label = (v.label ?? "").trim();
    const value = (v.value ?? "").trim();
    const note = (v.note ?? "").trim();
    if (!label && !value && !note) continue;
    ff[k] = {
      ...(label ? { label } : {}),
      ...(value ? { value } : {}),
      ...(note ? { note } : {}),
    };
  }
  if (Object.keys(ff).length) out.fastFactOverrides = ff;
  const pr: Record<string, string> = {};
  for (const [k, v] of Object.entries(ov.panelReads ?? {})) {
    if ((v ?? "").trim()) pr[k] = v;
  }
  if (Object.keys(pr).length) out.panelReads = pr;
  const mp: Record<string, MarketPriceOverride> = {};
  for (const [k, v] of Object.entries(ov.marketPriceOverrides ?? {})) {
    const value = (v.value ?? "").trim();
    const change = (v.change ?? "").trim();
    if (!value && !change) continue;
    mp[k] = { ...(value ? { value } : {}), ...(change ? { change } : {}) };
  }
  if (Object.keys(mp).length) out.marketPriceOverrides = mp;
  return out;
}

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
    // Key stays "producer-buyer" — section-override keys are stable
    // identifiers persisted in saved reports; only the label renames.
    { key: "producer-buyer", label: "Market and Operator Responses" },
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
