import { format, parseISO, max as dateMax } from "date-fns";
import { resolveReportWindow } from "./reportWindow";
import {
  filterTopicReportIncidents,
  type TopicFastFactCard,
} from "./topicFastFacts";
import {
  classifyConflictCategory,
  CATEGORY_CARD_LABEL,
  detectOperationalImpacts,
} from "./conflictAnalysis";
import { splitAttributedCountries } from "./topicRelevance";
import { selectRelatedIncidents } from "./relatedIncidents";

// Single source of truth for the Conflict Watch report's analysed dataset.
// Mirrors the flashpointReportDataset pattern so the on-screen preview
// (ConflictReportPreview) and the PDF (exportConflictReportPdf) render the
// SAME sections, in the SAME order, from the SAME numbers and prose — the
// preview/PDF parity guarantee.
//
// Conflict Watch is the kinetic, casualty-grade theatre (war, insurgency,
// bombings/airstrikes, abduction & armed crime). The report is LOCATION-LED:
// it ranks the watched theatres dynamically and leads with where the fighting
// is and who is exposed, rather than a fixed executive-summary template.
//
// Ranking (highest first): worst severity -> casualty signal -> incident
// count -> operational relevance (breadth of operational-impact tags) ->
// movement / sites / infrastructure / evacuation signal -> latest date ->
// theatre name.

export interface ConflictReportIncident {
  id: number | string;
  title: string;
  topic: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
  displayTitle?: string | null;
}

export interface ConflictEnrichedIncident extends ConflictReportIncident {
  date: Date;
  /** Conflict category card label, e.g. "Armed Clashes". */
  issue: string;
}

export interface ConflictActivityArea {
  theatre: string;
  incidents: ConflictEnrichedIncident[];
  worstSeverity: string;
  worstSeverityLabel: string;
  casualtySignalCount: number;
  incidentCount: number;
  operationalScore: number;
  siteMovementScore: number;
  topCategories: string[];
  topImpacts: string[];
  /** Named sub-national hotspots, ranked by how many incidents reference them. */
  hotspots: HotspotHit[];
  /** Incidents that named at least one known hotspot (basis for "localised"). */
  hotspotCoveredCount: number;
  latestDate: Date;
  paragraph: string;
}

export interface ConflictReportDataset {
  reportingPeriodShort: string;
  reportingPeriodLong: string;
  windowIncidents: ConflictEnrichedIncident[];
  fastFacts: TopicFastFactCard[];
  topActivityAreas: ConflictActivityArea[];
  otherWatchedTheatres: ConflictActivityArea[];
  relatedIncidents: ConflictEnrichedIncident[];
  worstSeverity: string;
  worstSeverityLabel: string;
  autoSituation: string;
  autoOtherWatched: string;
  autoWhatMatters: string;
  autoWatchNext: string;
  autoPolestarView: string;
}

// ---------------------------------------------------------------------------
// Severity scaffolding (kept local so this module stays pure and test-friendly
// — it must not pull jsPDF in via pdfChrome).
// ---------------------------------------------------------------------------
const SEV_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};
function sevKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function joinList(parts: string[]): string {
  const clean = parts.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

function toDate(s: string): Date {
  try {
    const d = parseISO(s);
    return isNaN(d.getTime()) ? new Date(0) : d;
  } catch {
    return new Date(0);
  }
}

function textOf(i: ConflictReportIncident) {
  return {
    title: i.title,
    summary: i.summary ?? null,
    displayTitle: i.displayTitle ?? null,
  };
}

// Operational-impact labels that count toward the "movement / sites /
// infrastructure / evacuation" tiebreaker. "Casualties reported" is handled
// separately as the casualty signal, so it is deliberately excluded here.
const SITE_MOVEMENT_IMPACTS = new Set<string>([
  "Civilian harm or displacement",
  "Transport or checkpoint disruption",
  "Energy or utility disruption",
  "Aviation or maritime risk",
  "Security-force or government targeting",
]);

// Map an operational-impact label to a plain operational-exposure phrase used
// in the location paragraphs and the What Matters section.
const IMPACT_EXPOSURE: Record<string, string> = {
  "Civilian harm or displacement": "civilian harm and displacement",
  "Transport or checkpoint disruption": "road, checkpoint and convoy movement",
  "Energy or utility disruption": "power and fuel infrastructure",
  "Aviation or maritime risk": "airports, airspace and port access",
  "Security-force or government targeting": "military and government sites",
};

// Lowercase a category card label for use mid-sentence ("Bombings &
// Airstrikes" -> "bombings and airstrikes").
function categoryPhrase(label: string): string {
  return label.toLowerCase().replace(/\s*&\s*/g, " and ");
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// A natural noun phrase for the dominant armed activity in a theatre, built
// from the one or two most common categories present. No actor names are
// invented — just the plain nature of the fighting.
const CATEGORY_ACTIVITY: Record<string, string> = {
  Insurgency: "insurgent attacks",
  "Bombings & Airstrikes": "bombings and airstrikes",
  "Abduction & Crime": "abductions and armed crime",
  "Armed Clashes": "armed clashes",
};
function activityPhrase(topCategories: string[]): string {
  const phrases = topCategories
    .slice(0, 2)
    .map((c) => CATEGORY_ACTIVITY[c] ?? categoryPhrase(c));
  return phrases.length ? joinList(phrases) : "armed activity";
}

function exposurePhrases(impacts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of impacts) {
    if (l === "Casualties reported") continue;
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const ordered = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => IMPACT_EXPOSURE[l])
    .filter(Boolean);
  return Array.from(new Set(ordered));
}

// ---------------------------------------------------------------------------
// Sub-national hotspots. Conflict incidents almost never carry a structured
// location, but the headline reliably names the actual trouble spot (e.g.
// "Manipur", "Balochistan"). Naming a whole country is misleading when the
// violence is isolated to one or two regions — "India is worth watching" reads
// as alarmist when the activity is confined to Manipur and the Maoist belt
// while Delhi, Mumbai and the economic centres are untouched. These curated
// keyword sets let the prose lead with WHERE the fighting actually is. Add new
// regions here as theatres open; no actor names are invented.
// ---------------------------------------------------------------------------
interface HotspotHit {
  label: string;
  count: number;
}

const COUNTRY_HOTSPOTS: Record<string, { label: string; terms: string[] }[]> = {
  India: [
    {
      label: "Manipur",
      terms: [
        "manipur", "imphal", "kuki", "kuki-naga", "churachandpur", "kangpokpi",
        "moreh",
      ],
    },
    {
      label: "the Maoist (Naxal) belt",
      terms: [
        "maoist", "naxal", "naxalite", "chhattisgarh", "sukma", "bastar",
        "dantewada", "bijapur", "narayanpur", "abujhmad", "malkangiri", "odisha",
        "jharkhand", "palamu", "latehar", "gadchiroli",
      ],
    },
    {
      label: "Jammu & Kashmir",
      terms: [
        "kashmir", "jammu", "srinagar", "pulwama", "baramulla", "kupwara",
        "anantnag", "poonch",
      ],
    },
    { label: "Assam", terms: ["assam"] },
    { label: "Nagaland", terms: ["nagaland", "dimapur"] },
    { label: "Punjab", terms: ["punjab"] },
  ],
  Pakistan: [
    {
      label: "Khyber Pakhtunkhwa",
      terms: [
        "khyber pakhtunkhwa", "khyber-pakhtunkhwa", "khyber", "bannu",
        "waziristan", "peshawar", "tank", "dera ismail", "bajaur", "kurram",
        "north-west", "northwest",
      ],
    },
    {
      label: "Balochistan",
      terms: [
        "balochistan", "baluchistan", "quetta", "gwadar", "mastung", "turbat",
        "khuzdar", "kech",
      ],
    },
    {
      label: "the Afghan border",
      terms: [
        "afghan border", "afghanistan border", "afghanistan", "afghan",
        "durand", "spin boldak",
      ],
    },
    { label: "Punjab", terms: ["punjab"] },
    { label: "Sindh", terms: ["sindh", "karachi"] },
  ],
  Myanmar: [
    { label: "Rakhine State", terms: ["rakhine", "arakan", "sittwe", "maungdaw"] },
    { label: "Shan State", terms: ["shan state", "lashio", "kokang", "laukkai", "muse"] },
    { label: "Sagaing Region", terms: ["sagaing", "kalay", "kale", "monywa", "shwebo"] },
    { label: "Kachin State", terms: ["kachin", "myitkyina", "bhamo", "hpakant"] },
    { label: "Kayah (Karenni) State", terms: ["kayah", "karenni", "loikaw"] },
    { label: "Karen State", terms: ["karen state", "kayin", "myawaddy", "hpa-an", "shwe kokko"] },
    { label: "Chin State", terms: ["chin state", "chinland", "hakha"] },
    { label: "Magway Region", terms: ["magway", "magwe", "gangaw"] },
  ],
  Philippines: [
    {
      label: "Mindanao",
      terms: [
        "mindanao", "marawi", "cotabato", "maguindanao", "bangsamoro", "barmm",
        "sulu", "jolo", "basilan", "zamboanga", "lanao", "sultan kudarat",
      ],
    },
  ],
  Thailand: [
    {
      label: "the Deep South",
      terms: ["pattani", "yala", "narathiwat", "deep south", "songkhla"],
    },
  ],
  Bangladesh: [
    {
      label: "the Chittagong Hill Tracts",
      terms: ["chittagong hill", "rangamati", "bandarban", "khagrachari"],
    },
  ],
  "West Papua": [
    {
      label: "the central highlands",
      terms: [
        "nduga", "intan jaya", "puncak", "ilaga", "yahukimo", "dekai", "paniai",
        "mimika", "timika", "grasberg", "freeport", "wamena",
      ],
    },
  ],
  "Papua New Guinea": [
    {
      label: "the Highlands",
      terms: ["highlands", "enga", "hela", "tari", "mount hagen", "porgera", "wabag"],
    },
  ],
};

// Word-boundary substring test (handles multi-word terms like "deep south").
function mentions(text: string, term: string): boolean {
  const haystack = ` ${text.toLowerCase()} `;
  const needle = term.toLowerCase();
  const isWordChar = (c: string | undefined) =>
    c !== undefined && /[a-z0-9]/.test(c);
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return false;
    if (!isWordChar(haystack[i - 1]) && !isWordChar(haystack[i + needle.length]))
      return true;
    from = i + needle.length;
  }
}

// Tally which named sub-national hotspots a theatre's incidents reference, by
// scanning each headline (+ summary). Returns hotspots ranked by how many
// incidents mention them, plus how many incidents matched any hotspot at all
// (the basis for "concentrated in X" vs "scattered" framing).
function detectHotspots(
  country: string,
  rows: ConflictEnrichedIncident[],
): { hits: HotspotHit[]; coveredCount: number } {
  const defs = COUNTRY_HOTSPOTS[country];
  if (!defs) return { hits: [], coveredCount: 0 };
  const counts = new Map<string, number>();
  let covered = 0;
  for (const r of rows) {
    const text = `${r.displayTitle ?? r.title} ${r.summary ?? ""}`;
    let matchedAny = false;
    for (const def of defs) {
      if (def.terms.some((t) => mentions(text, t))) {
        counts.set(def.label, (counts.get(def.label) ?? 0) + 1);
        matchedAny = true;
      }
    }
    if (matchedAny) covered += 1;
  }
  const order = defs.map((d) => d.label);
  const hits = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort(
      (a, b) =>
        b.count - a.count || order.indexOf(a.label) - order.indexOf(b.label),
    );
  return { hits, coveredCount: covered };
}

// Where a theatre's activity sits: the top named hotspots, and whether the
// reporting is concentrated enough to call it localised (most incidents in a
// named spot). Drives the honest "isolated to X, not countrywide" framing.
function focusOf(area: ConflictActivityArea): {
  labels: string[];
  localised: boolean;
  hasFocus: boolean;
} {
  const labels = area.hotspots.slice(0, 2).map((h) => h.label);
  if (labels.length === 0) return { labels, localised: false, hasFocus: false };
  const coverage =
    area.incidentCount > 0 ? area.hotspotCoveredCount / area.incidentCount : 0;
  return { labels, localised: coverage >= 0.5, hasFocus: true };
}

// ---------------------------------------------------------------------------
// Per-theatre paragraph (what / where / who / why-operationally / exposure).
// No parenthetical record counts — counts live only on the Fast Facts cards.
// Leads with the sub-national hotspots so a huge country is never painted as
// uniformly dangerous.
// ---------------------------------------------------------------------------
function buildAreaParagraph(area: ConflictActivityArea, rank: number): string {
  const what = activityPhrase(area.topCategories);
  const sev = area.worstSeverityLabel;
  const sevRank = SEV_RANK[area.worstSeverity] ?? 0;
  const deadly = area.casualtySignalCount > 0;
  const focus = focusOf(area);
  const where = joinList(focus.labels);

  // Opener — leads with the theatre name, then says WHERE inside the country
  // the activity actually sits. The verb varies by rank so the top three never
  // read off the same skeleton.
  const leadVerbs = [
    "led the watch this period",
    "ran close behind",
    "also stayed in the picture",
  ];
  const leadVerb =
    rank < leadVerbs.length ? leadVerbs[rank] : "carried lower-level activity";
  let focusSentence: string;
  if (focus.hasFocus && focus.localised) {
    focusSentence = `Activity stayed concentrated in ${where}, driven by ${what}, rather than spread across the country.`;
  } else if (focus.hasFocus) {
    focusSentence = `Activity clustered mainly around ${where}, driven by ${what}.`;
  } else {
    focusSentence = `Activity was driven by ${what}, with no single area standing out this period.`;
  }
  const open = `${area.theatre} ${leadVerb}. ${focusSentence}`;

  // Severity and human cost in plain language. The casualty branches keep the
  // explicit signal; numeric counts never appear in narrative prose.
  let toll: string;
  if (deadly && sevRank >= 4) {
    toll = `The sharpest incidents turned deadly, with casualties reported as severity peaked at ${sev}.`;
  } else if (deadly) {
    toll = `Some of the fighting drew blood, with casualties reported even as severity held at ${sev}.`;
  } else if (sevRank >= 4) {
    toll = `Severity climbed to ${sev}, though no casualties were confirmed.`;
  } else {
    toll = `Severity stayed contained at ${sev}.`;
  }

  // Operational read — names who is exposed and, when the activity is genuinely
  // localised, says plainly that the rest of the country is not the flashpoint.
  let read: string;
  if (focus.hasFocus && focus.localised) {
    read = `Exposure is local to ${where} — ${area.theatre}'s main cities and economic centres sit away from the fighting, so the real risk is to staff and sites inside those areas, not the country as a whole.`;
  } else if (focus.hasFocus) {
    read = `Exposure centres on staff and sites around ${where}, where movement and security calls get made.`;
  } else {
    read = `The practical concern is keeping staff clear of any flare-up and ready to move.`;
  }

  return [open, toll, read].join(" ");
}

function buildArea(
  theatre: string,
  rows: ConflictEnrichedIncident[],
): ConflictActivityArea {
  let worstKey = "";
  let worstRank = 0;
  let casualty = 0;
  let opScore = 0;
  let siteScore = 0;
  const impactCounts = new Map<string, number>();
  const catCounts = new Map<string, number>();
  for (const i of rows) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > worstRank) {
      worstRank = r;
      worstKey = k;
    }
    const impacts = detectOperationalImpacts(textOf(i));
    if (impacts.includes("Casualties reported")) casualty += 1;
    opScore += impacts.length;
    for (const l of impacts) {
      impactCounts.set(l, (impactCounts.get(l) ?? 0) + 1);
      if (SITE_MOVEMENT_IMPACTS.has(l)) siteScore += 1;
    }
    catCounts.set(i.issue, (catCounts.get(i.issue) ?? 0) + 1);
  }
  const topCategories = Array.from(catCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
  const topImpacts = Array.from(impactCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
  const latestDate = rows.reduce(
    (m, i) => (i.date > m ? i.date : m),
    rows[0]?.date ?? new Date(0),
  );
  const { hits: hotspots, coveredCount: hotspotCoveredCount } = detectHotspots(
    theatre,
    rows,
  );
  const area: ConflictActivityArea = {
    theatre,
    incidents: rows,
    worstSeverity: worstKey,
    worstSeverityLabel: worstKey ? SEV_LABEL[worstKey] : "—",
    casualtySignalCount: casualty,
    incidentCount: rows.length,
    operationalScore: opScore,
    siteMovementScore: siteScore,
    topCategories,
    topImpacts,
    hotspots,
    hotspotCoveredCount,
    latestDate,
    paragraph: "",
  };
  // Paragraph is assigned after ranking so it can vary by the theatre's
  // position in the table (see the main builder).
  return area;
}

function compareAreas(a: ConflictActivityArea, b: ConflictActivityArea): number {
  const ra = SEV_RANK[a.worstSeverity] ?? 0;
  const rb = SEV_RANK[b.worstSeverity] ?? 0;
  if (rb !== ra) return rb - ra;
  if (b.casualtySignalCount !== a.casualtySignalCount)
    return b.casualtySignalCount - a.casualtySignalCount;
  if (b.incidentCount !== a.incidentCount)
    return b.incidentCount - a.incidentCount;
  if (b.operationalScore !== a.operationalScore)
    return b.operationalScore - a.operationalScore;
  if (b.siteMovementScore !== a.siteMovementScore)
    return b.siteMovementScore - a.siteMovementScore;
  const td = b.latestDate.getTime() - a.latestDate.getTime();
  if (td !== 0) return td;
  return a.theatre.localeCompare(b.theatre);
}

// ---------------------------------------------------------------------------
// Fast Facts — conflict vocabulary (uses the conflict category classifier for
// the event-type card rather than the generic incident classifier).
// ---------------------------------------------------------------------------
function buildFastFacts(
  windowIncidents: ConflictEnrichedIncident[],
  reportingPeriod: string,
): TopicFastFactCard[] {
  const total = windowIncidents.length;

  let highestKey = "";
  let highestRank = 0;
  for (const i of windowIncidents) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > highestRank) {
      highestRank = r;
      highestKey = k;
    }
  }
  const highestLabel = highestKey ? SEV_LABEL[highestKey] : "—";

  const catCounts = new Map<string, number>();
  for (const i of windowIncidents)
    catCounts.set(i.issue, (catCounts.get(i.issue) ?? 0) + 1);
  let topCat = "—";
  let topCatN = 0;
  for (const [c, n] of catCounts)
    if (n > topCatN) {
      topCatN = n;
      topCat = c;
    }

  const countryCounts = new Map<string, number>();
  for (const i of windowIncidents)
    for (const c of splitAttributedCountries(i.country))
      countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
  let topCountry = "—";
  let topCountryN = 0;
  for (const [c, n] of countryCounts)
    if (n > topCountryN) {
      topCountryN = n;
      topCountry = c;
    }

  let latest = "—";
  const dates = windowIncidents
    .map((i) => i.date)
    .filter((d) => !isNaN(d.getTime()) && d.getTime() > 0);
  if (dates.length > 0) latest = format(dateMax(dates), "dd MMM yyyy");

  return [
    { label: "Reporting Period", value: reportingPeriod },
    {
      label: "Total Records",
      value: String(total),
      note: "Conflict incidents this period",
    },
    {
      label: "Highest Severity",
      value: highestLabel,
      severity: highestKey || undefined,
      note: highestKey ? "Highest rating this period" : undefined,
    },
    {
      label: "Top Event Type",
      value: topCat,
      note:
        topCatN > 0
          ? `${topCatN} record${topCatN === 1 ? "" : "s"}`
          : undefined,
    },
    {
      label: "Most Affected Country",
      value: topCountry === "—" ? "Country not identified" : topCountry,
      note:
        topCountryN > 0
          ? `${topCountryN} record${topCountryN === 1 ? "" : "s"}`
          : "Limited reporting",
    },
    { label: "Latest Incident", value: latest },
  ];
}

// ---------------------------------------------------------------------------
// Section prose (situation / other watched / what matters / watch next /
// polestar view). All derived from the ranked theatres so the words can never
// contradict the Top Activity Areas list.
// ---------------------------------------------------------------------------
const ZERO_SITUATION =
  "No armed activity was reported across the watched theatres this period. Read the quiet stretch as a gap in reporting rather than evidence the fighting has stopped; the standing kinetic exposures remain until fresh reporting lands.";
const ZERO_OTHER =
  "No other theatres carried notable armed activity this period.";
const ZERO_WHAT_MATTERS =
  "People safety, fixed-site security and evacuation readiness stay the operational concern across the watched theatres whether or not new reporting lands.";
const ZERO_WATCH_NEXT =
  "Renewed armed activity in any of the watched theatres.\nSecurity-force operations and lockdowns that close roads, checkpoints and districts at short notice.\nSpillover toward energy, transport or maritime infrastructure that turns a security event into a continuity one.";
const ZERO_POLESTAR =
  "Nothing actionable came through on conflict this period. The standing kinetic risks in the watched theatres remain, so the protective posture — travel limits, hardened sites and rehearsed evacuation — stays in place until reporting resumes.";

function buildSituation(
  areas: ConflictActivityArea[],
  worstKey: string,
  worstLabel: string,
): string {
  if (areas.length === 0) return ZERO_SITUATION;
  const lead = areas[0];
  const f = focusOf(lead);
  const where = joinList(f.labels);
  const second = areas[1]?.theatre ?? "";
  const focusTail = second ? `; ${second} is the next most active` : "";
  let leadClause: string;
  if (f.hasFocus && f.localised) {
    // Genuinely concentrated — safe to say the rest of the country is not the flashpoint.
    leadClause = `${lead.theatre} is the main pressure point, with the violence concentrated in ${where} rather than countrywide${focusTail}.`;
  } else if (f.hasFocus) {
    // Some named hotspots, but not most of the activity — name them without the countrywide-safety claim.
    leadClause = `${lead.theatre} is the main pressure point, with the worst of it around ${where}${focusTail}.`;
  } else {
    leadClause = `${lead.theatre} is the main pressure point${second ? `, with ${second} the next most active` : ""}.`;
  }
  const sevRank = SEV_RANK[worstKey] ?? 0;
  const sevClause =
    sevRank >= 4
      ? `The worst incidents reached ${worstLabel}, a casualty-grade level, so people safety leads the read.`
      : `The most serious activity reached ${worstLabel}.`;
  const opener =
    f.hasFocus && f.localised
      ? "Armed activity is the running backdrop across the watched theatres this period, but it sits in specific places rather than countrywide."
      : "Armed activity is the running backdrop across the watched theatres this period.";
  return `${opener} ${leadClause} ${sevClause} The read names where the fighting actually is and who is exposed, not just which countries are involved.`;
}

function buildOtherWatched(areas: ConflictActivityArea[]): string {
  if (areas.length === 0) return ZERO_OTHER;
  const parts = areas.slice(0, 6).map((a) => {
    const f = focusOf(a);
    return f.hasFocus ? `${a.theatre} (${joinList(f.labels)})` : a.theatre;
  });
  return `Lower-level activity also showed in ${joinList(parts)}. The record is thinner there this period, but any of them can climb the list quickly on a single clash or attack, so they stay on watch.`;
}

function buildWhatMatters(
  areas: ConflictActivityArea[],
  allImpacts: string[],
): string {
  if (areas.length === 0) return ZERO_WHAT_MATTERS;
  const lead = areas[0];
  const f = focusOf(lead);
  const where = f.hasFocus
    ? joinList(f.labels)
    : `the active districts in ${lead.theatre}`;
  const exposure = joinList(exposurePhrases(allImpacts).slice(0, 3));
  const exposureClause = exposure
    ? ` The clearest operational exposure runs to ${exposure}.`
    : "";
  const elsewhere =
    f.hasFocus && f.localised
      ? ` Operations elsewhere in ${lead.theatre} are largely unaffected.`
      : "";
  const para1 = `Kinetic events hit people before they hit operations — casualties, abductions and the danger to anyone near the fighting come first, then access, as checkpoints, road closures and security sweeps shut routes at short notice.`;
  const para2 = `The live pressure sits in ${where}.${exposureClause} Where a depot, worksite or convoy falls inside those areas, the call shifts from managing disruption to protecting and moving people.${elsewhere}`;
  return `${para1}\n\n${para2}`;
}

function buildWatchNext(
  areas: ConflictActivityArea[],
  categoriesPresent: Set<string>,
): string {
  if (areas.length === 0) return ZERO_WATCH_NEXT;
  const lines: string[] = [];
  const lead = areas[0];
  const f = focusOf(lead);
  const leadWhere = f.hasFocus ? joinList(f.labels) : lead.theatre;
  lines.push(
    `Fresh or escalating ${activityPhrase(lead.topCategories)} in ${leadWhere} — the clearest sign the fighting is widening rather than a one-off.`,
  );
  if (categoriesPresent.has("Bombings & Airstrikes"))
    lines.push(
      "Further bombing, airstrike or IED activity, which raises the threat to fixed sites and main routes within range.",
    );
  if (categoriesPresent.has("Abduction & Crime"))
    lines.push(
      "Abduction and armed-crime activity targeting staff, contractors or convoys.",
    );
  if (categoriesPresent.has("Insurgency"))
    lines.push(
      "Insurgent raids or ambushes that push the contested ground into new districts.",
    );
  lines.push(
    "Security-force operations and lockdowns that close roads, checkpoints and districts at short notice.",
  );
  lines.push(
    "Spillover toward energy, transport or maritime infrastructure that turns a security event into a continuity one.",
  );
  return lines.join("\n");
}

function buildPolestarView(
  areas: ConflictActivityArea[],
  worstKey: string,
): string {
  if (areas.length === 0) return ZERO_POLESTAR;
  const lead = areas[0];
  const fLead = focusOf(lead);
  const leadWhere = fLead.hasFocus
    ? `${joinList(fLead.labels)} in ${lead.theatre}`
    : lead.theatre;
  const others = areas.slice(1, 3).map((a) => {
    const fa = focusOf(a);
    return fa.hasFocus ? `${joinList(fa.labels)} in ${a.theatre}` : a.theatre;
  });
  const othersClause = others.length ? `, then ${joinList(others)}` : "";
  const grade = (SEV_RANK[worstKey] ?? 0) >= 4 ? "casualty-grade" : "contained but live";
  // Only claim the rest of the country carries on as normal when the lead theatre's
  // activity is genuinely concentrated in its named flashpoints.
  const watchTail =
    fLead.hasFocus && fLead.localised
      ? " — named flashpoints, not whole countries, and the rest of each country largely carries on as normal."
      : ".";
  return `Conflict Watch is flagging ${grade} kinetic risk, not a jump in headlines. The danger is to people first and continuity second, so the response is protective: hard travel limits, hardened sites and rehearsed evacuation, not headline tracking. The watch sits on ${leadWhere}${othersClause}${watchTail}`;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------
export function buildConflictReportDataset(
  incidents: ConflictReportIncident[],
  topic: string,
  issueDate: string,
): ConflictReportDataset {
  const win = resolveReportWindow(topic, issueDate);
  const windowRaw = filterTopicReportIncidents(incidents, topic, issueDate);

  const enriched: ConflictEnrichedIncident[] = windowRaw.map((i) => ({
    ...i,
    date: toDate(i.occurredAt),
    issue: CATEGORY_CARD_LABEL[classifyConflictCategory(textOf(i))],
  }));

  // Group enriched incidents by attributed country. Compound attributions
  // ("India; Pakistan") add the incident to BOTH theatres, matching how the
  // Fast Facts "Most Affected Country" card counts countries.
  const byCountry = new Map<string, ConflictEnrichedIncident[]>();
  for (const i of enriched) {
    for (const c of splitAttributedCountries(i.country)) {
      const arr = byCountry.get(c) ?? [];
      arr.push(i);
      byCountry.set(c, arr);
    }
  }

  const areas: ConflictActivityArea[] = [];
  for (const [theatre, rows] of byCountry) areas.push(buildArea(theatre, rows));
  areas.sort(compareAreas);
  // Paragraphs are written here, after ranking, so each theatre's opening and
  // operational read vary by its position — the top three never read off the
  // same template.
  areas.forEach((area, idx) => {
    area.paragraph = buildAreaParagraph(area, idx);
  });

  const topActivityAreas = areas.slice(0, 3);
  const otherWatchedTheatres = areas.slice(3);

  let worstKey = "";
  let worstRank = 0;
  for (const i of enriched) {
    const k = sevKey(i.severity);
    const r = SEV_RANK[k] ?? 0;
    if (r > worstRank) {
      worstRank = r;
      worstKey = k;
    }
  }
  const worstLabel = worstKey ? SEV_LABEL[worstKey] : "—";

  const categoriesPresent = new Set(enriched.map((i) => i.issue));
  const allImpacts = enriched.flatMap((i) => detectOperationalImpacts(textOf(i)));

  const relatedIncidents = selectRelatedIncidents(enriched, topic);

  return {
    reportingPeriodShort: win.shortLabel,
    reportingPeriodLong: `Reporting period: ${win.label}`,
    windowIncidents: enriched,
    fastFacts: buildFastFacts(enriched, win.shortLabel),
    topActivityAreas,
    otherWatchedTheatres,
    relatedIncidents,
    worstSeverity: worstKey,
    worstSeverityLabel: worstLabel,
    autoSituation: buildSituation(topActivityAreas, worstKey, worstLabel),
    autoOtherWatched: buildOtherWatched(otherWatchedTheatres),
    autoWhatMatters: buildWhatMatters(topActivityAreas, allImpacts),
    autoWatchNext: buildWatchNext(topActivityAreas, categoriesPresent),
    autoPolestarView: buildPolestarView(topActivityAreas, worstKey),
  };
}

// Phrases drawn from the legacy CONFLICT prose pack in draftReportProse.ts.
// When a saved report's editable field still carries one of these template
// seeds, the preview and PDF replace it with the data-driven auto-prose so
// already-saved Conflict reports stop showing boilerplate without a reseed.
const GENERIC_CONFLICT_PHRASES = [
  "kinetic, casualty-grade picture rather than a question of public order",
  "These are armed events",
  "protect people first, continuity second",
  "Armed activity is the standing condition across the watched theatres",
  "Conflict reporting was light this week",
  "Conflict reporting was quiet this week",
  "Kinetic events land first on people",
  "Set hard no-go limits on travel into contested districts",
  "Repeat or escalating clashes in the same area",
  "Conflict Watch is flagging kinetic, casualty-grade risk",
  "Armed activity remains the background condition",
  "People safety, site security and evacuation readiness stay the operational concern",
  "Nothing useful came through on conflict this week",
  "No notable armed activity came through",
  // Earlier data-driven auto-prose (pre sub-national-hotspot rewrite). Listed so
  // already-saved Conflict reports drop the country-only boilerplate and pick up
  // the location-led prose without a manual reseed.
  "Kinetic risk is a people-safety problem before it is a continuity one",
  "Kinetic events land on people first: casualties",
  "a sign of a widening operation rather than a one-off event",
  "the operational answer is protective",
];

export function isGenericConflictProse(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return GENERIC_CONFLICT_PHRASES.some((p) => t.includes(p));
}
