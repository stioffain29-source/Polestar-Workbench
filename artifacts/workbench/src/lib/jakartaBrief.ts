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
import type { JakartaCorridorStatus } from "./jakartaCorridors";
import { hazardSummaryLabel, JAKARTA_EXPOSURE_RANK } from "./jakartaCorridors";
import { compareIncidentSignificance } from "@workspace/country-engine";

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
    "Demonstrations here can close roads and slow access around government buildings and central business districts; hold a second route via Gatot Subroto.",
  flooding:
    "Standing water on this corridor can lengthen commuting, site access and airport-transfer times; check the North Jakarta and commuter-belt access roads before staff move.",
  fire:
    "A fire in Jakarta's dense commercial and residential districts can force road closures and evacuations and disrupt access to nearby offices, malls, hotels, warehouses and client sites along commuter routes; confirm the affected block and its approach roads before movement.",
  crime:
    "Reporting supports tightened after-hours movement and secure, pre-agreed pickup points wherever crime has surfaced; keep valuables out of sight on foot and on transfers.",
  traffic:
    "Congestion on this corridor is a planning constraint for meetings, deliveries and airport transfers; hold two viable routes on the inner and outer ring roads.",
  airport:
    "Disruption here can extend transfers between the city and Soekarno-Hatta; widen the transfer window and pre-confirm the toll-road approach on airport runs.",
  governance:
    "Security-force activity here can briefly restrict movement and access around the affected area; confirm cordons before approach.",
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
  "Explosive remnants of war / accidental explosion": "fire",
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
// Deterministic wording variants (repetition guard): two themes sharing a
// severity band must not paste the identical tail sentence. All variants state
// the same fact — no meaning drift.
const SEVERITY_TAIL_VARIANTS: Record<"extreme" | "high" | "moderate", string[]> = {
  extreme: [
    " Reporting this period reached extreme severity and warrants close monitoring.",
    " The most serious of this reporting was extreme and should be watched closely.",
    " At its worst this reporting reached extreme severity.",
    " The worst item under this theme rated extreme this period.",
    " This theme produced extreme-severity reporting this period.",
    " Severity under this theme peaked at extreme.",
    " The heaviest reporting under this theme was extreme in severity.",
  ],
  high: [
    " Reporting this period reached high severity and warrants closer monitoring.",
    " The most serious of this reporting reached high severity.",
    " At its worst this reporting reached high severity and merits attention.",
    " The worst item under this theme rated high this period.",
    " This theme produced high-severity reporting this period.",
    " Severity under this theme peaked at high.",
    " The heaviest reporting under this theme was high in severity.",
  ],
  moderate: [
    " Reporting this period reached moderate severity.",
    " The most serious of this reporting was moderate.",
    " At its worst this reporting reached moderate severity.",
    " The worst item under this theme rated moderate this period.",
    " This theme produced moderate-severity reporting this period.",
    " Severity under this theme peaked at moderate.",
    " The heaviest reporting under this theme was moderate in severity.",
  ],
};

function severityTail(worstRank: number, variant = 0): string {
  const band =
    worstRank >= 5 ? "extreme" : worstRank >= 4 ? "high" : worstRank >= 3 ? "moderate" : null;
  if (!band) return "";
  const list = SEVERITY_TAIL_VARIANTS[band];
  return list[((variant % list.length) + list.length) % list.length];
}

// The worst, then most-recent crime incident in a set, rendered as ONE concrete,
// count-free sentence naming the real headline, the area and its assessed
// severity. This turns the crime read from a generic template into a specific
// account of the actual event. No fabrication: the headline, area and severity
// label are the incident's own fields. Returns "" (no leading space) when the
// set is empty or carries no usable headline. Mirrors leadIncidentSentence in
// countryIncidentThemes (kept local to avoid a cross-module import cycle).
function leadCrimeLine(items: PngReportItem[]): string {
  const ranked = [...items].sort((a, b) => {
    if (b.severityRank !== a.severityRank) return b.severityRank - a.severityRank;
    const ad = (a.incidentDate ?? a.reportedDate).getTime();
    const bd = (b.incidentDate ?? b.reportedDate).getTime();
    return bd - ad;
  });
  const lead = ranked[0];
  if (!lead) return "";
  const raw = (lead.developmentTitle?.trim() || lead.title || "")
    .replace(/\s+/g, " ")
    .replace(/[.;,]+$/, "")
    .trim();
  if (!raw) return "";
  const area = areaLabel(lead.province);
  const loc = area && !raw.toLowerCase().includes(area.toLowerCase()) ? ` in ${area}` : "";
  const label = lead.severityLabel?.trim();
  const sevClause = label ? `, assessed as ${label} severity` : "";
  const end = /[?!.]$/.test(raw) ? "" : ".";
  return `The most serious reported was ${raw}${loc}${sevClause}${end}`;
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
function compose(worstRank: number, primary: string, sevVariant = 0): string | null {
  const sev = severityTail(worstRank, sevVariant);
  if (primary) return `${primary}${sev}`;
  if (worstRank >= 4) return `${NO_ANCHOR_NOTE}${sev}`;
  return null;
}

function themeParagraph(p: ThemePresence, sevVariant = 0): string | null {
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
      return compose(p.worstRank, primary, sevVariant);
    }
    case "flooding": {
      let primary = "";
      if (area || settings.length) {
        const where = joinList([area, ...settings].filter(Boolean));
        const logistics = settings.includes("toll roads") || settings.includes("port areas");
        const effTail = effects.length ? ` Reported effects include ${joinList(effects)}.` : "";
        primary = `Flooding and heavy-rain reporting affected ${where}, where standing water on low-lying roads can lengthen journeys and delay site access${logistics ? ", logistics movements and airport-transfer routes" : " and staff commuting"}.${effTail} Confirm affected routes before staff travel in these areas.`;
      }
      return compose(p.worstRank, primary, sevVariant);
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
      return compose(p.worstRank, primary, sevVariant);
    }
    case "crime": {
      const crimeTypes = extractLabels(p.items, CRIME_GROUPS);
      let primary = "";
      if (crimeTypes.length || settings.length) {
        const what = crimeTypes.length ? joinList(crimeTypes) : "crime and public-safety incidents";
        const loc = area ? ` in ${area}` : "";
        // The concern is tied to WHERE crime actually surfaced this period: the
        // reported settings when we have them, otherwise a neutral statement —
        // never a fixed claim about offices, hotels or transport hubs that saw
        // no reporting.
        const concern = settings.length
          ? ` The practical concern is staff exposure on movement around ${joinList(settings)} rather than a city-wide threat.`
          : ` The practical concern is staff exposure on after-hours and on-foot movement in the affected area rather than a city-wide threat.`;
        primary = `Crime reporting${loc} involved ${what}.${concern}`;
      } else if (area) {
        primary = `Crime and public-safety reporting was limited to ${area}, with the main concern staff exposure on after-hours and on-foot movement rather than a city-wide threat.`;
      }
      return compose(p.worstRank, primary, sevVariant);
    }
    case "traffic": {
      const corridor = settings.filter((s) => s === "toll roads" || s === "transport hubs" || s === "port areas");
      let primary = "";
      if (area || corridor.length || effects.length) {
        const where = joinList([area, ...corridor].filter(Boolean));
        const effTail = effects.length ? ` Reported effects include ${joinList(effects)}.` : "";
        primary = `Traffic and movement disruption was reported ${where ? `around ${where}` : "on the capital's main corridors"}.${effTail} Congestion here is a daily planning constraint on meetings, deliveries and airport transfers, and can worsen at short notice with rain or roadworks.`;
      }
      return compose(p.worstRank, primary, sevVariant);
    }
    case "airport": {
      const effTail = effects.length ? ` Reported effects include ${joinList(effects)}.` : "";
      const primary = `Reporting affected the Soekarno-Hatta airport corridor.${effTail} Transfers between the city and the airport run through congested, flood-sensitive toll routes, so transfer times can lengthen at short notice; widen the transfer window and confirm the airport toll road and Tangerang approach before departure.`;
      return compose(p.worstRank, primary, sevVariant);
    }
    case "governance": {
      const actions = extractLabels(p.items, ACTION_GROUPS);
      let primary = "";
      if (actions.length) {
        const loc = area ? ` in ${area}` : " in the capital";
        primary = `Policing and regulatory reporting${loc} involved ${joinList(actions)}. The practical concern is short-notice restriction — such activity can briefly close roads and limit access around the affected area until it clears; confirm cordons on the affected roads before approach.`;
      } else if (area) {
        primary = `Policing and regulatory activity was reported in ${area}. Such activity can briefly restrict movement and access around the affected area at short notice; confirm cordons before approach.`;
      }
      return compose(p.worstRank, primary, sevVariant);
    }
  }
}

export interface JakartaIncidentTheme {
  key: string;
  heading: string;
  paragraph: string;
}

// Trajectory of a Jakarta theme against the prior-week baseline. Mirrors the
// shared countryThemeSynthesis logic (severity move dominates; a >=2-item volume
// swing breaks a severity tie) so Jakarta's assessed themes read the same way as
// the other five briefs. "new" = present now, absent a week earlier; "nobasis" =
// no prior window supplied, so no trend is honestly asserted.
type JakartaThemeTrajectory = "rising" | "easing" | "steady" | "new" | "nobasis";

function jakartaThemeTrajectory(
  current: PngReportItem[],
  baseline: PngReportItem[],
  hasBaseline: boolean,
): JakartaThemeTrajectory {
  if (!hasBaseline) return "nobasis";
  if (baseline.length === 0) return "new";
  const cw = current.reduce((m, it) => Math.max(m, it.severityRank), 0);
  const bw = baseline.reduce((m, it) => Math.max(m, it.severityRank), 0);
  if (cw > bw) return "rising";
  if (cw < bw) return "easing";
  if (current.length - baseline.length >= 2) return "rising";
  if (baseline.length - current.length >= 2) return "easing";
  return "steady";
}

// The count-free trajectory clause appended to each theme paragraph. Matches the
// shared synthesiser's wording so preview == PDF and Jakarta reads in step with
// the other briefs.
// Owner-flagged repetition guard: several themes sharing one trajectory must
// not paste the identical sentence under each. Deterministic variants keyed by
// the theme's position; all variants state the same fact — no meaning drift.
const JAKARTA_TRAJECTORY_SENTENCES: Record<JakartaThemeTrajectory, string[]> = {
  rising: [
    "Against the previous week this theme is rising.",
    "This theme drew more reporting than in the previous week.",
    "Week on week, reporting under this theme increased.",
    "Reporting under this theme ran ahead of the previous week.",
    "The previous week saw less of this reporting than this period did.",
    "Compared with the week before, this theme gained ground.",
    "This period carried more of this reporting than the week before.",
  ],
  easing: [
    "Against the previous week this theme is easing.",
    "This theme drew less reporting than in the previous week.",
    "Week on week, reporting under this theme declined.",
    "Reporting under this theme ran below the previous week.",
    "The previous week saw more of this reporting than this period did.",
    "Compared with the week before, this theme lost ground.",
    "This period carried less of this reporting than the week before.",
  ],
  steady: [
    "Against the previous week this theme is broadly steady.",
    "This theme ran at much the same level as the previous week.",
    "Week on week, reporting under this theme was broadly unchanged.",
    "Reporting under this theme held near the previous week's level.",
    "The previous week saw a similar amount of this reporting.",
    "Compared with the week before, this theme was little changed.",
    "This period carried about as much of this reporting as the week before.",
  ],
  new: [
    "It was not reported a week earlier, so it reads as newly prominent this period.",
    "This theme was absent from the previous week's reporting and is newly prominent.",
    "No comparable reporting appeared a week earlier, making this newly prominent.",
    "The previous week carried none of this reporting, so it is new this period.",
    "This reporting had no counterpart a week earlier and stands out as new.",
    "A week earlier this theme did not feature, so it registers as new.",
    "Nothing under this theme appeared the week before, so it is new this period.",
  ],
  nobasis: [
    "With no prior-week baseline, no week-on-week trend is asserted.",
    "There is no prior-week baseline, so no trend is asserted for this theme.",
    "No week-on-week comparison is made — the prior week carries no baseline.",
    "Absent a prior-week baseline, this theme carries no trend judgement.",
    "This theme is stated without a trend — the prior week offers no baseline.",
    "No baseline exists for the prior week, so no trend is claimed here.",
    "The prior week provides no baseline, so this theme carries no trend call.",
  ],
};

function jakartaTrajectorySentence(
  t: JakartaThemeTrajectory,
  variant: number,
): string {
  const list = JAKARTA_TRAJECTORY_SENTENCES[t];
  return list[((variant % list.length) + list.length) % list.length];
}

// Incident Details theme groups for Jakarta, built from the leftover (non-Top-3)
// items so a development is never repeated. Present-only; empty input → []. Each
// present theme now carries an ASSESSED trajectory judgement against the prior
// week's full window (baselineItems), so Jakarta's per-theme narratives read as
// assessed themes like the other five briefs while keeping their corridor-
// specific tactical framing.
export function buildJakartaIncidentThemes(
  incidentDetailsItems: PngReportItem[],
  baselineItems: PngReportItem[] = [],
  hasBaseline = false,
): JakartaIncidentTheme[] {
  const baselineByTheme = new Map<JakartaTheme, PngReportItem[]>();
  for (const it of baselineItems) {
    const t = jakartaThemeForCategory(it.category);
    const arr = baselineByTheme.get(t) ?? [];
    arr.push(it);
    baselineByTheme.set(t, arr);
  }
  const out: JakartaIncidentTheme[] = [];
  // Per-trajectory counters: variants must rotate WITHIN each trajectory (two
  // "easing" themes need different wording; a global index can hand the same
  // variant to both when other trajectories sit between them).
  const trajectoryUse = new Map<JakartaThemeTrajectory, number>();
  // Per-severity-band counter for the paragraph tail sentence (same guard).
  const sevBandUse = new Map<number, number>();
  for (const p of presentThemes(incidentDetailsItems)) {
    const band = p.worstRank >= 5 ? 5 : p.worstRank >= 4 ? 4 : p.worstRank >= 3 ? 3 : 0;
    const sevVariant = sevBandUse.get(band) ?? 0;
    sevBandUse.set(band, sevVariant + 1);
    const paragraph = themeParagraph(p, sevVariant);
    // A theme too thin to say anything concrete is dropped, not padded.
    if (!paragraph) continue;
    const trajectory = jakartaThemeTrajectory(
      p.items,
      baselineByTheme.get(p.theme) ?? [],
      hasBaseline,
    );
    const use = trajectoryUse.get(trajectory) ?? 0;
    trajectoryUse.set(trajectory, use + 1);
    const full = `${paragraph} ${jakartaTrajectorySentence(trajectory, use)}`;
    out.push({ key: p.theme, heading: JAKARTA_THEME_HEADING[p.theme], paragraph: full });
  }
  return out;
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

// --- Consolidated weekly operating brief ------------------------------------
//
// Jakarta is a city report, not a directory of standing exposure tables. These
// builders deliberately emit only the active operational picture for the
// reporting week, plus the compact standing controls needed when reporting is
// sparse. Corridor attribution and hazard classification remain centralised in
// jakartaCorridors.ts; this file only turns that shared evidence into the
// approved report structure.

export interface JakartaOperatingPictureRow {
  area: string;
  driver: string;
  impact: string;
  action: string;
}

export interface JakartaOperatingPicture {
  rows: JakartaOperatingPictureRow[];
  emptyNote: string;
}

export interface JakartaCrimeEscalationWatch {
  crime: string;
  escalationTriggers: string;
}

export interface JakartaTacticalBrief {
  operatingPicture: JakartaOperatingPicture;
  crimeEscalationWatch: JakartaCrimeEscalationWatch;
  recommendedActions: string[];
  mapCaption: string;
}

function rankedLiveStatuses(statuses: JakartaCorridorStatus[]): JakartaCorridorStatus[] {
  return statuses
    .filter((status) => status.elevated)
    .sort(
      (a, b) =>
        (JAKARTA_EXPOSURE_RANK[b.displayExposure] ?? 0) -
          (JAKARTA_EXPOSURE_RANK[a.displayExposure] ?? 0) ||
        a.number - b.number,
    );
}

/**
 * The one approved Operating Picture table. A row exists only for a corridor
 * with live reporting; its driver, impact and action all come from the shared
 * corridor status, so a quiet area cannot be made to look active.
 */
export function buildJakartaOperatingPicture(
  statuses: JakartaCorridorStatus[],
  coverageUnconfirmed = false,
): JakartaOperatingPicture {
  const rows = rankedLiveStatuses(statuses)
    .map((status) => ({
      area: status.area.name,
      driver: hazardSummaryLabel(status),
      impact: status.relevanceShort,
      action: status.action,
    }))
    .filter((row) =>
      [row.area, row.driver, row.impact, row.action].every(
        (value) => value.trim().length > 0,
      ),
    );

  return {
    rows,
    emptyNote: coverageUnconfirmed
      ? "Collection coverage for this period could not be confirmed, so no area-specific assessment is made this week. Apply standing movement controls and treat conditions on the ground as unverified until coverage is restored."
      : "No area-specific operational driver was identified this period; continue routine pre-departure checks for time-critical movement.",
  };
}

function jakartaControlJudgement(items: PngReportItem[]): string {
  const lead = [...items].sort((a, b) =>
    compareIncidentSignificance(
      {
        severity: ["", "insignificant", "low", "moderate", "high", "extreme"][a.severityRank],
        title: a.title,
        summary: a.summary,
        occurredAt: (a.incidentDate ?? a.reportedDate).toISOString(),
      },
      {
        severity: ["", "insignificant", "low", "moderate", "high", "extreme"][b.severityRank],
        title: b.title,
        summary: b.summary,
        occurredAt: (b.incidentDate ?? b.reportedDate).toISOString(),
      },
    ),
  )[0];
  if (!lead) {
    return "Polestar judges that the standing control is disciplined route, site and after-hours movement planning.";
  }
  const area = areaLabel(lead.province) || "the affected area";
  const theme = JAKARTA_THEME_PHRASE[jakartaThemeForCategory(lead.category)];
  return `Polestar judges that the immediate control problem is ${theme} in ${area}, not a city-wide deterioration.`;
}

function compactCrimeLine(
  items: PngReportItem[],
  coverageUnconfirmed = false,
): string {
  const crimeItems = items.filter(
    (item) => jakartaThemeForCategory(item.category) === "crime",
  );
  const judgement = jakartaControlJudgement(items);
  if (crimeItems.length === 0) {
    if (coverageUnconfirmed) {
      return `${judgement} Crime conditions this period are Not Assessed — collection coverage could not be confirmed, so the absence of fresh crime reporting is not evidence of a quiet week. The standing pattern remains the working assumption until coverage is restored.`;
    }
    return `${judgement} No fresh crime-specific reporting this period — standing pattern continues to apply.`;
  }
  const crimeTypes = extractLabels(crimeItems, CRIME_GROUPS, 2);
  const areas = joinList(presentAreas(crimeItems, 2));
  const settings = extractLabels(crimeItems, SETTING_GROUPS, 1);
  const subject = crimeTypes.length
    ? joinList(crimeTypes)
    : "crime and public-safety incidents";
  const where = areas ? ` in ${areas}` : "";
  const setting = settings.length ? ` around ${settings[0]}` : "";
  return `${judgement} Fresh crime-specific reporting concerned ${subject}${where}${setting}; keep movement precautions focused on the affected area.`;
}

function compactEscalationTriggers(statuses: JakartaCorridorStatus[]): string {
  const live = rankedLiveStatuses(statuses);
  const triggers: string[] = [];
  if (
    live.some((status) =>
      status.hazards.some((hazard) => hazard === "protest" || hazard === "policing"),
    )
  ) {
    triggers.push(
      "protest cordon or road closure affecting the government district or Thamrin–Sudirman spine",
    );
  }
  if (
    live.some((status) =>
      status.hazards.some((hazard) => hazard === "flooding" || hazard === "traffic"),
    )
  ) {
    triggers.push(
      "flooding or congestion that removes the airport, port or commuter-route contingency",
    );
  }
  if (
    live.some((status) =>
      status.hazards.some((hazard) =>
        ["crime", "fire"].includes(hazard),
      ),
    )
  ) {
    triggers.push(
      "a credible incident close to a staffed site, hotel, warehouse or client movement",
    );
  }
  if (triggers.length === 0) {
    return "a confirmed protest cordon; loss of a planned airport, port or commuter route; a credible incident close to a staffed site";
  }
  return triggers.join(" • ");
}

/** The compact replacement for Crime Trends, Outlook, Polestar View and the zone table. */
export function buildJakartaCrimeEscalationWatch(
  items: PngReportItem[],
  statuses: JakartaCorridorStatus[],
  coverageUnconfirmed = false,
): JakartaCrimeEscalationWatch {
  return {
    crime: compactCrimeLine(items, coverageUnconfirmed),
    escalationTriggers: compactEscalationTriggers(statuses),
  };
}

function dedupeActions(actions: string[]): string[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = action.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One flat action list. Live corridor actions lead; quiet weeks retain only the
 * small set of conditional standing controls needed to operate safely.
 */
export function buildJakartaRecommendedActions(
  statuses: JakartaCorridorStatus[],
  items: PngReportItem[] = [],
): string[] {
  const liveActions = rankedLiveStatuses(statuses).map((status) => status.action);
  const hasCrime = items.some(
    (item) => jakartaThemeForCategory(item.category) === "crime",
  );
  const standing = [
    "Use one pre-departure check for protest, flood and road-closure status before time-critical movement.",
    "Keep a primary and alternate route ready for airport, port and cross-city movements.",
    ...(hasCrime
      ? [
          "Use booked, tracked transport after hours and keep valuables out of sight around the affected area.",
        ]
      : []),
  ];
  const actions = dedupeActions([...liveActions, ...standing]).slice(0, 5);
  // The post-deduplication guard prevents an empty list even if future corridor
  // content is blanked or all candidates collapse to duplicates.
  return actions.length > 0
    ? actions
    : [
        "Continue routine pre-departure checks before time-critical movement.",
      ];
}

function buildJakartaMapCaption(
  statuses: JakartaCorridorStatus[],
  coverageUnconfirmed = false,
): string {
  const names = rankedLiveStatuses(statuses).map((status) => status.area.name);
  if (names.length === 0) {
    if (coverageUnconfirmed) {
      return "Map panel shows Jakarta's standing movement and access exposure only. Collection coverage for this period could not be confirmed, so area postures are shown as Not assessed rather than rated.";
    }
    return "Map panel shows Jakarta's standing movement and access exposure; no area-specific operational driver was identified this period.";
  }
  return `Map panel highlights the live operating drivers in ${joinList(names)}; it is an exposure guide, not a city-wide risk rating.`;
}

export function buildJakartaTacticalBrief(
  statuses: JakartaCorridorStatus[],
  windowItems: PngReportItem[] = [],
  coverageUnconfirmed = false,
): JakartaTacticalBrief {
  return {
    operatingPicture: buildJakartaOperatingPicture(statuses, coverageUnconfirmed),
    crimeEscalationWatch: buildJakartaCrimeEscalationWatch(
      windowItems,
      statuses,
      coverageUnconfirmed,
    ),
    recommendedActions: buildJakartaRecommendedActions(statuses, windowItems),
    mapCaption: buildJakartaMapCaption(statuses, coverageUnconfirmed),
  };
}

// --- Aggregator ------------------------------------------------------------

export interface JakartaBriefInput {
  windowItems: PngReportItem[];
  incidentDetailsItems: PngReportItem[];
  topThree: PngReportItem[];
  // Per-area corridor statuses for the live-aware tactical sections. Optional so
  // existing callers/tests keep working; absent → standing-only tactical brief.
  corridorStatuses?: JakartaCorridorStatus[];
  // The prior-week full window, used to assess each incident theme's trajectory.
  // Optional so existing callers/tests keep working; absent → no trend asserted.
  previousWindowItems?: PngReportItem[];
  hasBaseline?: boolean;
  // True when the weekly coverage determination is a coverage problem. Empty
  // sections then say Not Assessed instead of implying a confirmed quiet week.
  coverageUnconfirmed?: boolean;
}

export interface JakartaBriefOverrides {
  topThree: PngReportItem[];
  tactical: JakartaTacticalBrief;
}

export function buildJakartaBrief(input: JakartaBriefInput): JakartaBriefOverrides {
  return {
    topThree: applyJakartaTopThree(input.topThree),
    tactical: buildJakartaTacticalBrief(
      input.corridorStatuses ?? [],
      input.windowItems,
      input.coverageUnconfirmed ?? false,
    ),
  };
}
