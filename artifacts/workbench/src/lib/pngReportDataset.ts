// PNG (Papua New Guinea) structured country-brief dataset builder.
//
// Builds the nine-section Papua New Guinea security brief from the live
// incident feed. PNG only: this module is invoked exclusively for the PNG
// country report, so its broadened scope and derived attributes never leak
// into any other country report or the topic monitors.
//
// Per-item extraction (province / category / business impact / occurred-vs-
// reported date) MIRRORS the canonical server-side rulebook in
// `lib/ingest/src/pngExtract.ts`. The report derives client-side so it renders
// identical output in dev and prod regardless of whether the nullable DB
// columns have been backfilled yet (prod is read-only from the workspace and
// only populates those columns after a republish + ingest). Keep the two copies
// in lockstep: any change to province keys or category rules belongs in BOTH.

// ---------------------------------------------------------------------------
// Input shape (permissive — the page passes CountryFastFactsIncident objects,
// which at runtime also carry `confidence` even though that field is not on the
// narrow type). Everything except title/severity/occurredAt is optional.
// ---------------------------------------------------------------------------
export interface PngSourceIncident {
  id?: number | string;
  title: string;
  displayTitle?: string | null;
  summary?: string | null;
  severity: string;
  occurredAt: string;
  country?: string | null;
  location?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  resolvedUrl?: string | null;
  confidence?: string | null;
  // Server-extracted PNG enrichment (see lib/ingest/src/pngExtract.ts), surfaced
  // through the incidents API. When present these are authoritative and the
  // client derivation below is skipped; when null (non-PNG / not-yet-backfilled
  // rows, e.g. prod before a republish+ingest) the client falls back to the
  // mirrored rulebook so the report renders identically either way.
  province?: string | null;
  category?: string | null;
  businessImpact?: string | null;
  incidentDate?: string | null;
}

// ---------------------------------------------------------------------------
// Province resolution (mirror of pngExtract.PNG_PROVINCE_BY_CITY)
// ---------------------------------------------------------------------------
const PNG_PROVINCE_BY_CITY: Record<string, string> = {
  "port moresby": "National Capital District",
  "nine mile": "National Capital District",
  bomana: "National Capital District",
  gerehu: "National Capital District",
  boroko: "National Capital District",
  waigani: "National Capital District",
  gordons: "National Capital District",
  gordon: "National Capital District",
  "six mile": "National Capital District",
  hohola: "National Capital District",
  badili: "National Capital District",
  koki: "National Capital District",
  hanuabada: "National Capital District",
  ncd: "National Capital District",
  "west taraka": "Morobe",
  taraka: "Morobe",
  lae: "Morobe",
  nadzab: "Morobe",
  bumbu: "Morobe",
  eriku: "Morobe",
  bulolo: "Morobe",
  wau: "Morobe",
  morobe: "Morobe",
  kagamuga: "Western Highlands",
  "mount hagen": "Western Highlands",
  "mt hagen": "Western Highlands",
  banz: "Jiwaka",
  minj: "Jiwaka",
  madang: "Madang",
  goroka: "Eastern Highlands",
  kainantu: "Eastern Highlands",
  wewak: "East Sepik",
  maprik: "East Sepik",
  enga: "Enga",
  wabag: "Enga",
  porgera: "Enga",
  wapenamanda: "Enga",
  tari: "Hela",
  hela: "Hela",
  komo: "Hela",
  mendi: "Southern Highlands",
  ialibu: "Southern Highlands",
  kokopo: "East New Britain",
  rabaul: "East New Britain",
  kimbe: "West New Britain",
  bougainville: "Bougainville",
  buka: "Bougainville",
  arawa: "Bougainville",
  panguna: "Bougainville",
  vanimo: "West Sepik",
  kerema: "Gulf",
  popondetta: "Oro",
  alotau: "Milne Bay",
  daru: "Western",
  kavieng: "New Ireland",
  lorengau: "Manus",
};

const PROVINCE_KEYS = Object.keys(PNG_PROVINCE_BY_CITY).sort((a, b) => b.length - a.length);

function hasWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack);
}

function derivePngProvince(location: string | null | undefined, text: string): string | null {
  const loc = (location ?? "").trim().toLowerCase();
  if (loc && PNG_PROVINCE_BY_CITY[loc]) return PNG_PROVINCE_BY_CITY[loc];
  const hay = `${location ?? ""} ${text}`;
  for (const key of PROVINCE_KEYS) {
    if (hasWord(hay, key)) return PNG_PROVINCE_BY_CITY[key];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Category + business impact (mirror of pngExtract.CATEGORY_RULES)
// ---------------------------------------------------------------------------
export type PngCategory =
  | "Armed robbery / hold-up"
  | "Tribal / communal violence"
  | "Homicide / violent crime"
  | "Theft / break-in"
  | "Civil unrest / protest"
  | "Policing operation"
  | "Community policing"
  | "Intelligence / training"
  | "Corrections / detention"
  | "Aviation / airport"
  | "Maritime / port"
  | "Road / highway"
  | "Power / utilities"
  | "Telecoms / connectivity"
  | "Government stability"
  | "Other security";

const CATEGORY_RULES: Array<{ re: RegExp; category: PngCategory; impact: string }> = [
  {
    re: /\b(armed robbery|hold[- ]?up|carjack(?:ing|ed)?|stick[- ]?up|heist)\b/i,
    category: "Armed robbery / hold-up",
    impact: "Direct threat to staff, cash-in-transit and premises in the affected area; review movement and security cover.",
  },
  {
    re: /\b(tribal (?:fight|clash|war|warfare|violence|conflict)|payback (?:killing|attack)|inter[- ]?clan|clan (?:fight|war|clash)|communal (?:violence|clash))\b/i,
    category: "Tribal / communal violence",
    impact: "Road closures, supply-chain disruption and personnel-movement risk across the affected district.",
  },
  {
    re: /\b(murder(?:ed|s)?|homicide|manslaughter|massacre|shot dead|stabb(?:ed|ing)|gunned down|beaten to death|found dead|fatalit(?:y|ies)|killed)\b/i,
    category: "Homicide / violent crime",
    impact: "Heightened personal-security risk locally; review after-hours exposure and movement protocols.",
  },
  {
    re: /\b(community polic\w*|neighbou?rhood watch|police (?:partnership|community)|safe (?:city|community)|crime[- ]?prevention (?:launch|program|programme|initiative))\b/i,
    category: "Community policing",
    impact: "Net positive for the local security posture; limited direct operational impact.",
  },
  {
    re: /\b(intelligence (?:training|unit|sharing|gathering|course|workshop|capabilit\w*)|police training|capacity[- ]?building|train(?:ing|ed) (?:of |for )?(?:officers|police|recruits|personnel))\b/i,
    category: "Intelligence / training",
    impact: "Security capacity-building; no direct operational disruption expected.",
  },
  {
    re: /\b(correctional (?:service|institution|facility|officers?)|warders?|prison (?:break|escape|riot|unrest|officers?|inmates?)|jail ?break|inmates? escape|cell block)\b/i,
    category: "Corrections / detention",
    impact: "Localised security-force activity; limited direct commercial impact unless escapees are at large.",
  },
  {
    re: /\b(airport|airstrip|airfield|runway|aviation|air ?services|flights?|aircraft)\b/i,
    category: "Aviation / airport",
    impact: "Possible flight-schedule and airport-access disruption affecting travel and air freight.",
  },
  {
    re: /\b(wharf|jetty|port (?:closure|shut|disrupt\w*|congestion|operations?|security)|harbou?r|shipping|maritime|vessel|ferry)\b/i,
    category: "Maritime / port",
    impact: "Possible cargo-handling and port-access disruption affecting sea freight.",
  },
  {
    re: /\b(highway|road (?:closed|cut|block\w*|landslip|landslide|washed|sealed)|bridge (?:collapse|washed|down|out)|landslip|landslide blocks?)\b/i,
    category: "Road / highway",
    impact: "Overland freight and personnel-movement disruption on the affected corridor.",
  },
  {
    re: /\b(power (?:outage|blackout|cut|failure|shortage|rationing|crisis)|electricity (?:outage|blackout|cut|crisis)|grid (?:failure|down)|png power|fuel (?:shortage|crisis|outage|ran out|rationing|supply))\b/i,
    category: "Power / utilities",
    impact: "Operational disruption from power/fuel interruption; check site continuity and backup supply.",
  },
  {
    re: /\b(telecom\w*|telecommunication\w*|internet (?:outage|down|disrupt\w*|cut)|network (?:outage|down|disrupt\w*)|mobile (?:network|service) (?:down|outage|disrupt\w*)|digicel|connectivity)\b/i,
    category: "Telecoms / connectivity",
    impact: "Connectivity disruption; verify communications redundancy at affected sites.",
  },
  {
    re: /\b(vote of no confidence|government (?:shutdown|instability|stability|crisis|standoff)|political (?:crisis|instability|standoff)|public servants? strike|cabinet (?:reshuffle|crisis)|parliament\w* (?:standoff|deadlock|impasse))\b/i,
    category: "Government stability",
    impact: "Political-risk signal; monitor for downstream policy and security effects.",
  },
  {
    re: /\b(protest|demonstration|rally|march|riot|unrest|looting|roadblock|road block|strike|walkout|stoppage|picket|public disorder)\b/i,
    category: "Civil unrest / protest",
    impact: "Potential road blockages, business closures and movement restrictions in the affected area.",
  },
  {
    re: /\b(theft|stolen|burglary|break[- ]?in|looting|robbery|robbed)\b/i,
    category: "Theft / break-in",
    impact: "Property and asset-security risk; review premises security in the affected area.",
  },
  {
    re: /\b(police (?:operation|raid|swoop|patrol|deployment|crackdown)|joint (?:operation|patrol|task ?force)|raid(?:ed|s)?|swoop|manhunt|arrest(?:ed|s)?|detain(?:ed|ee|ees)?|apprehend\w*|wanted (?:man|men|criminal|suspect|fugitive))\b/i,
    category: "Policing operation",
    impact: "Localised disruption and checkpoints; short-term access constraints possible.",
  },
];

const OTHER_SECURITY_IMPACT =
  "Security-relevant development; monitor for operational follow-on in the affected area.";

function extractCategory(text: string): { category: PngCategory; impact: string } {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(text)) return { category: rule.category, impact: rule.impact };
  }
  return { category: "Other security", impact: OTHER_SECURITY_IMPACT };
}

// ---------------------------------------------------------------------------
// Occurred-vs-reported date (mirror of pngExtract.derivePngIncidentDate)
// ---------------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_ALT =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DMY_RE = new RegExp(
  String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_ALT})\b(?:[,\s]+(\d{4}))?`,
  "gi",
);
const MDY_RE = new RegExp(
  String.raw`\b(${MONTH_ALT})\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:[,\s]+(\d{4}))?`,
  "gi",
);

function derivePngIncidentDate(text: string, pubDate: Date): Date | null {
  const pubMs = pubDate.getTime();
  if (Number.isNaN(pubMs)) return null;
  const minMs = pubMs - 200 * 24 * 60 * 60 * 1000;
  const distinctMs = pubMs - 2 * 24 * 60 * 60 * 1000;
  const pubYear = pubDate.getUTCFullYear();
  const candidates: number[] = [];
  const collect = (day: number, month: number | undefined, yearStr: string | undefined) => {
    if (month === undefined || !day || day < 1 || day > 31) return;
    const year = yearStr ? Number(yearStr) : pubYear;
    let d = Date.UTC(year, month, day);
    if (!yearStr && d > pubMs) d = Date.UTC(year - 1, month, day);
    if (d >= minMs && d <= distinctMs) candidates.push(d);
  };
  let m: RegExpExecArray | null;
  DMY_RE.lastIndex = 0;
  while ((m = DMY_RE.exec(text)) !== null) collect(Number(m[1]), MONTHS[m[2].toLowerCase()], m[3]);
  MDY_RE.lastIndex = 0;
  while ((m = MDY_RE.exec(text)) !== null) collect(Number(m[2]), MONTHS[m[1].toLowerCase()], m[3]);
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates));
}

// ---------------------------------------------------------------------------
// Title cleanup (strip a trailing " - Publisher" masthead)
// ---------------------------------------------------------------------------
function cleanTitle(title: string | null | undefined, source: string | null | undefined): string {
  let t = (title ?? "").trim();
  const src = (source ?? "").trim();
  if (!t) return "";
  const seps = [" - ", " — ", " – ", " | "];
  if (src) {
    for (const sep of seps) {
      const suffix = `${sep}${src}`;
      if (t.toLowerCase().endsWith(suffix.toLowerCase())) return t.slice(0, t.length - suffix.length).trim();
    }
  }
  const m = t.match(/^(.*\S)\s[-–—|]\s([^-–—|]{2,40})$/);
  if (m) {
    const tail = m[2].trim();
    const wordCount = tail.split(/\s+/).length;
    const looksLikeMasthead = /\b(news|times|post|herald|guardian|reuters|bloomberg|daily|tribune|gazette|journal|chronicle|observer|telegraph|press|wire|report|today|mail|express|standard|abc|bbc|cnn|afp|rnz|pngfm|loop|bulletin|review|insider|monitor|dispatch|courier|sun|star|globe|record|digest|radio|tv|online|media|emtv|national)\b/i.test(tail);
    if (wordCount <= 6 && !/\d/.test(tail) && looksLikeMasthead) return m[1].trim();
  }
  return t;
}

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------
const SEV_RANK: Record<string, number> = { insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5 };
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme",
};

// Empty-location fallback — EXACT wording required by the brief spec.
export const PNG_EMPTY_LOCATION_FALLBACK =
  "No fresh publicly reported protest, theft, robbery or major crime incident identified in open sources for this location during the reporting period.";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface PngReportItem {
  id: string;
  title: string;
  province: string | null;
  category: PngCategory;
  businessImpact: string;
  severity: string;
  severityLabel: string;
  severityRank: number;
  reportedDate: Date;
  incidentDate: Date | null;
  occurredEarlier: boolean;
  source: string;
  url: string | null;
  confidence: string;
}

export interface PngDiagnostics {
  totalInWindow: number;
  bySource: Array<{ source: string; count: number }>;
  byConfidence: Array<{ confidence: string; count: number }>;
  occurredEarlierCount: number;
  watchlistGaps: string[];
  thirtyDayCount: number;
  ninetyDayCount: number;
}

export interface PngReportDataset {
  periodLabel: string;
  executiveSummary: string;
  topThree: PngReportItem[];
  ncd: PngReportItem[];
  morobe: PngReportItem[];
  westernHighlands: PngReportItem[];
  otherNational: PngReportItem[];
  businessImpact: string[];
  outlook: string;
  diagnostics: PngDiagnostics;
  windowItems: PngReportItem[];
}

interface BuildArgs {
  windowIncidents: PngSourceIncident[];
  thirtyDay: PngSourceIncident[];
  ninetyDay: PngSourceIncident[];
  baselineWatchlist: string[];
  periodLabel: string;
}

function toItem(i: PngSourceIncident): PngReportItem {
  const text = `${i.title ?? ""} ${i.summary ?? ""}`;
  // Prefer the server-extracted enrichment from the incidents API; fall back to
  // the mirrored client rulebook only when the API value is absent (non-PNG or
  // not-yet-backfilled rows). province / category / businessImpact / incidentDate
  // are all additive and nullable, so this is a clean prefer-server-else-derive.
  const province = i.province ?? derivePngProvince(i.location, text);
  let category: PngCategory;
  let impact: string;
  if (i.category && i.businessImpact) {
    // category + businessImpact are written together by the ingest rulebook, so
    // they are present or absent as a pair; trust them as a unit when present.
    category = i.category as PngCategory;
    impact = i.businessImpact;
  } else {
    const derived = extractCategory(text);
    category = derived.category;
    impact = derived.impact;
  }
  const sev = (i.severity ?? "").toLowerCase();
  const reportedDate = new Date(i.occurredAt);
  const incidentDate = i.incidentDate
    ? new Date(i.incidentDate)
    : derivePngIncidentDate(text, reportedDate);
  const title =
    i.displayTitle && i.displayTitle.trim() ? i.displayTitle.trim() : cleanTitle(i.title, i.source);
  return {
    id: String(i.id ?? `${i.title}-${i.occurredAt}`),
    title,
    province,
    category,
    businessImpact: impact,
    severity: sev,
    severityLabel: SEV_LABEL[sev] ?? (i.severity ?? ""),
    severityRank: SEV_RANK[sev] ?? 0,
    reportedDate,
    incidentDate,
    occurredEarlier: incidentDate != null,
    source: (i.source ?? "").trim(),
    url: (i.resolvedUrl ?? i.sourceUrl ?? null) || null,
    confidence: (i.confidence ?? "").trim().toLowerCase() || "unrated",
  };
}

function sortBySeverityThenRecency(a: PngReportItem, b: PngReportItem): number {
  if (b.severityRank !== a.severityRank) return b.severityRank - a.severityRank;
  const da = (a.incidentDate ?? a.reportedDate).getTime();
  const db = (b.incidentDate ?? b.reportedDate).getTime();
  return db - da;
}

function joinList(parts: string[]): string {
  const clean = parts.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

function topLabels<T>(items: T[], key: (t: T) => string, n: number): string[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// Collapse syndicated re-runs of the same story. Feeds carry the same incident
// under near-identical headlines (with/without a " - Publisher" masthead) from
// several outlets; after cleanTitle they normalise to the same string. Keep one
// representative per normalised title — the best by severity then recency — so
// the report never shows the same event twice.
function dedupKey(title: string): string {
  let t = title.toLowerCase().trim();
  // Drop a trailing " - Publisher"-style segment that some feeds append even
  // when it does not match the row's own source (so cleanTitle left it on).
  // Only strip it when the surviving prefix is still a substantial headline.
  const m = t.match(/^(.*\S)\s[-–—|]\s+(.{1,40})$/);
  if (m && m[1].trim().split(/\s+/).length >= 5) t = m[1];
  return t.replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupeByTitle(items: PngReportItem[]): PngReportItem[] {
  const best = new Map<string, PngReportItem>();
  for (const it of items) {
    const key = dedupKey(it.title);
    if (!key) {
      best.set(it.id, it);
      continue;
    }
    const prev = best.get(key);
    if (!prev || sortBySeverityThenRecency(it, prev) < 0) best.set(key, it);
  }
  return Array.from(best.values());
}

export function buildPngReportDataset(args: BuildArgs): PngReportDataset {
  const { windowIncidents, thirtyDay, ninetyDay, baselineWatchlist, periodLabel } = args;
  const windowItems = dedupeByTitle(windowIncidents.map(toItem));

  const ncd = windowItems
    .filter((it) => it.province === "National Capital District")
    .sort(sortBySeverityThenRecency);
  const morobe = windowItems.filter((it) => it.province === "Morobe").sort(sortBySeverityThenRecency);
  const westernHighlands = windowItems
    .filter((it) => it.province === "Western Highlands")
    .sort(sortBySeverityThenRecency);
  const regionalProvinces = new Set(["National Capital District", "Morobe", "Western Highlands"]);
  const otherNational = windowItems
    .filter((it) => !it.province || !regionalProvinces.has(it.province))
    .sort(sortBySeverityThenRecency);

  const topThree = [...windowItems].sort(sortBySeverityThenRecency).slice(0, 3);

  // --- Executive summary (deterministic, event-led, no parenthetical counts) -
  let executiveSummary: string;
  if (windowItems.length === 0) {
    executiveSummary = `${PNG_EMPTY_LOCATION_FALLBACK} The standing operating picture for Papua New Guinea carries over from the preceding period; treat the absence of fresh reporting as a coverage signal, not as an improvement in conditions.`;
  } else {
    const cats = topLabels(windowItems, (it) => it.category, 3).map((c) => c.toLowerCase());
    const provs = topLabels(
      windowItems.filter((it) => it.province),
      (it) => it.province as string,
      3,
    );
    const worst = [...windowItems].sort((a, b) => b.severityRank - a.severityRank)[0];
    const catText = cats.length ? joinList(cats) : "security-relevant activity";
    const provText = provs.length ? ` Reporting clustered around ${joinList(provs)}.` : "";
    const sevText =
      worst && worst.severityRank >= 4
        ? ` The most serious entry reached ${worst.severityLabel.toLowerCase()} severity.`
        : "";
    const p1 = `Open-source reporting for Papua New Guinea this period was led by ${catText}.${provText}${sevText}`;
    const p2 = `The picture is operational rather than a single dramatic event: the priority for business users is movement security, premises protection and continuity at exposed sites while this picture holds.`;
    executiveSummary = `${p1}\n\n${p2}`;
  }

  // --- Business impact (de-duplicated impact lines for the categories present)-
  const seenImpacts = new Set<string>();
  const businessImpact: string[] = [];
  for (const it of [...windowItems].sort(sortBySeverityThenRecency)) {
    if (seenImpacts.has(it.businessImpact)) continue;
    seenImpacts.add(it.businessImpact);
    businessImpact.push(it.businessImpact);
    if (businessImpact.length >= 6) break;
  }

  // --- Outlook (forward-looking, anchored to recurring provinces/categories) -
  let outlook: string;
  if (windowItems.length === 0) {
    outlook = `With no fresh reporting this period, expect the standing risk pattern to persist: opportunistic crime in urban centres, periodic tribal and communal flare-ups in the Highlands, and intermittent road, power and connectivity disruption. Maintain current movement and continuity precautions and re-test them as fresh reporting comes through.`;
  } else {
    const recurringProv = topLabels(
      windowItems.filter((it) => it.province),
      (it) => it.province as string,
      2,
    );
    const recurringCat = topLabels(windowItems, (it) => it.category, 2).map((c) => c.toLowerCase());
    const provClause = recurringProv.length
      ? `${joinList(recurringProv)} remain the locations to watch`
      : "the main urban centres remain the locations to watch";
    const catClause = recurringCat.length
      ? `, with ${joinList(recurringCat)} the most likely repeat pattern`
      : "";
    const watchClause = baselineWatchlist.length
      ? ` Keep the curated location watchlist (${joinList(baselineWatchlist.slice(0, 4))}) under active review.`
      : "";
    outlook = `Looking to the week ahead, ${provClause}${catClause}. Conditions can shift quickly around paydays, court rulings, election cycles and tribal-payback events, so treat any single quiet week as provisional.${watchClause}`;
  }

  // --- Diagnostics (Source confidence & reporting gaps) ----------------------
  const bySourceMap = new Map<string, number>();
  for (const it of windowItems) {
    const s = it.source || "Unattributed";
    bySourceMap.set(s, (bySourceMap.get(s) ?? 0) + 1);
  }
  const bySource = Array.from(bySourceMap.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  const byConfMap = new Map<string, number>();
  for (const it of windowItems) {
    byConfMap.set(it.confidence, (byConfMap.get(it.confidence) ?? 0) + 1);
  }
  const byConfidence = Array.from(byConfMap.entries())
    .map(([confidence, count]) => ({ confidence, count }))
    .sort((a, b) => b.count - a.count);

  const coveredProvinces = new Set(windowItems.map((it) => it.province).filter(Boolean) as string[]);
  const watchlistGaps = baselineWatchlist.filter((loc) => {
    const prov = derivePngProvince(loc, loc);
    if (prov) return !coveredProvinces.has(prov);
    return ![...coveredProvinces].some((p) => hasWord(loc, p.toLowerCase()));
  });

  const diagnostics: PngDiagnostics = {
    totalInWindow: windowItems.length,
    bySource,
    byConfidence,
    occurredEarlierCount: windowItems.filter((it) => it.occurredEarlier).length,
    watchlistGaps,
    thirtyDayCount: thirtyDay.length,
    ninetyDayCount: ninetyDay.length,
  };

  return {
    periodLabel,
    executiveSummary,
    topThree,
    ncd,
    morobe,
    westernHighlands,
    otherNational,
    businessImpact,
    outlook,
    diagnostics,
    windowItems,
  };
}
