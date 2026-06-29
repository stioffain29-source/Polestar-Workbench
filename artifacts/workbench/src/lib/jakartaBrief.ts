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
  | "fire"
  | "crime"
  | "traffic"
  | "airport"
  | "governance";

export const JAKARTA_THEME_ORDER: JakartaTheme[] = [
  "protest",
  "flooding",
  "fire",
  "crime",
  "traffic",
  "airport",
  "governance",
];

const JAKARTA_THEME_HEADING: Record<JakartaTheme, string> = {
  protest: "Protests and demonstrations",
  flooding: "Flooding and weather disruption",
  fire: "Fire incidents",
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
  fire: "fire incidents",
  crime: "local crime",
  traffic: "traffic disruption",
  airport: "airport-corridor disruption",
  governance: "policing activity",
};

// Analyst-development headline for a Top-3 item: the conclusion an analyst would
// draw for operational relevance, not a "category + place" label. Built from the
// incident's real theme + area, with a sensible Jakarta-wide frame when the
// record is unattributed. No invented specifics.
const JAKARTA_THEME_DEVELOPMENT: Record<JakartaTheme, (area: string) => string> = {
  protest: (a) =>
    `${a || "Central Jakarta"} protest and policing activity keeps government-district disruption risk active`,
  flooding: (a) =>
    `${a || "Greater Jakarta"} flooding keeps commuter and airport-transfer routes exposed`,
  fire: (a) =>
    `${a || "Greater Jakarta"} fire incidents highlight access and evacuation exposure`,
  crime: () =>
    "Local crime reporting supports continued caution around after hours movement",
  traffic: (a) =>
    `${a || "Jakarta"} congestion keeps movement timings and transfers under pressure`,
  airport: () => "Soekarno-Hatta corridor disruption keeps airport transfers exposed",
  governance: (a) =>
    `${a || "Central Jakarta"} policing and security activity keeps movement disruption risk active`,
};

// Operational "why it matters" line for a Top-3 development, per theme. Sets the
// card body so every Top-3 item explains its operational relevance (spec §1).
const JAKARTA_THEME_RELEVANCE: Record<JakartaTheme, string> = {
  protest:
    "Demonstrations here can close roads and slow access around government buildings and central business districts; confirm routes and timings before travel.",
  flooding:
    "Standing water on this corridor can lengthen commuting, site access and airport-transfer times; check affected routes before staff move.",
  fire:
    "A fire in Jakarta's dense commercial and residential districts can force road closures and evacuations and disrupt access to nearby offices, malls, hotels, warehouses and client sites along commuter routes; confirm the status of affected areas before movement.",
  crime:
    "Reporting supports continued caution around after hours movement and exposed public areas near offices, hotels and transport hubs.",
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
  Fire: "fire",
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
//
// Each paragraph is built from the ACTUAL reported incidents in the window, not
// from a generic category template. For every present theme we extract only the
// concrete facts the source text actually carries — the real area (province),
// the site/setting type, the crime type, the policing action and any reported
// operational effect — and compose from those alone. When the source is too
// thin we say less or drop the theme; we never pad with invented specifics
// (no "presidential palace", no "official measures", no unconditioned commuting
// claims) and we never assert a fire's cause.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Full-word match (no stems): the token must be bounded by non-letters, so
// "office" never fires on "officer" and "port" never fires on "airport". This
// mirrors the corridor matcher; Bahasa Indonesia is ASCII, so the same boundary
// works for Indonesian tokens.
function hasToken(hay: string, token: string): boolean {
  return new RegExp(`(^|[^a-z])${escapeRegExp(token)}([^a-z]|$)`, "i").test(hay);
}

// Per-item evidence text: the cleaned English headline as PRIMARY evidence
// (PngReportItem.title already resolves to displayTitle when present, else the
// cleaned raw title), with the reported summary as SECONDARY. Lower-cased once.
function itemEvidence(it: PngReportItem): string {
  const head = (it.title || "").toLowerCase();
  const summ = (it.summary ?? "").toLowerCase();
  return `${head} ${summ}`;
}

interface TokenGroup {
  label: string;
  tokens: string[];
}

// Distinct friendly labels evidenced by a set of items, in group order, capped
// so the prose stays tight. A label is only emitted when at least one item's
// evidence text carries one of its full-word tokens (no fabrication).
function extractLabels(items: PngReportItem[], groups: TokenGroup[], cap = 3): string[] {
  const out: string[] = [];
  for (const g of groups) {
    if (items.some((it) => { const hay = itemEvidence(it); return g.tokens.some((t) => hasToken(hay, t)); })) {
      out.push(g.label);
      if (out.length >= cap) break;
    }
  }
  return out;
}

// Site / setting types. Friendly category labels (no internal "and", so they
// join cleanly) mapped to the full-word tokens that evidence them. Deliberately
// EXCLUDES over-generic words (bare street/road/house) and the verb-ambiguous
// "plant", so a stray match never invents a setting.
const SETTING_GROUPS: TokenGroup[] = [
  { label: "markets", tokens: ["market", "markets", "pasar"] },
  { label: "shopping malls", tokens: ["mall", "malls", "shopping centre", "shopping center", "plaza", "supermarket", "minimarket"] },
  { label: "factories", tokens: ["factory", "factories", "pabrik"] },
  { label: "warehouses", tokens: ["warehouse", "warehouses", "gudang"] },
  { label: "residential blocks", tokens: ["apartment", "apartments", "apartemen", "perumahan", "rusun", "kampung"] },
  { label: "office areas", tokens: ["office", "offices", "kantor"] },
  { label: "hotels", tokens: ["hotel", "hotels"] },
  { label: "schools", tokens: ["school", "schools", "sekolah", "campus", "kampus", "university", "universitas"] },
  { label: "hospitals", tokens: ["hospital", "hospitals", "clinic", "puskesmas", "rumah sakit"] },
  { label: "transport hubs", tokens: ["station", "stations", "stasiun", "terminal", "halte"] },
  { label: "toll roads", tokens: ["toll", "tol", "jalan tol"] },
  { label: "port areas", tokens: ["port", "pelabuhan", "priok"] },
];

// Crime types (crime theme). Bare "drug"/"drugs" omitted (drugstore etc.) in
// favour of the unambiguous narcotics tokens.
const CRIME_GROUPS: TokenGroup[] = [
  { label: "theft", tokens: ["theft", "thefts", "stolen", "pencurian", "mencuri", "copet", "pickpocket", "pickpocketing"] },
  { label: "robbery", tokens: ["robbery", "robberies", "robbed", "perampokan", "rampok", "begal"] },
  { label: "burglary", tokens: ["burglary", "burglaries", "break-in", "pembobolan"] },
  { label: "assault", tokens: ["assault", "assaults", "stabbing", "stabbed", "penganiayaan", "penikaman"] },
  { label: "shootings", tokens: ["shooting", "shootings", "shot", "penembakan"] },
  { label: "violent attacks", tokens: ["murder", "homicide", "killing", "pembunuhan"] },
  { label: "public disorder", tokens: ["brawl", "brawls", "clash", "clashes", "riot", "riots", "tawuran", "ricuh", "kericuhan"] },
  { label: "drug-related crime", tokens: ["narcotics", "narkoba", "sabu"] },
  { label: "kidnapping", tokens: ["kidnap", "kidnapping", "abduction", "penculikan"] },
  { label: "extortion", tokens: ["extortion", "pungli", "pemerasan", "premanisme"] },
];

// Policing / authority actions (governance theme). Specific actions only — used
// in place of the banned vague "official measures".
const ACTION_GROUPS: TokenGroup[] = [
  { label: "arrests", tokens: ["arrest", "arrested", "arrests", "ditangkap", "penangkapan", "menangkap"] },
  { label: "a police raid", tokens: ["raid", "raids", "raided", "razia", "gerebek", "penggerebekan"] },
  { label: "patrols and deployments", tokens: ["patrol", "patrols", "patroli", "deployed", "dikerahkan"] },
  { label: "checkpoints", tokens: ["checkpoint", "checkpoints", "roadblock", "roadblocks"] },
  { label: "evictions or demolitions", tokens: ["eviction", "evictions", "evicted", "demolition", "demolished", "penggusuran", "penertiban", "pembongkaran"] },
  { label: "seizures", tokens: ["seizure", "seizures", "seized", "disita", "penyitaan"] },
];

// Reported operational effects (any theme). Stated as fact ONLY when evidenced;
// otherwise the effect is phrased conditionally per theme.
const EFFECT_GROUPS: TokenGroup[] = [
  { label: "evacuation", tokens: ["evacuated", "evacuate", "evacuation", "evacuees", "evakuasi", "dievakuasi", "mengungsi"] },
  { label: "road closures", tokens: ["road closed", "road closure", "roads closed", "penutupan jalan", "jalan ditutup"] },
  { label: "traffic delays", tokens: ["congestion", "gridlock", "macet", "kemacetan", "traffic jam"] },
  { label: "power or utility disruption", tokens: ["power outage", "blackout", "listrik padam", "pemadaman listrik"] },
];

// One honest, non-padding line for a high-severity leftover we cannot place.
const NO_ANCHOR_NOTE =
  "Reporting in this category did not identify a specific Jakarta district or site, so no wider operating conclusion is drawn this period.";

// Graceful degradation: emit `primary` when there is something concrete to say;
// otherwise emit a single non-padding note ONLY for a high-severity leftover,
// and drop the theme entirely below that. severityTail is appended either way.
function compose(worstRank: number, primary: string): string | null {
  const sev = severityTail(worstRank);
  if (primary) return `${primary}${sev}`;
  if (worstRank >= 4) return `${NO_ANCHOR_NOTE}${sev}`;
  return null;
}

function themeParagraph(p: ThemePresence): string | null {
  const areas = presentAreas(p.items);
  const area = joinList(areas);
  const settings = extractLabels(p.items, SETTING_GROUPS);
  const effects = extractLabels(p.items, EFFECT_GROUPS, 2);

  switch (p.theme) {
    case "protest": {
      let primary = "";
      if (area) {
        const central = areas.some((a) => a.toLowerCase().includes("central jakarta"));
        primary = central
          ? "Demonstration reporting centred on the Central Jakarta government district, where activity around government buildings and main routes can close roads and slow access at short notice. The practical concern is short-notice road closure and delayed movement, not a wider city-wide security deterioration."
          : `Demonstration reporting centred on ${area}, where protest activity can close roads and slow access to surrounding areas and main routes at short notice. The practical concern is short-notice road closure and delayed movement, not a wider city-wide deterioration.`;
      }
      return compose(p.worstRank, primary);
    }
    case "flooding": {
      let primary = "";
      if (area || settings.length) {
        const where = joinList([area, ...settings].filter(Boolean));
        const logistics = settings.includes("toll roads") || settings.includes("port areas");
        const effTail = effects.length ? ` Reported effects include ${joinList(effects)}.` : "";
        primary = `Flooding and heavy-rain reporting affected ${where}, where standing water on low-lying roads can lengthen journeys and delay site access${logistics ? ", logistics movements and airport-transfer routes" : " and staff commuting"}.${effTail} Confirm affected routes before staff travel in these areas.`;
      }
      return compose(p.worstRank, primary);
    }
    case "fire": {
      let primary = "";
      if (area || settings.length) {
        const where = joinList([area, ...settings].filter(Boolean));
        const eff = effects.length
          ? `Reported effects include ${joinList(effects)}.`
          : "The operational concern is the knock-on effect — possible road closures, local evacuation and restricted access around the site — rather than the fire itself.";
        primary = `Fire reporting this period centred on ${where}. ${eff} Confirm the status of the affected area before movement nearby.`;
      }
      return compose(p.worstRank, primary);
    }
    case "crime": {
      const crimeTypes = extractLabels(p.items, CRIME_GROUPS);
      let primary = "";
      if (crimeTypes.length || settings.length) {
        const what = crimeTypes.length ? joinList(crimeTypes) : "crime and public-safety incidents";
        const loc = area ? ` in ${area}` : "";
        const settingPart = settings.length ? ` Exposure concentrated around ${joinList(settings)}.` : "";
        primary = `Crime reporting${loc} involved ${what}.${settingPart} The practical concern is staff exposure around after hours movement near offices, hotels and transport hubs rather than a city-wide threat.`;
      } else if (area) {
        primary = `Crime and public-safety reporting was limited to ${area}, with the main concern staff exposure around after hours movement near offices, hotels and transport hubs.`;
      }
      return compose(p.worstRank, primary);
    }
    case "traffic": {
      const corridor = settings.filter((s) => s === "toll roads" || s === "transport hubs" || s === "port areas");
      let primary = "";
      if (area || corridor.length || effects.length) {
        const where = joinList([area, ...corridor].filter(Boolean));
        const effTail = effects.length ? ` Reported effects include ${joinList(effects)}.` : "";
        primary = `Traffic and movement disruption was reported ${where ? `around ${where}` : "on the capital's main corridors"}.${effTail} Congestion here is a daily planning constraint on meetings, deliveries and airport transfers, and can worsen at short notice with rain or roadworks.`;
      }
      return compose(p.worstRank, primary);
    }
    case "airport": {
      const effTail = effects.length ? ` Reported effects include ${joinList(effects)}.` : "";
      const primary = `Reporting affected the Soekarno-Hatta airport corridor.${effTail} Transfers between the city and the airport run through congested, flood-sensitive toll routes, so transfer times can lengthen at short notice; allow additional buffer and confirm the toll-route status before departure.`;
      return compose(p.worstRank, primary);
    }
    case "governance": {
      const actions = extractLabels(p.items, ACTION_GROUPS);
      let primary = "";
      if (actions.length) {
        const loc = area ? ` in ${area}` : " in the capital";
        primary = `Policing and regulatory reporting${loc} involved ${joinList(actions)}. The practical concern is short-notice restriction — such activity can briefly close roads and limit access around the affected area until it clears; verify locally before travel.`;
      } else if (area) {
        primary = `Policing and regulatory activity was reported in ${area}. Such activity can briefly restrict movement and access around the affected area at short notice; verify locally before travel.`;
      }
      return compose(p.worstRank, primary);
    }
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
  const out: JakartaIncidentTheme[] = [];
  for (const p of presentThemes(incidentDetailsItems)) {
    const paragraph = themeParagraph(p);
    // A theme too thin to say anything concrete is dropped, not padded.
    if (!paragraph) continue;
    out.push({ key: p.theme, heading: JAKARTA_THEME_HEADING[p.theme], paragraph });
  }
  return out;
}

// --- Operational Impact bullets --------------------------------------------

// The Jakarta operational-impact bullets (spec §4): five fixed, location-led
// lines of standing operational guidance. These are conditional advice ("rain
// and flooding CAN affect…"), not claims that events occurred this period, so
// they apply every week and the section never reads empty.
export function buildJakartaOperationalImpact(): string[] {
  return [
    "Central Jakarta government district: protest activity can disrupt movement around government buildings and main roads.",
    "Jabodetabek commuter movement: heavy rain and flooding can lengthen commuting and airport transfers.",
    "Office, hotel and client site access: maintain caution around after hours staff movement and exposed public areas.",
    "Cross-city movement: allow extra time for meetings, site visits, airport transfers and logistics.",
    "Local teams: check routes before movement on protest or heavy-rain days.",
  ];
}

// --- Recommended Actions ---------------------------------------------------

// Practical, location-based Jakarta actions. These are standing precautions
// (advice, not event claims), so the same set applies whether or not the window
// carried fresh reporting.
export function buildJakartaRecommendedActions(): string[] {
  return [
    "Check protest activity before travelling into the Central Jakarta government district.",
    "Build time buffers into airport transfers and cross-city commuter movement.",
    "Avoid unnecessary after hours staff movement in poorly monitored areas.",
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
    return "Jakarta remains a manageable but disruption-prone operating environment. No fresh open-source reporting was identified this period; the capital's standing pattern of protest, congestion, flooding and local crime continues to shape movement planning.";
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
  // The structured Jakarta operating picture (spec §3): a short present-active
  // lead, then four standing operating-picture statements. The four statements
  // describe Jakarta's standing exposure (not event claims), so they are safe to
  // state regardless of the window; the lead reflects what was actually reported.
  const phrases = leadThemePhrases(windowItems);
  const areas = presentAreas(windowItems, 2);
  const whereTail = areas.length ? ` in ${joinList(areas)}` : "";
  const lead =
    windowItems.length === 0
      ? "With no fresh open-source reporting this period, Jakarta holds to its standing operating picture."
      : phrases.length
        ? `This week's reporting centred on ${joinList(phrases)}${whereTail}, with the main effect on movement and timings.`
        : "Reporting this week was limited to isolated, lower-level disruption across the capital.";
  const picture =
    "Central Jakarta remains the main protest and government-district exposure. Across Greater Jakarta, weather and flooding remain the main movement-disruption issue. Crime remains a localised staff-safety and after hours movement concern. The overall picture is manageable but disruption-prone: routine movement can be affected by the combined effect of protest activity, heavy rain, congestion, crime and localised emergency-response activity.";
  return `${lead}\n${picture}`;
}

export function buildJakartaOutlook(): string {
  return "Over the next seven days, the most likely picture is localised disruption from protest activity, traffic, heavy rain and local crime rather than a city-wide deterioration. Movement planning — route checks, flexible timings and local verification — remains the main mitigation.";
}

// Jakarta-specific escalation indicators for the Outlook (spec §5): the standing
// watch-items an analyst would flag as "what would worsen the picture", phrased
// for the capital rather than the generic country list.
export function buildJakartaEscalationIndicators(): string[] {
  return [
    "Larger protest activity around Central Jakarta government locations",
    "Heavy rain causing flooding on commuter or airport-transfer routes",
    "Crime or public-safety incidents near offices, hotels, malls, transport hubs or client sites",
  ];
}

// --- Polestar View ---------------------------------------------------------

// The spec's strongest-paragraph Polestar View, near-verbatim, in British
// English. A standing assessed judgement of the capital, not a count summary.
export const JAKARTA_POLESTAR_PARAGRAPH =
  "Jakarta remains a manageable but disruption-prone operating environment. The main issue is not a single high-impact threat but the combined effect of protests, congestion, flooding and local crime on movement planning. Business users should focus on route checks, flexible timings, local verification and rapid reporting from staff and drivers rather than broad travel restrictions.";

export function buildJakartaPolestarView(): PolestarViewParts {
  return {
    direction: "Operating risk in Jakarta is broadly stable but disruption-prone.",
    driver:
      "The main driver is the combined effect of protests, congestion, flooding and local crime, rather than any single high-impact threat.",
    exposedGeography:
      "Exposure concentrates in the central government and business districts, the main commuting corridors and the Soekarno-Hatta airport corridor.",
    exposedActivity:
      "The main business exposure is staff movement, journey timings and airport transfers.",
    likelyDisruption:
      "The most likely disruption over the next seven days is localised interruption to movement from protest activity, traffic, heavy rain and local crime.",
    whatWouldChange:
      "The assessment would change if large-scale unrest, severe flooding or a major security incident disrupted the capital city-wide.",
    practicalJudgement:
      "For now, business users should focus on route checks, flexible timings, local verification and rapid reporting from staff and drivers rather than broad travel restrictions.",
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
    const developmentTitle = JAKARTA_THEME_DEVELOPMENT[theme](area);
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
  escalationIndicators: string[];
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
    operationalImpact: buildJakartaOperationalImpact(),
    escalationIndicators: buildJakartaEscalationIndicators(),
    incidentThemes: buildJakartaIncidentThemes(input.incidentDetailsItems),
    topThree: applyJakartaTopThree(input.topThree),
  };
}
