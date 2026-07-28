// Assessed-theme synthesis for the shared country/city brief dataset builder.
//
// Every brief now LEADS with two-to-three explicitly ASSESSED themes rather than
// one theme per display category. An assessed theme carries three judgements a
// business reader acts on: WHERE it concentrates, WHAT it exposes, and HOW it is
// trending against the prior-week baseline. Themes are selected by ASSESSED
// VALUE (scoreClusterValue — casualties, disruption, commercial proximity,
// severity-inclusive), not by raw incident count, so one consequential
// development outranks a pile of low-value items.
//
// Pure and deterministic (TYPE-only import of PngReportItem; runtime imports are
// the equally-pure countryIncidentThemes / countryTopValue helpers), so it is
// safe to unit-test directly and carries NO LLM dependency. House rules honoured:
// COUNT-FREE (no record/incident numbers reach the prose), British English,
// five-tier severity vocabulary, and no fabrication — an empty window yields no
// themes and the caller renders its honest "no fresh reporting" caveat.

import type { PngReportItem } from "./pngReportDataset";
import {
  COUNTRY_INCIDENT_THEMES,
  themeForCategory,
  THEME_WHAT,
  THEME_SIGNIFICANCE,
  THEME_AFFECTED,
  topProvinces,
  topCategories,
  categoryNoun,
  leadIncidentSentence,
  joinList,
  type CountryIncidentTheme,
  type CountryIncidentThemeGroup,
} from "./countryIncidentThemes";
import { scoreClusterValue } from "./countryTopValue";

// The trajectory of a theme against the prior-week baseline. "new" = present now
// but absent a week earlier; "nobasis" = no prior window supplied, so no trend
// can be honestly asserted.
export type ThemeTrajectory = "rising" | "easing" | "steady" | "new" | "nobasis";

// One ASSESSED theme leading the brief. Deterministic, count-free.
export interface AssessedTheme {
  key: CountryIncidentTheme;
  heading: string;
  // The real incidents in this theme, ranked most-serious-first.
  items: PngReportItem[];
  // Assessed value (scoreClusterValue) — drives ranking, never printed.
  score: number;
  // Highest severityRank present (5 = Extreme … 1 = Insignificant).
  worstRank: number;
  // WHERE it concentrated — a count-free phrase.
  concentration: string;
  // WHAT it exposes — the business assets/operations at risk (a full sentence).
  businessExposure: string;
  // HOW it is trending against the prior week.
  trajectory: ThemeTrajectory;
  // The full count-free analytical paragraph combining the three judgements.
  narrative: string;
}

// Default number of leading themes (the "two-to-three assessed themes" rule).
export const MAX_ASSESSED_THEMES = 3;

function worstRankOf(items: PngReportItem[]): number {
  return items.reduce((m, it) => Math.max(m, it.severityRank ?? 0), 0);
}

// Trajectory of a theme's CURRENT items against the same theme's BASELINE items.
// Severity move dominates; a >=2-item volume swing breaks a severity tie.
function themeTrajectory(
  current: PngReportItem[],
  baseline: PngReportItem[],
  hasBaseline: boolean,
): ThemeTrajectory {
  if (!hasBaseline) return "nobasis";
  if (baseline.length === 0) return "new";
  const cw = worstRankOf(current);
  const bw = worstRankOf(baseline);
  if (cw > bw) return "rising";
  if (cw < bw) return "easing";
  if (current.length - baseline.length >= 2) return "rising";
  if (baseline.length - current.length >= 2) return "easing";
  return "steady";
}


// A count-free trajectory clause for the narrative paragraph. Names the activity
// rather than asserting a bare "the theme is rising" — the spec bans generic,
// un-anchored trend language, so each clause is tied to the reported activity.
function trajectorySentence(t: ThemeTrajectory): string {
  switch (t) {
    case "rising":
      return "Reporting of this activity picked up against the previous week.";
    case "easing":
      return "Reporting of this activity eased against the previous week.";
    case "steady":
      return "Reporting of this activity held broadly at the previous week's level.";
    case "new":
      return "It was not reported a week earlier, so it reads as newly prominent this period.";
    case "nobasis":
      return "With no prior-week baseline, no week-on-week trend is asserted.";
  }
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// Bucket an item set into the six fixed themes.
function bucketByTheme(
  items: PngReportItem[],
): Map<CountryIncidentTheme, PngReportItem[]> {
  const byTheme = new Map<CountryIncidentTheme, PngReportItem[]>();
  for (const it of items ?? []) {
    const key = themeForCategory(it.category);
    const arr = byTheme.get(key) ?? [];
    arr.push(it);
    byTheme.set(key, arr);
  }
  return byTheme;
}

function rankItems(items: PngReportItem[]): PngReportItem[] {
  return [...items].sort((a, b) => {
    if (b.severityRank !== a.severityRank) return b.severityRank - a.severityRank;
    const ad = a.reportedDate instanceof Date ? a.reportedDate.getTime() : 0;
    const bd = b.reportedDate instanceof Date ? b.reportedDate.getTime() : 0;
    return bd - ad;
  });
}

// The concentration phrase for a theme's items — count-free.
function concentrationPhrase(items: PngReportItem[]): string {
  const provs = topProvinces(items);
  return provs.length
    ? `concentrated in ${joinList(provs)}`
    : "reported across several areas without a single focus";
}

export interface SynthesiseOptions {
  hasBaseline?: boolean;
  max?: number;
}

// Select and assess the leading themes from the window. Ranked by assessed value
// (score desc, then worst severity, then volume, then fixed theme order for a
// stable tie-break), sliced to `max` (default 3). Empty window → [].
export function synthesiseAssessedThemes(
  windowItems: PngReportItem[],
  baselineItems: PngReportItem[],
  opts: SynthesiseOptions = {},
): AssessedTheme[] {
  const hasBaseline = opts.hasBaseline ?? false;
  const max = opts.max ?? MAX_ASSESSED_THEMES;
  const byTheme = bucketByTheme(windowItems);
  const baselineByTheme = bucketByTheme(baselineItems);
  const themeOrder = new Map(
    COUNTRY_INCIDENT_THEMES.map((d, i) => [d.key, i] as const),
  );

  const assessed: AssessedTheme[] = [];
  for (const def of COUNTRY_INCIDENT_THEMES) {
    const items = byTheme.get(def.key);
    if (!items || items.length === 0) continue;
    const ranked = rankItems(items);
    const trajectory = themeTrajectory(
      items,
      baselineByTheme.get(def.key) ?? [],
      hasBaseline,
    );
    const concentration = concentrationPhrase(items);
    const businessExposure = THEME_AFFECTED[def.key];
    const cats = topCategories(items).map(categoryNoun);
    const catClause = cats.length ? `, including ${joinList(cats)}` : "";
    const leadClause = def.key === "fire" ? "" : leadIncidentSentence(items);
    const leadPart = leadClause ? ` ${leadClause}` : "";
    const exposureFragment = lowerFirst(businessExposure).replace(/\.$/, "");
    const narrative = `${THEME_WHAT[def.key]}${catClause}, ${concentration}.${leadPart} ${trajectorySentence(
      trajectory,
    )} This reporting is most relevant to ${exposureFragment}. ${THEME_SIGNIFICANCE[def.key]}`
      .replace(/\s+/g, " ")
      .trim();
    assessed.push({
      key: def.key,
      heading: def.heading,
      items: ranked,
      score: scoreClusterValue(items),
      worstRank: worstRankOf(items),
      concentration,
      businessExposure,
      trajectory,
      narrative,
    });
  }

  assessed.sort(
    (a, b) =>
      b.score - a.score ||
      b.worstRank - a.worstRank ||
      b.items.length - a.items.length ||
      (themeOrder.get(a.key) ?? 0) - (themeOrder.get(b.key) ?? 0),
  );
  return assessed.slice(0, Math.max(1, max));
}

// Render the assessed themes as Incident-Details theme groups (the shared
// renderer / PDF consume CountryIncidentThemeGroup via incidentThemesOverride).
// The paragraph is the assessed narrative, so the section reads as two-to-three
// assessed themes rather than a flat per-category list.
export function buildAssessedThemeGroups(
  windowItems: PngReportItem[],
  baselineItems: PngReportItem[],
  opts: SynthesiseOptions = {},
): CountryIncidentThemeGroup[] {
  return synthesiseAssessedThemes(windowItems, baselineItems, opts).map((t) => {
    const cats = topCategories(t.items).map(categoryNoun);
    return {
      key: t.key,
      heading: t.heading,
      paragraph: t.narrative,
      items: t.items,
      whatHappened: cats.length
        ? `${THEME_WHAT[t.key]}, including ${joinList(cats)}.`
        : `${THEME_WHAT[t.key]}.`,
      where: `Reporting ${t.concentration}.`,
      whyItMatters: trajectorySentence(t.trajectory),
      whatCouldBeAffected: t.businessExposure,
    };
  });
}

