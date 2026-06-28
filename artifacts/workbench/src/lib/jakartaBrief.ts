// Jakarta-specific brief builders for the shared country-report dataset.
//
// Pure, dependency-free (TYPE-only imports, so it carries no runtime dependency
// on the ingest barrel) and therefore safe to unit-test directly. Gated behind
// JAKARTA_REPORT_CONFIG.jakartaProse so the Indonesia / PNG / West Papua
// theatres are byte-identical — these builders are ONLY reached for Jakarta.
//
// House rules honoured here: COUNT-FREE (no record/incident numbers ever appear
// in the generated prose), British English, the five-tier severity vocabulary
// (Insignificant, Low, Moderate, High, Extreme), and NO fabrication — every
// section is gated on the themes that ACTUALLY occurred this period; an empty
// window yields a standing-assessment judgement, never an invented "all clear".
//
// The output reads as a Jakarta security brief written by an analyst (the
// authoritative spec), not a category summary generated from database fields.

import type { PngReportItem, PngCategory } from "./pngReportDataset";
import type { PolestarViewParts } from "./countryPolestarView";

// The Jakarta operating-picture themes, in fixed display order. Deliberately
// fewer, stronger labels than the generic category list — focused on what
// actually shapes operations in the capital.
export type JakartaTheme =
  | "protest"
  | "flooding"
  | "crime"
  | "traffic"
  | "airport"
  | "governance";

export const JAKARTA_THEME_ORDER: JakartaTheme[] = [
  "protest",
  "flooding",
  "crime",
  "traffic",
  "airport",
  "governance",
];

const JAKARTA_THEME_HEADING: Record<JakartaTheme, string> = {
  protest: "Protests and demonstrations",
  flooding: "Flooding and weather disruption",
  crime: "Crime and public safety",
  traffic: "Traffic and movement disruption",
  airport: "Airport corridor",
  governance: "Policing and regulatory activity",
};

// Short client-facing phrase per theme, used in the BLUF / Current Situation /
// Outlook sentences (lower-case, mid-sentence).
const JAKARTA_THEME_PHRASE: Record<JakartaTheme, string> = {
  protest: "protest activity",
  flooding: "flooding and heavy rain",
  crime: "opportunistic crime",
  traffic: "traffic disruption",
  airport: "airport-corridor disruption",
  governance: "policing activity",
};

// Lead phrase for a Top-3 analyst-development title (e.g. "Protest activity in
// Central Jakarta"). Derived from the incident's category + area — both real
// data fields — so the rewritten title is an analyst development, not an
// article headline, without inventing specifics.
const JAKARTA_THEME_LEAD: Record<JakartaTheme, string> = {
  protest: "Protest activity",
  flooding: "Flooding and weather disruption",
  crime: "Crime and public-safety incident",
  traffic: "Traffic and movement disruption",
  airport: "Airport-corridor disruption",
  governance: "Policing and security activity",
};

// Operational "why it matters" line for a Top-3 development, per theme. Sets the
// card body so every Top-3 item explains its operational relevance (spec §1).
const JAKARTA_THEME_RELEVANCE: Record<JakartaTheme, string> = {
  protest:
    "Demonstrations here can close roads and slow access around government buildings and central business districts; confirm routes and timings before travel.",
  flooding:
    "Standing water on this corridor can lengthen commuting, site access and airport-transfer times; check affected routes before staff move.",
  crime:
    "Reporting supports continued caution around after-hours movement and exposed public areas near offices, hotels and transport hubs.",
  traffic:
    "Congestion on this corridor is a planning constraint for meetings, deliveries and airport transfers; build in time buffers.",
  airport:
    "Disruption here can extend transfers between the city and Soekarno-Hatta; allow additional buffer on airport runs.",
  governance:
    "Security-force activity here can briefly restrict movement and access around the affected area; verify locally before travel.",
};

const CATEGORY_JAKARTA_THEME: Record<PngCategory, JakartaTheme> = {
  "Terrorism / militancy": "crime",
  "Armed robbery / hold-up": "crime",
  "Tribal / communal violence": "crime",
  "Homicide / violent crime": "crime",
  "Theft / break-in": "crime",
  Fire: "crime",
  "Civil unrest / protest": "protest",
  "Labour action": "protest",
  "Policing operation": "governance",
  "Community policing": "governance",
  "Intelligence / training": "governance",
  "Corrections / detention": "governance",
  "Government stability": "governance",
  "Aviation / airport": "airport",
  "Maritime / port": "traffic",
  "Road / highway": "traffic",
  "Power / utilities": "traffic",
  "Telecoms / connectivity": "traffic",
  "Natural hazard": "flooding",
  "Environmental / haze": "flooding",
  "Other security": "crime",
};

export function jakartaThemeForCategory(category: PngCategory): JakartaTheme {
  return CATEGORY_JAKARTA_THEME[category] ?? "crime";
}

// --- small pure helpers ----------------------------------------------------

function joinList(parts: string[]): string {
  const xs = parts.filter((p) => p.trim().length > 0);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0]!;
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

// Friendly area label from the resolved province bucket. "Greater Jakarta
// (Jabodetabek)" is shortened; an unattributed record yields "".
function areaLabel(province: string | null): string {
  if (!province) return "";
  if (province.startsWith("Greater Jakarta")) return "Greater Jakarta";
  return province;
}

// The distinct friendly areas present in a set of items, in first-seen order,
// capped so the prose stays tight.
function presentAreas(items: PngReportItem[], cap = 3): string[] {
  const seen: string[] = [];
  for (const it of items) {
    const a = areaLabel(it.province);
    if (a && !seen.includes(a)) seen.push(a);
    if (seen.length >= cap) break;
  }
  return seen;
}

interface ThemePresence {
  theme: JakartaTheme;
  items: PngReportItem[];
  worstRank: number;
}

// Which Jakarta themes actually occurred in a set, in fixed display order, with
// their items and worst severity rank. Present-only (no fabrication).
function presentThemes(items: PngReportItem[]): ThemePresence[] {
  const byTheme = new Map<JakartaTheme, PngReportItem[]>();
  for (const it of items) {
    const t = jakartaThemeForCategory(it.category);
    const arr = byTheme.get(t) ?? [];
    arr.push(it);
    byTheme.set(t, arr);
  }
  const out: ThemePresence[] = [];
  for (const theme of JAKARTA_THEME_ORDER) {
    const themeItems = byTheme.get(theme);
    if (!themeItems || themeItems.length === 0) continue;
    const worstRank = themeItems.reduce((m, it) => Math.max(m, it.severityRank), 0);
    out.push({ theme, items: themeItems, worstRank });
  }
  return out;
}

// A severity-aware tail sentence for an Incident Details paragraph. Never calls
// a Low a "severity escalation"; only speaks to severity at Moderate or above.
function severityTail(worstRank: number): string {
  if (worstRank >= 5)
    return " Reporting this period reached extreme severity and warrants close monitoring.";
  if (worstRank >= 4)
    return " Reporting this period reached high severity and warrants closer monitoring.";
  if (worstRank >= 3) return " Reporting this period reached moderate severity.";
  return "";
}

// --- Incident Details theme paragraphs -------------------------------------

function whereIn(areas: string[], fallback: string): string {
  return areas.length ? `in ${joinList(areas)}` : fallback;
}

function themeParagraph(p: ThemePresence): string {
  const areas = presentAreas(p.items);
  const sev = severityTail(p.worstRank);
  switch (p.theme) {
    case "protest":
      return `Demonstration activity was reported ${whereIn(
        areas,
        "around the central government and business districts",
      )}. Protests in the capital typically gather around the presidential palace, parliament and the main thoroughfares of the central districts, where they can close roads and slow movement at short notice.${sev}`;
    case "flooding":
      return `Flooding and heavy-rain disruption was reported ${whereIn(
        areas,
        "across low-lying parts of the capital",
      )}. Seasonal rainfall regularly affects low-lying parts of Greater Jakarta, where standing water closes roads, slows commuting and lengthens airport-transfer times.${sev}`;
    case "crime":
      return `Crime and public-safety incidents were reported ${whereIn(
        areas,
        "across the capital",
      )}. Opportunistic street crime and after-hours theft remain the most common risks to staff and visitors, particularly around crowded transport, market and entertainment areas.${sev}`;
    case "traffic":
      return `Traffic and movement disruption was reported ${whereIn(
        areas,
        "on the capital's main corridors",
      )}. Congestion on the main corridors is a daily constraint on meetings, deliveries and airport transfers, and worsens with rain, roadworks and protest activity.${sev}`;
    case "airport":
      return `Disruption affecting the Soekarno-Hatta airport corridor was reported. Movement between the city and the airport runs through congested toll routes that are sensitive to flooding and incidents, so transfer times can lengthen with little warning.${sev}`;
    case "governance":
      return `Policing and regulatory activity was reported ${whereIn(
        areas,
        "across the capital",
      )}, including security-force deployments and official measures. Such activity can briefly restrict movement and access around the affected area.${sev}`;
  }
}

export interface JakartaIncidentTheme {
  key: string;
  heading: string;
  paragraph: string;
}

// Incident Details theme groups for Jakarta, built from the leftover (non-Top-3)
// items so a development is never repeated. Present-only; empty input → [].
export function buildJakartaIncidentThemes(
  incidentDetailsItems: PngReportItem[],
): JakartaIncidentTheme[] {
  return presentThemes(incidentDetailsItems).map((p) => ({
    key: p.theme,
    heading: JAKARTA_THEME_HEADING[p.theme],
    paragraph: themeParagraph(p),
  }));
}

// --- Operational Impact bullets --------------------------------------------

// Present-gated Jakarta operational-impact bullets. Each present theme adds its
// sharp, Jakarta-specific line; a route-confirmation close is always added. An
// empty window yields [] (the renderer then shows the standing-exposure note).
export function buildJakartaOperationalImpact(windowItems: PngReportItem[]): string[] {
  const themes = new Set(presentThemes(windowItems).map((p) => p.theme));
  if (themes.size === 0) return [];
  const bullets: string[] = [];
  if (themes.has("protest"))
    bullets.push(
      "Protest activity in the central districts can disrupt access around government buildings and major roads at short notice.",
    );
  if (themes.has("flooding"))
    bullets.push(
      "Flooding and heavy rain can lengthen commuting times, slow site access and extend airport transfers.",
    );
  if (themes.has("crime"))
    bullets.push(
      "Crime reporting supports continued caution around after-hours movement and exposed public areas.",
    );
  if (themes.has("traffic"))
    bullets.push(
      "Traffic congestion remains a planning constraint for meetings, deliveries and airport transfers.",
    );
  if (themes.has("airport"))
    bullets.push(
      "Disruption on the airport corridor can extend transfer times between the city and Soekarno-Hatta.",
    );
  if (themes.has("governance"))
    bullets.push(
      "Security-force activity can briefly restrict access around affected sites in the central districts.",
    );
  bullets.push(
    "Local teams should confirm routes before movement on heavy-rain or protest days.",
  );
  return bullets;
}

// --- Recommended Actions ---------------------------------------------------

// Practical, location-based Jakarta actions. These are standing precautions
// (advice, not event claims), so the same set applies whether or not the window
// carried fresh reporting.
export function buildJakartaRecommendedActions(): string[] {
  return [
    "Check protest activity before travelling into Central Jakarta.",
    "Build time buffers into airport transfers and cross-city movement.",
    "Avoid unnecessary after-hours movement in poorly monitored areas.",
    "Confirm flood-affected routes before staff travel.",
    "Keep local staff and drivers briefed on the day's disruption points.",
    "Escalate incidents near offices, hotels, client sites or main routes.",
  ];
}

// --- BLUF / Current Situation / Outlook ------------------------------------

function leadThemePhrases(windowItems: PngReportItem[], cap = 3): string[] {
  return presentThemes(windowItems)
    .slice(0, cap)
    .map((p) => JAKARTA_THEME_PHRASE[p.theme]);
}

export function buildJakartaBluf(windowItems: PngReportItem[]): string {
  if (windowItems.length === 0) {
    return "Jakarta remains a manageable but disruption-prone operating environment. No fresh open-source reporting was identified this period; the capital's standing pattern of protest, congestion, flooding and opportunistic crime continues to shape movement planning.";
  }
  const phrases = leadThemePhrases(windowItems);
  const areas = presentAreas(windowItems, 2);
  const whereTail = areas.length ? ` in ${joinList(areas)}` : "";
  const themeBit = phrases.length
    ? joinList(phrases)
    : "localised, lower-level disruption";
  return `Jakarta remains a manageable but disruption-prone operating environment. This week's reporting centred on ${themeBit}${whereTail}, with the main operational effect on movement and timings rather than any city-wide deterioration.`;
}

export function buildJakartaCurrentSituation(windowItems: PngReportItem[]): string {
  if (windowItems.length === 0) {
    return "With no fresh reporting this period, Jakarta holds to its standing pattern: episodic protest in the central districts, recurrent traffic congestion, seasonal flooding and opportunistic street crime. The practical effect remains on movement planning rather than on the viability of operating in the capital.";
  }
  const phrases = leadThemePhrases(windowItems);
  const areas = presentAreas(windowItems, 2);
  const whereTail = areas.length ? ` in ${joinList(areas)}` : "";
  const strands = phrases.length
    ? `The most active strands were ${joinList(phrases)}${whereTail}.`
    : "Reporting was limited to isolated, lower-level disruption across the capital.";
  return `The week's picture in Jakarta is one of localised, manageable disruption rather than a broad deterioration in security. ${strands}\nFor business users, the practical effect falls mainly on movement — route choices, journey timings and airport transfers — rather than on the viability of operating in the capital.`;
}

export function buildJakartaOutlook(): string {
  return "Over the next seven days, the most likely picture is localised disruption from protest activity, traffic, heavy rain and opportunistic crime rather than a city-wide deterioration. Movement planning — route checks, flexible timings and local verification — remains the main mitigation.";
}

// --- Polestar View ---------------------------------------------------------

// The spec's strongest-paragraph Polestar View, near-verbatim, in British
// English. A standing assessed judgement of the capital, not a count summary.
export const JAKARTA_POLESTAR_PARAGRAPH =
  "Jakarta remains a manageable but disruption-prone operating environment. The main issue is not a single high-impact threat but the combined effect of protests, congestion, flooding and opportunistic crime on movement planning. Business users should focus on route checks, flexible timings and local verification rather than broad travel restrictions.";

export function buildJakartaPolestarView(): PolestarViewParts {
  return {
    direction: "Operating risk in Jakarta is broadly stable but disruption-prone.",
    driver:
      "The main driver is the combined effect of protests, congestion, flooding and opportunistic crime, rather than any single high-impact threat.",
    exposedGeography:
      "Exposure concentrates in the central government and business districts, the main commuting corridors and the Soekarno-Hatta airport corridor.",
    exposedActivity:
      "The main business exposure is staff movement, journey timings and airport transfers.",
    likelyDisruption:
      "The most likely disruption over the next seven days is localised interruption to movement from protest activity, traffic, heavy rain and opportunistic crime.",
    whatWouldChange:
      "The assessment would change if large-scale unrest, severe flooding or a major security incident disrupted the capital city-wide.",
    practicalJudgement:
      "For now, business users should focus on route checks, flexible timings and local verification rather than broad travel restrictions.",
    paragraph: JAKARTA_POLESTAR_PARAGRAPH,
  };
}

// --- Top 3 development transform -------------------------------------------

// Trim a cleaned headline to a short factual fragment used only to disambiguate
// two Top-3 developments that resolve to the same theme + area. The title is
// already masthead-cleaned upstream, so this stays factual (no invention).
function shortFragment(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const frag = words.slice(0, 8).join(" ");
  return frag.length < title.trim().length ? `${frag}…` : frag;
}

// Rewrite the Top-3 developments as analyst developments: a deterministic
// theme + area lead, plus an operational "why it matters" body. De-duplicates
// identical leads with a short factual fragment from the (already-cleaned)
// headline. Returns NEW item objects (never mutates the inputs).
export function applyJakartaTopThree(topThree: PngReportItem[]): PngReportItem[] {
  const out = topThree.map((it) => {
    const theme = jakartaThemeForCategory(it.category);
    const area = areaLabel(it.province);
    const lead = JAKARTA_THEME_LEAD[theme];
    const developmentTitle = area ? `${lead} in ${area}` : `${lead} reported in Jakarta`;
    return {
      ...it,
      developmentTitle,
      businessImpact: JAKARTA_THEME_RELEVANCE[theme],
    };
  });
  // Disambiguate identical development titles with a short factual fragment.
  const counts = new Map<string, number>();
  for (const it of out) counts.set(it.developmentTitle!, (counts.get(it.developmentTitle!) ?? 0) + 1);
  for (const it of out) {
    if ((counts.get(it.developmentTitle!) ?? 0) > 1) {
      const frag = shortFragment(it.title);
      if (frag) it.developmentTitle = `${it.developmentTitle}: ${frag}`;
    }
  }
  return out;
}

// --- Aggregator ------------------------------------------------------------

export interface JakartaBriefInput {
  windowItems: PngReportItem[];
  incidentDetailsItems: PngReportItem[];
  topThree: PngReportItem[];
}

export interface JakartaBriefOverrides {
  bluf: string;
  executiveSummary: string;
  outlook: string;
  polestarView: string;
  polestarViewParts: PolestarViewParts;
  recommendedActions: string[];
  operationalImpact: string[];
  incidentThemes: JakartaIncidentTheme[];
  topThree: PngReportItem[];
}

export function buildJakartaBrief(input: JakartaBriefInput): JakartaBriefOverrides {
  const parts = buildJakartaPolestarView();
  return {
    bluf: buildJakartaBluf(input.windowItems),
    executiveSummary: buildJakartaCurrentSituation(input.windowItems),
    outlook: buildJakartaOutlook(),
    polestarView: parts.paragraph,
    polestarViewParts: parts,
    recommendedActions: buildJakartaRecommendedActions(),
    operationalImpact: buildJakartaOperationalImpact(input.windowItems),
    incidentThemes: buildJakartaIncidentThemes(input.incidentDetailsItems),
    topThree: applyJakartaTopThree(input.topThree),
  };
}
