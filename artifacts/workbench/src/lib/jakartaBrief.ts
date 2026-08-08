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
import { JAKARTA_EXPOSURE_RANK } from "./jakartaCorridors";
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

// --- Operational Impact bullets --------------------------------------------

// The Jakarta operational-impact bullets (spec §4): five fixed, location-led
// lines of standing operational guidance. These are conditional advice ("rain
// and flooding CAN affect…"), not claims that events occurred this period, so
// they apply every week and the section never reads empty.
export function buildJakartaOperationalImpact(): string[] {
  return [
    "Central Jakarta government district: protest activity can disrupt movement around government buildings and main roads.",
    "Jabodetabek commuter movement: heavy rain and flooding can lengthen commuting and airport transfers.",
    "Office, hotel and client site access: brief staff on after-hours movement and confirm secure pickup points around SCBD, Sudirman and Mega Kuningan.",
    "Cross-city movement: hold two viable routes for meetings, site visits, airport transfers and logistics across the inner and outer ring roads.",
    "Local teams: confirm protest and flood status on named access roads before movement on protest or heavy-rain days.",
  ];
}

// --- Recommended Actions ---------------------------------------------------

// Practical, location-based Jakarta actions. These are standing precautions
// (advice, not event claims), so the same set applies whether or not the window
// carried fresh reporting.
export function buildJakartaRecommendedActions(): string[] {
  return [
    "Use one pre-departure check for protest, flood and road-closure status before movement into the government district, North Jakarta or the airport corridor.",
    "Give drivers a primary and alternate route for office, hotel, Tanjung Priok and Soekarno-Hatta movements; widen only time-critical airport and cargo buffers.",
    "Use booked, tracked transport after hours and escalate any incident affecting an office, hotel, client site or named access route.",
  ];
}

// Jakarta-specific escalation indicators for the Outlook (spec §5): the standing
// watch-items an analyst would flag as "what would worsen the picture", phrased
// for the capital rather than the generic country list.
export function buildJakartaEscalationIndicators(): string[] {
  return [
    "Protest, cordon or road closure affecting the government district or Thamrin–Sudirman spine",
    "Flooding or congestion that removes the airport, port or commuter-route contingency",
    "A credible incident or terminal disruption close to a staffed site, hotel, warehouse or client movement",
  ];
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

// --- Tactical operating brief (spec sections 4–8 and 13) -------------------
//
// These power the Jakarta-only tactical sections (Movement and Access Impact,
// Business District Exposure, Port and Logistics Implications, Airport / Hotel /
// Office Implications, Route and Timing Guidance, and the map area summary).
//
// The TABLES and the standing route/timing guidance are window-independent
// conditional advice (they apply every week), so they are constant. The INTROS,
// the movement-impact bullets and the area summary are LIVE-AWARE: they lead with
// an elevated corridor's reported relevance ONLY when that area actually carried
// reporting this period (raise-not-invent), then fall back to a standing
// assessment. Every string is count-free.

// A single area row in a tactical exposure table: the location, why it matters
// operationally, and the recommended action. (`why` doubles as the "Impact"
// column for the port table.)
export interface JakartaTableRow {
  area: string;
  why: string;
  action: string;
}

// A ranked Priority-Areas row (spec §3). The table is built from the live
// corridor statuses, so the RANK and `elevated` flag change with the incident
// data; the driver / impact / action text is named-location specific per area.
export interface JakartaPriorityAreaRow {
  priority: number;
  area: string;
  driver: string;
  businessImpact: string;
  action: string;
  /** True when this area carried live reporting this period. */
  elevated: boolean;
}

// Staff-movement impact broken out by movement type (spec §4). Each field names
// the roads / districts the movement runs through — never "movement may be
// disrupted".
export interface JakartaStaffMovementImpact {
  officeAccess: string;
  hotelToOffice: string;
  airportTransfer: string;
  clientMeeting: string;
  staffCommute: string;
  driverRoute: string;
  afterHours: string;
}

// A Port-and-Logistics row (spec §6): the four-column logistics table.
export interface JakartaPortLogisticsRow {
  area: string;
  operationalRelevance: string;
  possibleImpact: string;
  requiredAction: string;
}

// A role-based recommended-action block (spec §10).
export interface JakartaRoleAction {
  role: string;
  guidance: string;
}

// Crime Trends & Business Impact (dedicated crime section). A single curated
// STANDING exposure row keyed to a named operating context (staff movement,
// hotels and client meetings, airport transfers, port access and logistics
// routes) — durable analyst guidance about how Jakarta's enduring crime
// patterns bear on business operations, NEVER this period's live findings.
export interface JakartaCrimeBusinessRow {
  context: string;
  exposure: string;
  precaution: string;
}

// The Crime Trends & Business Impact section payload. Splits what actually
// surfaced in reporting THIS period from Jakarta's durable standing pattern, so
// neither reads as the other. Count-free; no numeric increase/decrease claims.
export interface JakartaCrimeTrends {
  // What crime surfaced in open-source reporting this period — or an honest
  // "not reported this period" note when nothing distinct was identified.
  reportedThisPeriod: string;
  // Jakarta's durable, standing crime pattern (analyst baseline, not live data).
  standingPattern: string;
  // Qualitative read of this period against the standing pattern. Never asserts
  // a numeric rise or fall.
  trendRead: string;
  // Standing business-impact table (always present).
  businessImpact: JakartaCrimeBusinessRow[];
}

export interface JakartaTacticalBrief {
  priorityAreas: JakartaPriorityAreaRow[];
  staffMovement: JakartaStaffMovementImpact;
  airportTransfer: string;
  portLogistics: {
    intro: string;
    rows: JakartaPortLogisticsRow[];
    actions: string[];
  };
  officeHotelVenue: { intro: string; rows: JakartaTableRow[] };
  routeTiming: string[];
  roleActions: JakartaRoleAction[];
  areaSummary: string;
  crimeTrends: JakartaCrimeTrends;
}

function corridorById(
  statuses: JakartaCorridorStatus[],
  id: string,
): JakartaCorridorStatus | null {
  return statuses.find((s) => s.area.id === id) ?? null;
}

function elevatedStatuses(
  statuses: JakartaCorridorStatus[],
): JakartaCorridorStatus[] {
  return statuses.filter((s) => s.elevated);
}

// Spec §3. The ranked Priority-Areas table. Each Jakarta operating zone maps to
// a corridor area; the row text is named-location specific. Ranking is driven by
// the live data — areas that carried reporting this period (elevated) rise to
// the top, ordered by displayed exposure, then the remaining areas follow in
// their standing order — so the table re-orders as the incident data changes.
interface JakartaPriorityAreaSpec {
  corridorId: string;
  area: string;
  driver: string;
  businessImpact: string;
  action: string;
}

const JAKARTA_PRIORITY_AREA_SPECS: JakartaPriorityAreaSpec[] = [
  {
    corridorId: "central-government",
    area: "Gambir / Monas / Istana area",
    driver: "Protest or policing",
    businessImpact:
      "Road closures and delayed access around government buildings, Jl. Medan Merdeka, Jl. MH Thamrin and nearby Menteng office areas",
    action:
      "Avoid non-essential meetings near Monas, Istana Merdeka and Gambir during active demonstrations or police cordons",
  },
  {
    corridorId: "north-port",
    area: "Tanjung Priok / North Jakarta",
    driver: "Port access, congestion, flooding",
    businessImpact:
      "Container collection and truck-dispatch delays on the Cilincing, Koja and North Jakarta access roads",
    action: "Confirm gate, terminal and road status before dispatch",
  },
  {
    corridorId: "commercial-hotels",
    area: "Sudirman / Thamrin / SCBD",
    driver: "Business-corridor congestion",
    businessImpact:
      "Delays to meetings, hotel access and office movement across SCBD, Kuningan and the Sudirman–Thamrin spine",
    action: "Confirm route and arrival window before client meetings",
  },
  {
    corridorId: "airport-corridor",
    area: "Soekarno-Hatta corridor",
    driver: "Airport-transfer congestion and flooding",
    businessImpact:
      "Extended transfer times on the airport toll road and the Tangerang approach",
    action:
      "Confirm toll-route status and build a larger buffer before time-critical flights",
  },
  {
    corridorId: "commuter-belt",
    area: "Greater Jakarta commuter belt",
    driver: "Rain and flooding",
    businessImpact:
      "Lengthened staff commutes and site access across Bekasi, Depok, Tangerang and South Tangerang",
    action: "Confirm flood-hit routes before staff move on heavy-rain days",
  },
  {
    corridorId: "cross-city-routes",
    area: "Cross-city toll and ring roads",
    driver: "Congestion",
    businessImpact:
      "Delays to meetings, site visits and deliveries on the inner and outer ring roads and main arterials",
    action: "Confirm two viable routes and brief drivers before departure",
  },
];

export function buildJakartaPriorityAreas(
  statuses: JakartaCorridorStatus[],
): JakartaPriorityAreaRow[] {
  const score = (id: string): number => {
    const s = corridorById(statuses, id);
    if (!s) return 0;
    // Elevated areas sort above standing ones; within each band, higher
    // displayed exposure sorts first.
    const expo = JAKARTA_EXPOSURE_RANK[s.displayExposure] ?? 0;
    return (s.elevated ? 100 : 0) + expo;
  };
  return JAKARTA_PRIORITY_AREA_SPECS.map((spec, idx) => ({
    spec,
    idx,
    score: score(spec.corridorId),
  }))
    // Stable sort: score desc, then original (standing) order.
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map(({ spec }, i) => ({
      priority: i + 1,
      area: spec.area,
      driver: spec.driver,
      businessImpact: spec.businessImpact,
      action: spec.action,
      elevated: corridorById(statuses, spec.corridorId)?.elevated ?? false,
    }))
    // A concise operating picture ranks the three areas that merit immediate
    // attention. The broader seven-zone posture table remains the place for
    // the standing profile, avoiding the former two-page duplication.
    .slice(0, 3);
}

// Spec §4. Staff-movement impact broken out by movement type. Each line names
// the roads / districts the movement runs through — never a bare "movement may
// be disrupted". Live-aware where a relevant corridor carried reporting this
// period (raise-not-invent), otherwise the standing named-location assessment.
export function buildJakartaStaffMovement(
  statuses: JakartaCorridorStatus[],
): JakartaStaffMovementImpact {
  const central = corridorById(statuses, "central-government");
  const protestLive = !!central?.elevated;
  const hotelToOffice = protestLive
    ? "Staff moving between hotels in Sudirman, Thamrin, Kuningan or SCBD and meetings in Central Jakarta should confirm route status before departure; with protest activity reported around Gambir, Monas or Istana Merdeka this period, plan for road closures and police diversions rather than simple traffic delay."
    : "Staff moving between hotels in Sudirman, Thamrin, Kuningan or SCBD and meetings in Central Jakarta should confirm route status before departure; if protest activity is reported around Gambir, Monas or Istana Merdeka, plan for road closures and police diversions rather than simple traffic delay.";
  return {
    officeAccess:
      "For offices, hotels and meetings on the Sudirman–Thamrin spine, SCBD and Kuningan, confirm one approach route before departure; protest-day closures around the government district are the exception that changes the plan.",
    hotelToOffice,
    airportTransfer:
      "For Soekarno-Hatta, check the airport toll road and Tangerang approach before departure and add buffer only when heavy rain, Friday congestion or a confirmed disruption removes the normal route.",
    clientMeeting:
      "For client meetings across SCBD, Mega Kuningan and Rasuna Said, confirm the arrival window and retain one alternate route rather than repeating area-by-area checks.",
    staffCommute:
      "Commuter movement from Bekasi, Depok and Tangerang is weather-sensitive; defer low-clearance travel when confirmed flooding removes the planned approach.",
    driverRoute:
      "Drivers need a primary and alternate route for office, hotel, Tanjung Priok and Soekarno-Hatta journeys, with diversions held around Thamrin–Sudirman and Gatot Subroto.",
    afterHours:
      "After-hours movement near offices, hotels, malls and transport hubs in the central and southern districts warrants standard personal-security awareness; keep journeys booked and tracked rather than hailed on the street.",
  };
}

// Spec §7. Standing exposure table for the office, hotel and meeting venues in
// the central and southern business districts. The intro leads with a live
// elevated-area relevance when one is reported, then states the standing framing.
const JAKARTA_OFFICE_HOTEL_VENUE_ROWS: JakartaTableRow[] = [
  {
    area: "Sudirman–Thamrin corridor",
    why: "Jakarta's primary office and banking spine; protest marches and road closures here directly affect staff movement and client meetings.",
    action: "Confirm meeting venues and travel windows; keep alternative routes ready on protest days.",
  },
  {
    area: "SCBD, Senayan and Gatot Subroto",
    why: "Dense corporate towers, hotels and event venues concentrate staff and visitors in a compact area.",
    action: "Brief staff on venue access; keep arrivals and departures flexible around peak congestion.",
  },
  {
    area: "Kuningan and Mega Kuningan",
    why: "Embassy, hotel and corporate cluster where localised security or protest activity can restrict access at short notice.",
    action: "Verify access before client visits; keep situational awareness around hotels and offices.",
  },
  {
    area: "Menteng and the central government fringe",
    why: "Adjacent to government buildings and frequent protest routes, so spillover can close surrounding roads.",
    action: "Confirm protest activity before travelling in; hold a diversion via Jl. MH Thamrin on government-district approaches.",
  },
];

export function buildJakartaOfficeHotelVenue(
  statuses: JakartaCorridorStatus[],
): { intro: string; rows: JakartaTableRow[] } {
  const central = corridorById(statuses, "central-government");
  const commercial = corridorById(statuses, "commercial-hotels");
  const leads: string[] = [];
  if (commercial?.elevated) leads.push(commercial.relevance);
  if (central?.elevated) leads.push(central.relevance);
  const standing =
    "Jakarta's main offices, hotels and meeting venues run along the Sudirman–Thamrin spine and the southern corporate clusters of SCBD, Senayan, Kuningan and Mega Kuningan. Their density means localised disruption — protest, congestion or a security incident — translates quickly into delays for staff movement, client meetings and hotel access.";
  const intro = leads.length ? `${leads.join(" ")} ${standing}` : standing;
  // The three active business-cluster rows cover the usable operating
  // decision. The government-fringe exposure is already carried by the
  // priority/posture views and does not need a duplicate venue-table row.
  return { intro, rows: JAKARTA_OFFICE_HOTEL_VENUE_ROWS.slice(0, 3) };
}

// Spec §6. Standing exposure table for North Jakarta and the port, plus a short
// list of recommended port actions. The intro leads with the port area's live
// relevance when reported.
const JAKARTA_PORT_LOGISTICS_ROWS: JakartaPortLogisticsRow[] = [
  {
    area: "Tanjung Priok",
    operationalRelevance: "Indonesia's main container port and clearance point",
    possibleImpact: "Collection delays, gate disruption and truck queues",
    requiredAction: "Confirm terminal and gate status before dispatch",
  },
  {
    area: "Cilincing, Koja and North Jakarta access roads",
    operationalRelevance: "Low-lying approach roads carrying heavy port and industrial traffic",
    possibleImpact: "Flooding and congestion delaying truck movement",
    requiredAction: "Check road and flood status before releasing trucks",
  },
  {
    area: "Port to Bekasi and Cikarang",
    operationalRelevance: "Primary industrial distribution route inland",
    possibleImpact: "Delayed onward delivery to factories and warehouses",
    requiredAction: "Build a dispatch buffer and confirm an alternate route",
  },
  {
    area: "Port to Tangerang and the western belt",
    operationalRelevance: "Cross-city warehouse and distribution route",
    possibleImpact: "Cross-city congestion delaying collection windows",
    requiredAction: "Avoid peak movement and confirm two viable routes",
  },
  {
    area: "Airport cargo corridor",
    operationalRelevance: "Soekarno-Hatta air-freight connection on the airport toll road",
    possibleImpact: "Time-sensitive cargo delayed by toll-road flooding and congestion",
    requiredAction: "Confirm toll-route status and transfer time before release",
  },
];

export function buildJakartaPortLogistics(
  statuses: JakartaCorridorStatus[],
): { intro: string; rows: JakartaPortLogisticsRow[]; actions: string[] } {
  const port = corridorById(statuses, "north-port");
  const standing =
    "North Jakarta and the Tanjung Priok port area drive the capital's logistics timings. Port congestion, low-lying flood-prone access roads around Cilincing and Koja, and heavy industrial traffic toward Bekasi, Cikarang and Tangerang mean dispatch and collection windows need a buffer, especially during heavy rain.";
  const intro = port?.elevated ? `${port.relevance} ${standing}` : standing;
  const actions = [
    "Confirm Tanjung Priok terminal and gate access before dispatch; congestion and restrictions can change at short notice.",
    "Check flood status on the Cilincing, Koja and North Jakarta approach roads during heavy rain and stage time-critical shipments accordingly.",
    "Brief drivers on alternative routes between Tanjung Priok, the Bekasi and Cikarang industrial belt, the Tangerang warehouses and the Soekarno-Hatta cargo corridor.",
  ];
  // Retain the port, north-access and inland-distribution rows; the airport
  // cargo corridor is dealt with once in the dedicated airport-transfer read.
  return { intro, rows: JAKARTA_PORT_LOGISTICS_ROWS.slice(0, 3), actions };
}

// Spec §5. Airport-transfer impact prose. Leads with a live elevated-area
// relevance for the airport corridor when reported, then the standing
// assessment naming the toll road and approach.
export function buildJakartaAirportTransfer(
  statuses: JakartaCorridorStatus[],
): string {
  const airport = corridorById(statuses, "airport-corridor");
  const lead = airport?.elevated ? `${airport.relevance} ` : "";
  const standing =
    "Airport transfers should not be treated as routine during heavy-rain periods. Confirm the Soekarno-Hatta airport toll road and the Tangerang approach before departure, and account for late-afternoon and evening rain and Friday congestion that pool on the low-lying sections. For time-critical flights, build a larger buffer and avoid scheduling cross-city meetings immediately before airport movement; flooding on the toll road can turn a routine transfer into a missed flight.";
  return `${lead}${standing}`;
}

// Spec §8. Route and timing guidance — conditional advice that applies every
// week, so it is a constant set. Each line names the roads, districts or
// chokepoints the guidance applies to.
export function buildJakartaRouteTiming(): string[] {
  return [
    "Use a single movement check for protest, flood and road status before government-district, airport, port or cross-city travel.",
    "Plan the airport toll road and ring roads with margin; retain a second route for time-critical staff and cargo movements.",
    "Keep meetings flexible only when a confirmed protest, weather disruption or road closure affects the named corridor.",
  ];
}

// Spec §10. Role-based recommended actions — guidance grouped by who acts on it
// (travellers, security teams, logistics teams, local management), each naming
// the relevant Jakarta zones rather than a generic instruction.
export function buildJakartaRoleActions(): JakartaRoleAction[] {
  return [
    {
      role: "Travellers and visiting staff",
      guidance:
        "Confirm the route and arrival window before central meetings; avoid non-essential government-district movement during demonstrations and use booked transport after hours.",
    },
    {
      role: "Security teams",
      guidance:
        "Maintain one citywide disruption check and verify that drivers have a primary and alternate route before movements that touch the government district, port or airport.",
    },
    {
      role: "Logistics teams",
      guidance:
        "Confirm Tanjung Priok gate status and the North Jakarta approach before dispatch; apply contingency routing only when access, weather or terminal conditions warrant it.",
    },
  ];
}

/** Jakarta closes on the live lead, not a generic statement that risk is localised. */
export function buildJakartaPolestarView(items: PngReportItem[]): string {
  const lead = [...items].sort((a, b) =>
    compareIncidentSignificance(
      { severity: ["", "insignificant", "low", "moderate", "high", "extreme"][a.severityRank], title: a.title, summary: a.summary, occurredAt: (a.incidentDate ?? a.reportedDate).toISOString() },
      { severity: ["", "insignificant", "low", "moderate", "high", "extreme"][b.severityRank], title: b.title, summary: b.summary, occurredAt: (b.incidentDate ?? b.reportedDate).toISOString() },
    ),
  )[0];
  if (!lead) return "Polestar judges that the standing control is disciplined route, site and after-hours movement planning; a quiet reporting window does not remove the need for daily local checks.";
  const area = areaLabel(lead.province) || "the affected area";
  const theme = JAKARTA_THEME_PHRASE[jakartaThemeForCategory(lead.category)];
  return `Polestar judges that the immediate control problem is ${theme} in ${area}, not a city-wide deterioration. Prioritise verified movement and site checks around that exposure, while retaining a single contingency route for airport, port and central-business-district travel. Escalate only when a credible incident, protest cordon or weather disruption removes that local contingency.`;
}

// Spec §13. Short summary under the corridor map. Names the areas that carried
// live reporting this period (count-free); otherwise a standing-profile note.
export function buildJakartaAreaSummary(
  statuses: JakartaCorridorStatus[],
): string {
  const live = elevatedStatuses(statuses);
  if (live.length === 0) {
    return "No area carried fresh reporting this period; the map reflects each area's standing operating-exposure profile. The central government district and the North Jakarta port area carry the highest standing exposure.";
  }
  const names = joinList(live.map((s) => s.area.name));
  return `Reporting this period was attributed to ${names}; the remaining areas reflect their standing operating-exposure profile. Prioritise protest, flood and access checks there before committing staff and vehicle movements.`;
}

// Jakarta's durable, standing crime picture. A curated analyst baseline (NOT
// this period's reporting) so it can never read as fabricated live data. The
// dominant business exposures are opportunistic and property crime, not
// targeted attacks. Count-free; British English.
const JAKARTA_CRIME_STANDING =
  "Jakarta's standing crime picture is dominated by opportunistic and property crime rather than targeted attacks on business. The persistent exposures are street theft and pickpocketing around transport hubs and crowded commercial areas, vehicle crime and smash-and-grab in traffic, residential and premises break-ins in dense districts, and card or ATM fraud. Extortion and informal levies (premanisme) affect logistics around ports and industrial areas, and periodic drug-enforcement operations create legal and reputational risk for staff and visitors. Violent crime is a lower routine concern but can flare around nightlife, crowds and disputes.";

// The standing crime-exposure table, keyed to named operating contexts. Always
// present — it is the durable "how Jakarta's crime picture affects THIS
// operation" answer, tying each enduring crime pattern to the staff movement,
// venue, transfer, port and logistics activity it bears on, independent of what
// surfaced this period. Count-free; British English.
const JAKARTA_CRIME_CONTEXT_ROWS: JakartaCrimeBusinessRow[] = [
  {
    context:
      "Staff movement and after-hours transport — SCBD and the Sudirman–Thamrin corridor",
    exposure:
      "Street theft, pickpocketing and phone-snatching around transport hubs, crowded pavements and busy commercial streets, worst after dark and while staff move on foot between offices, hotels and venues.",
    precaution:
      "Use booked, tracked transport rather than street-hailing after hours; keep phones, cash and valuables out of sight on foot; brief staff on well-lit, populated routes.",
  },
  {
    context: "Hotels and client meetings — SCBD, Kuningan and Senayan",
    exposure:
      "Distraction theft and bag-snatching in lobbies, cafés and crowded venues, and card skimming or ATM fraud at less secure terminals around meeting locations.",
    precaution:
      "Keep bags and devices attended in public areas; use ATMs inside banks and reputable hotels; confirm venues and arrival windows before client meetings.",
  },
  {
    context: "Airport transfers — Soekarno-Hatta corridor",
    exposure:
      "Vehicle crime and smash-and-grab at lights and in congestion on the airport toll road, and distraction theft or scams around terminals and the kerbside.",
    precaution:
      "Keep doors locked and windows up in traffic; keep bags out of view; use pre-booked drivers and confirm the transfer at both ends.",
  },
  {
    context:
      "Port access and logistics — Tanjung Priok and North Jakarta industrial roads",
    exposure:
      "Extortion and informal levies (premanisme), cargo theft and pilferage, and intimidation around the port, container yards and industrial access roads.",
    precaution:
      "Work through established operators and hauliers; report demands rather than paying roadside; confirm gate, escort and yard-security arrangements before dispatch.",
  },
  {
    context: "Cross-city logistics routes and driver planning",
    exposure:
      "Smash-and-grab and traffic-stop theft (begal) in night-time congestion, and opportunistic theft from stationary or slow-moving vehicles on the inner and outer ring roads and main arterials.",
    precaution:
      "Brief drivers on secure routes and stops; vary predictable timing; keep cargo and valuables out of sight and vehicles locked.",
  },
];

// Build the Crime Trends & Business Impact section. `items` is the report window;
// the this-period read is derived ONLY from crime-theme items (via the shared
// CRIME_GROUPS / SETTING_GROUPS / presentAreas), so it never invents crime that
// was not reported. It LEADS the section — naming the crime types, areas,
// settings and business consequence that actually surfaced this period — with
// the curated standing pattern and business-impact table shown afterwards as the
// durable baseline.
export function buildJakartaCrimeTrends(
  items: PngReportItem[],
): JakartaCrimeTrends {
  const crimeItems = items.filter(
    (it) => jakartaThemeForCategory(it.category) === "crime",
  );
  const crimeTypes = extractLabels(crimeItems, CRIME_GROUPS);
  const settings = extractLabels(crimeItems, SETTING_GROUPS, 2);
  const area = joinList(presentAreas(crimeItems));

  let reportedThisPeriod: string;
  let trendRead: string;
  // Any crime-theme item produces a this-period read: a classified crime
  // record must never fall through to "No fresh crime-specific reporting" just
  // because it lacked an extractable crime-type token or a resolved area.
  if (crimeItems.length) {
    const what = crimeTypes.length
      ? joinList(crimeTypes)
      : "crime and public-safety incidents";
    const where = area ? ` in ${area}` : "";
    // Name the single worst crime that actually surfaced, so the read is a
    // concrete account of the real event rather than a generic essay.
    const lead = leadCrimeLine(crimeItems);
    const leadPart = lead ? ` ${lead}` : "";
    const settingPart = settings.length
      ? ` Reporting clustered around ${joinList(settings)}.`
      : "";
    // The business consequence is tied to WHERE crime actually surfaced this
    // period (the resolved areas and reported settings), never to a fixed list
    // of central business districts or transport hubs that saw no reporting.
    const consequence = settings.length
      ? ` For business, the exposure is staff movement around ${joinList(settings)}${area ? ` in ${area}` : ""} rather than a city-wide threat.`
      : ` For business, the exposure is staff movement${area ? ` in ${area}` : ""} — particularly after-hours and on-foot transfers — rather than a city-wide threat.`;
    reportedThisPeriod = `This period's open-source reporting featured ${what}${where}.${leadPart}${settingPart}${consequence} Treat this as a partial signal of the wider picture rather than a complete crime record.`;
    trendRead = `This reporting sits within Jakarta's standing pattern of opportunistic and property crime rather than signalling a city-wide shift; use it to focus staff-movement and site precautions where crime actually surfaced this period.`;
  } else {
    reportedThisPeriod = `No fresh crime-specific reporting was identified in the sources this period. This is not evidence that crime is absent — routine opportunistic and property crime is heavily under-reported — so the standing pattern below continues to apply.`;
    trendRead = `With no distinct crime reporting this period, plan against Jakarta's standing pattern of opportunistic and property crime rather than assuming a quieter environment.`;
  }

  return {
    reportedThisPeriod,
    standingPattern: JAKARTA_CRIME_STANDING,
    trendRead,
    // Keep the five distinct operating contexts. The movement sections are
    // consolidated separately, but this table remains the single reference
    // for the standing crime controls for staff, venues, airport, port and
    // cross-city logistics.
    businessImpact: JAKARTA_CRIME_CONTEXT_ROWS,
  };
}

export function buildJakartaTacticalBrief(
  statuses: JakartaCorridorStatus[],
  windowItems: PngReportItem[] = [],
): JakartaTacticalBrief {
  return {
    priorityAreas: buildJakartaPriorityAreas(statuses),
    staffMovement: buildJakartaStaffMovement(statuses),
    airportTransfer: buildJakartaAirportTransfer(statuses),
    portLogistics: buildJakartaPortLogistics(statuses),
    officeHotelVenue: buildJakartaOfficeHotelVenue(statuses),
    routeTiming: buildJakartaRouteTiming(),
    roleActions: buildJakartaRoleActions(),
    areaSummary: buildJakartaAreaSummary(statuses),
    crimeTrends: buildJakartaCrimeTrends(windowItems),
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
}

export interface JakartaBriefOverrides {
  recommendedActions: string[];
  operationalImpact: string[];
  escalationIndicators: string[];
  incidentThemes: JakartaIncidentTheme[];
  topThree: PngReportItem[];
  tactical: JakartaTacticalBrief;
}

export function buildJakartaBrief(input: JakartaBriefInput): JakartaBriefOverrides {
  return {
    recommendedActions: buildJakartaRecommendedActions(),
    operationalImpact: buildJakartaOperationalImpact(),
    escalationIndicators: buildJakartaEscalationIndicators(),
    incidentThemes: buildJakartaIncidentThemes(
      input.incidentDetailsItems,
      input.previousWindowItems ?? [],
      input.hasBaseline ?? false,
    ),
    topThree: applyJakartaTopThree(input.topThree),
    tactical: buildJakartaTacticalBrief(
      input.corridorStatuses ?? [],
      input.windowItems,
    ),
  };
}
