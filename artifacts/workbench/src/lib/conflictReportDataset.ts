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

// Lowercase a category card label for use mid-sentence ("Bombings &
// Airstrikes" -> "bombings and airstrikes").
function categoryPhrase(label: string): string {
  return label.toLowerCase().replace(/\s*&\s*/g, " and ");
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Short, comma-joined activity nouns that read naturally mid-sentence
// ("insurgent attacks, bombings and airstrikes"). Flat atoms avoid the doubled
// "and" you get from joining two "X and Y" category phrases.
const CATEGORY_ACTIVITY_ATOMS: Record<string, string[]> = {
  Insurgency: ["insurgent attacks"],
  "Bombings & Airstrikes": ["bombings", "airstrikes"],
  "Abduction & Crime": ["abductions", "armed crime"],
  "Armed Clashes": ["armed clashes"],
};
function activityList(topCategories: string[]): string {
  const atoms: string[] = [];
  for (const c of topCategories.slice(0, 2))
    atoms.push(...(CATEGORY_ACTIVITY_ATOMS[c] ?? [categoryPhrase(c)]));
  const unique = Array.from(new Set(atoms)).slice(0, 3);
  return unique.length ? joinList(unique) : "armed activity";
}

// Short, business-facing nouns for what the activity can hit, built from the
// detected impacts. Flat atoms (not multi-word "X and Y" phrases) so the joined
// list reads cleanly, always closing on "nearby worksites".
const IMPACT_ATOMS: Record<string, string[]> = {
  "Transport or checkpoint disruption": ["roads", "checkpoints", "convoy movement"],
  "Security-force or government targeting": ["government and security sites"],
  "Civilian harm or displacement": ["nearby communities"],
  "Energy or utility disruption": ["power and fuel sites"],
  "Aviation or maritime risk": ["airports and ports"],
};
function impactList(impacts: string[]): string {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const l of impacts) {
    if (l === "Casualties reported") continue;
    if (!counts.has(l)) order.push(l);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  order.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  const atoms: string[] = [];
  for (const l of order) atoms.push(...(IMPACT_ATOMS[l] ?? []));
  let unique = Array.from(new Set(atoms)).slice(0, 3);
  if (unique.length === 0) unique = ["roads", "checkpoints"];
  unique.push("nearby worksites");
  return joinList(unique);
}

// ---------------------------------------------------------------------------
// Concrete event extraction. The report's substance is the actual incidents —
// what happened, where and when — so the prose cites the period's standout
// events by name rather than describing risk in the abstract. Headlines carry
// the place ("...in Bannu", "...in Khyber Pakhtunkhwa"), so the cleaned
// headline plus its date is enough; no record counts ever appear.
// ---------------------------------------------------------------------------
function isCasualtyEvent(i: ConflictReportIncident): boolean {
  return detectOperationalImpacts(textOf(i)).includes("Casualties reported");
}

// Tidy a raw news headline for use as an event phrase: drop the trailing
// "| Source" tail and "– OpEd" marker, strip a leading "Place:" label (the
// place is named separately), and collapse whitespace.
function cleanHeadline(text: string): string {
  let t = (text ?? "").trim();
  if (!t) return "";
  t = t.split(" | ")[0]!.trim();
  t = t.replace(/\s*[–—-]\s*OpEd\s*$/i, "").trim();
  t = t.replace(/^[A-Z][A-Za-z'’.&\- ]{2,22}:\s+/, "").trim();
  return t.replace(/\s+/g, " ").trim();
}

// Lowercase a leading ordinary word so a headline reads naturally mid-sentence
// ("Police kill five" -> "police kill five"), but leave acronyms (NIA, TTP)
// untouched.
function lcFirst(s: string): string {
  if (!s) return s;
  const first = s.split(/\s+/)[0] ?? "";
  if (/^[A-Z]{2,}$/.test(first)) return s;
  if (/^[A-Z][a-z]+$/.test(first)) return s[0]!.toLowerCase() + s.slice(1);
  return s;
}

// One concrete event clause: cleaned headline + date, e.g. "four suicide
// bombers killed as security forces repelled an attack ... on 15 Jun".
function eventClause(i: ConflictEnrichedIncident): string {
  const head = lcFirst(cleanHeadline(i.displayTitle ?? i.title));
  const when =
    !isNaN(i.date.getTime()) && i.date.getTime() > 0
      ? ` on ${format(i.date, "d MMM")}`
      : "";
  return `${head}${when}`;
}

// The most significant incidents in a theatre: worst severity first, then
// casualty signal, then most recent.
function topEvents(
  rows: ConflictEnrichedIncident[],
  max: number,
): ConflictEnrichedIncident[] {
  return [...rows]
    .map((i) => ({
      i,
      sev: SEV_RANK[sevKey(i.severity)] ?? 0,
      deadly: isCasualtyEvent(i) ? 1 : 0,
      t: i.date.getTime(),
    }))
    .sort((a, b) => b.sev - a.sev || b.deadly - a.deadly || b.t - a.t)
    .slice(0, max)
    .map((x) => x.i);
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

// The lead theatre's hotspots are named IN FULL once in the Situation overview
// and once in the theatre's own Top-Activity block. Downstream sections (What
// Matters / Watch Next / Polestar View) must NOT re-list the same multi-region
// phrase — that is exactly the "Afghan border and Khyber Pakhtunkhwa six times"
// repetition readers complained about. They refer back instead to a SINGLE
// primary hotspot or a generic "worst-hit areas" phrase.
function primaryHotspot(f: { labels: string[]; hasFocus: boolean }): string {
  return f.hasFocus && f.labels.length ? f.labels[0] : "";
}

// Theatres running at a similar volume to the top theatre SHARE the lead. Calling
// a co-equal theatre "quieter" or "at a lower level" contradicts the per-theatre
// counts the reader can see in the report body — the exact contradiction flagged
// on the live report, where Pakistan and India were tied yet India was demoted to
// "quieter". A theatre co-leads when its incident count is within ~25% of the top
// theatre's; the minimum-top guard keeps thin, noisy windows on single-lead
// phrasing rather than calling 1-vs-1 samples "co-leaders".
const CO_LEAD_RATIO = 0.75;
const CO_LEAD_MIN_TOP = 4;
function leadTheatres(
  areas: ConflictActivityArea[],
): ConflictActivityArea[] {
  if (areas.length === 0) return [];
  const top = areas[0].incidentCount;
  const leaders = [areas[0]];
  if (top < CO_LEAD_MIN_TOP) return leaders;
  for (let i = 1; i < areas.length; i++) {
    if (areas[i].incidentCount >= top * CO_LEAD_RATIO) leaders.push(areas[i]);
    else break;
  }
  return leaders.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Per-theatre paragraph (what / where / who / why-operationally / exposure).
// No parenthetical record counts — counts live only on the Fast Facts cards.
// Leads with the sub-national hotspots so a huge country is never painted as
// uniformly dangerous.
// ---------------------------------------------------------------------------
function buildAreaParagraph(area: ConflictActivityArea, rank: number): string {
  const activity = activityList(area.topCategories);
  const impacts = impactList(area.topImpacts);
  const sev = area.worstSeverityLabel;
  const sevRank = SEV_RANK[area.worstSeverity] ?? 0;
  const deadly = area.casualtySignalCount > 0;
  const focus = focusOf(area);
  const where = joinList(focus.labels);

  // Position line — varies by rank so the top three never open the same way.
  const positions = ["is the main concern", "comes next", "is also on the list"];
  const position =
    rank < positions.length ? positions[rank] : "is worth watching";

  // Where the activity sits and what it can hit, in one natural sentence. The
  // "rest of the country is quieter" reassurance is added only when the activity
  // is genuinely localised (≥50% of incidents in named hotspots) — never for a
  // scattered theatre, which would falsely imply the rest is safe.
  let placeSentence: string;
  if (focus.hasFocus && focus.localised) {
    placeSentence = `The worst activity sits around ${where}, where ${activity} can quickly affect ${impacts}. The rest of ${area.theatre} is far quieter.`;
  } else if (focus.hasFocus) {
    placeSentence = `The worst activity sits around ${where}, where ${activity} can quickly affect ${impacts}.`;
  } else {
    placeSentence = `Activity is spread across the country, with ${activity} the main pattern and ${impacts} most at risk.`;
  }

  // Concrete events — the actual standout incidents, named with their dates.
  const events = topEvents(area.incidents, 2);
  let eventSentence = "";
  if (events.length > 1) {
    eventSentence = `Recent incidents include ${eventClause(events[0])} and ${eventClause(events[1])}.`;
  } else if (events.length === 1) {
    eventSentence = `The most serious was ${eventClause(events[0])}.`;
  }

  // Brief, honest severity / casualty note — "deadly" only when the casualty
  // signal is real, never on severity rank alone.
  let toll = "";
  if (deadly) {
    toll = "Some of these attacks have been deadly.";
  } else if (sevRank >= 4) {
    toll = `Severity has reached ${sev}, though no deaths have been confirmed.`;
  }

  return [`${area.theatre} ${position}.`, placeSentence, eventSentence, toll]
    .filter(Boolean)
    .join(" ");
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
  "No armed activity was reported across the watched theatres this period. Treat the quiet stretch as a gap in reporting rather than proof the fighting has stopped, and keep the standing risks under review until fresh reporting lands.";
const ZERO_OTHER =
  "No other theatres carried notable armed activity this period.";
const ZERO_WHAT_MATTERS =
  "With nothing new to act on, the priorities stay the same: keeping people safe, securing fixed sites and keeping an evacuation plan ready across the watched theatres.";
const ZERO_WATCH_NEXT =
  "Any renewed armed activity in the watched theatres.\nSecurity operations or lockdowns that close roads, checkpoints and districts at short notice.\nAny spread toward energy, transport or port infrastructure that turns a security event into a business-continuity one.";
const ZERO_POLESTAR =
  "Nothing actionable came through on conflict this period. The standing risks in the watched theatres remain, so keep travel limits, site security and a rehearsed evacuation plan in place until reporting resumes.";

function buildSituation(
  areas: ConflictActivityArea[],
  worstKey: string,
  worstLabel: string,
): string {
  if (areas.length === 0) return ZERO_SITUATION;
  const lead = areas[0];
  const f = focusOf(lead);
  const where = joinList(f.labels);
  const leaders = leadTheatres(areas);
  let placeSentence: string;
  let othersStart: number;
  if (leaders.length > 1) {
    // Co-leading theatres get equal billing — a tied theatre is never demoted.
    placeSentence = `${joinList(
      leaders.map((a) => a.theatre),
    )} are the main concerns this period, running at similar levels.`;
    othersStart = leaders.length;
  } else {
    placeSentence = f.hasFocus
      ? `${lead.theatre} is the main concern, with the worst activity around ${where}.`
      : `${lead.theatre} is the main concern this period.`;
    othersStart = 1;
  }
  // The standout incident is drawn from across the co-leaders, not just areas[0].
  const leadEvent = topEvents(
    leaders.flatMap((a) => a.incidents),
    1,
  )[0];
  const evSentence = leadEvent
    ? ` The most serious incident was ${eventClause(leadEvent)}.`
    : "";
  const others = areas.slice(othersStart, othersStart + 2).map((a) => a.theatre);
  const othersSentence = others.length
    ? ` ${joinList(others)} also saw activity, at a lower level.`
    : "";
  return `${placeSentence}${evSentence}${othersSentence}`;
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
  // Refer back to the worst-hit areas generically — they are named in full in
  // the Situation overview and the lead theatre block above.
  const where = f.hasFocus
    ? `the worst-hit parts of ${lead.theatre}`
    : `the affected areas in ${lead.theatre}`;
  const para1 = `The priority is people. Anyone travelling through or working near ${where} risks being caught in an attack, a security sweep, a checkpoint or a sudden road closure.`;
  const scope =
    f.hasFocus && f.localised
      ? `tighter precautions where the violence is concentrated, rather than a blanket change across the rest of ${lead.theatre}`
      : `tighter precautions wherever the activity is heaviest, reviewed as the picture shifts`;
  const para2 = `For business, that means ${scope}. Plan journeys and routes with care, confirm site access before staff set out, and give every depot, worksite and route a clear way to pause, reroute or pull people out at short notice. Set your evacuation triggers now, while there is still room to decide calmly.`;
  return `${para1}\n\n${para2}`;
}

function buildWatchNext(
  areas: ConflictActivityArea[],
  categoriesPresent: Set<string>,
): string {
  if (areas.length === 0) return ZERO_WATCH_NEXT;
  const lead = areas[0];
  const f = focusOf(lead);
  // A single primary hotspot here, not the full list — the full hotspot phrase
  // is already named in the Situation overview and the lead theatre block.
  // "around <hotspot>" reads naturally for region and border/belt labels alike;
  // fall back to "in <theatre>" when the theatre has no clear focus.
  const primary = primaryHotspot(f);
  const leadWhere = primary ? `around ${primary}` : `in ${lead.theatre}`;
  const activity = activityList(lead.topCategories);
  const lines: string[] = [];
  lines.push(
    `Expect further ${activity} ${leadWhere}. The signal to watch is repetition — the same districts or routes being hit more than once.`,
  );
  lines.push(
    `The clearest sign of escalation is spread: violence reaching neighbouring areas, or fresh checkpoints, road closures and curfews. That would mean the fighting is widening rather than easing.`,
  );
  if (categoriesPresent.has("Abduction & Crime"))
    lines.push(
      "Watch closely for abductions or fresh casualty reports, particularly anything aimed at staff, contractors or convoys.",
    );
  lines.push(
    "Above all, watch for any attack close to a depot, worksite, convoy route or key infrastructure. That is the point where this stops being background reading and becomes a live duty-of-care concern.",
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
  // Name a single primary hotspot (honesty: still points at the flashpoint)
  // without re-listing the full multi-region phrase used earlier.
  const primary = primaryHotspot(fLead);
  const leaders = leadTheatres(areas);
  let opening: string;
  if (leaders.length > 1) {
    // Co-leading theatres are named jointly; only the genuinely smaller theatres
    // below them are "lower-level" — never a co-equal one.
    const rest = areas
      .slice(leaders.length, leaders.length + 2)
      .map((a) => a.theatre);
    const tail = rest.length
      ? `, with ${joinList(rest)} lower-level but still worth watching`
      : "";
    opening = `Armed activity is running at similar levels across ${joinList(
      leaders.map((a) => a.theatre),
    )} this period${tail}.`;
  } else {
    const others = areas.slice(1, 3).map((a) => a.theatre);
    const tail = others.length
      ? `, with ${joinList(others)} quieter but still worth watching`
      : "";
    // The concentration claim is scoped to WITHIN the lead theatre — it is not a
    // claim that the lead holds most of the whole period's activity, which is
    // false when several theatres are active.
    opening = primary
      ? `${lead.theatre} carries the most armed activity this period, concentrated around ${primary}${tail}.`
      : `${lead.theatre} carries the most armed activity this period${tail}.`;
  }
  const action = ` The response is straightforward: keep people clear of the worst-hit areas, tighten journey and route planning, protect the sites that matter most, and agree evacuation triggers well in advance.`;
  return `${opening}${action}`;
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
  // Superseded auto-prose (pre concrete-events rewrite). Saved Conflict reports
  // carrying these phrases drop the abstract boilerplate and pick up the new
  // event-led prose without a manual reseed.
  "Armed activity is the running backdrop across the watched theatres",
  "Kinetic events hit people before they hit operations",
  "kinetic risk, not a jump in headlines",
  "the clearest sign the fighting is widening rather than a one-off",
  // Superseded auto-prose (pre natural-voice rewrite). Saved Conflict reports
  // carrying these phrases drop the stilted boilerplate and pick up the plainer
  // event-led prose without a manual reseed.
  "is the main pressure point",
  "These were violent and, in places, deadly events",
  "The pressure is concentrated in",
  "ready to move people out at short notice, not just to manage delays",
  "which would show the fighting is widening rather than easing",
  "named flashpoints, not whole countries",
  "so the response is protective: firm limits on travel into those areas",
  // Superseded auto Polestar (pre "country-wide" removal). Saved reports carrying
  // these drop the confusing single-country framing for the location-led read.
  "It is a focused armed-risk picture",
  "The business response should be focused",
  // Superseded auto prose (pre plainer-voice rewrite of What Matters / Watch Next
  // / Polestar action). Saved reports carrying these reseed the cleaner wording.
  "The first issue is simple",
  "could be caught up in attacks",
  "Firm up journey planning and route choice",
  "keep an eye on site access",
  "before anyone is under pressure",
  "especially if the same districts or routes are hit again",
  "The clearest escalation sign is spread",
  "background reporting into a live duty-of-care problem",
  "The practical response is clear",
  "keep people away from the worst-hit areas",
];

export function isGenericConflictProse(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return GENERIC_CONFLICT_PHRASES.some((p) => t.includes(p));
}
