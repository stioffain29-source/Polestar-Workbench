import { format, parseISO, max as dateMax } from "date-fns";
import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { isTopicRelevant } from "./topicRelevance";
import { classifyIncidentType } from "./incidentClassifier";

// Single source of truth for the Flashpoint report's analysed dataset.
// Mirrors the shippingReportDataset pattern so the exporter and any
// future preview cannot drift. Flashpoint is the Activism, Protests
// and Civil Unrest surface, so the dataset filters out kinetic
// armed-conflict / militant reporting that lacks a public-order hook,
// and the operational read splits the file into Activism (protest,
// strike, student, sit-in) vs Civil Unrest (riot, clash, crackdown,
// curfew, security-force operation).

export interface FlashpointReportIncident {
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
}

export interface EnrichedIncident extends FlashpointReportIncident {
  date: Date;
  issue: string;
  bucket: "activism" | "unrest" | "other";
}

export interface KpiCard {
  label: string;
  value: string;
  note?: string;
  severity?: string;
}

export interface BarRow {
  label: string;
  value: number;
  color?: string;
}

export interface FlashpointReportDataset {
  reportingPeriodShort: string;
  reportingPeriodLong: string;
  enriched: EnrichedIncident[];
  fastFacts: KpiCard[];
  activismRows: EnrichedIncident[];
  unrestRows: EnrichedIncident[];
  countryRows: BarRow[];
  activismRead: string;
  civilUnrestRead: string;
  forecastRead: string;
  regionalCountryRead: string;
  relatedIncidents: EnrichedIncident[];
  autoWhatMatters: string;
  autoImplications: string;
  autoWatchNext: string;
  autoPolestarView: string;
  dataNote: string;
}

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme",
};

function sevKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function highestSeverity(rows: FlashpointReportIncident[]): { key: string; label: string } {
  let key = "", rank = 0;
  for (const r of rows) {
    const k = sevKey(r.severity);
    const v = SEV_RANK[k] ?? 0;
    if (v > rank) { rank = v; key = k; }
  }
  return { key, label: key ? (SEV_LABEL[key] ?? key) : "—" };
}

// --- Scope filter ----------------------------------------------------------
// Flashpoint = activism, public order, civil unrest. Kinetic armed-conflict
// / militant kinetic reporting (drone strikes, missile strikes, ambushes,
// IED, suicide bombings, named militant groups attacking targets) is
// out of scope unless the same headline also carries a protest / strike /
// civil-unrest hook (e.g. crackdown on a march, security forces clash
// with protesters).
const KINETIC_ONLY_RE = /\b(drone strike|missile strike|air strike|airstrike|airborne attack|artillery|shelling|ambush|\bied\b|bomb (attack|blast|kills)|suicide bomb|car bomb|gunmen kill|gun battle|militants? (kill|attack|target|ambush)|insurgents? (kill|attack)|jihadist|terror attack|terrorist attack|armed group (attack|kill))\b/i;

const PROTEST_HOOK_RE = /\b(protest|demonstration|rally|march|sit[- ]?in|strike|walkout|stoppage|riot|public disorder|looting|roadblock|unrest|disorder|crackdown|clash|curfew|state of emergency|martial law|lockdown|tear[- ]?gas|water cannon|rubber bullet|baton|student|activist|union|opposition|pti|imran khan|section\s*144|detention of (protesters|activists|students))\b/i;

function isKineticOnly(r: FlashpointReportIncident): boolean {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  if (!KINETIC_ONLY_RE.test(text)) return false;
  return !PROTEST_HOOK_RE.test(text);
}

// Court-only / legal-process stories with no civil-unrest hook are pure
// case-law reporting and don't belong in a flashpoint operational read.
const COURT_ONLY_RE = /\b(verdict|sentenced|acquit|ruling|hearing|bail (granted|denied|hearing|plea)|indict(ed|ment)|plea (deal|bargain)|appeal (filed|dismissed)|petition (filed|dismissed)|court (orders|rules|reserves))\b/i;
function isCourtOnly(r: FlashpointReportIncident): boolean {
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  if (!COURT_ONLY_RE.test(text)) return false;
  return !PROTEST_HOOK_RE.test(text);
}

// Low-credibility source / human-interest filter — same shape as the
// shipping dataset uses, kept self-contained so the two surfaces evolve
// independently.
const SOCIAL_SOURCE_RE = /\b(twitter|x\.com|t\.co|instagram|tiktok|facebook|threads|youtube|reddit|telegram|t\.me|mastodon|truth\s*social|weibo|social\s*media)\b/i;
const HANDLE_TITLE_RE = /^\s*[@#]/;
const HUMAN_INTEREST_RE = /(\bobituary|\bfuneral|\bmemorial|\btribute to\b|\binterview with\b|\bopinion piece\b|\bop[- ]ed\b|\bpodcast\b|\blistsicle\b|\bexplainer\b)/i;
const SPECULATIVE_CLAIM_RE = /(\bunconfirmed|\bunverified|\balleged|\ballegedly|\breportedly|\brumou?red|\bpurportedly)\b/i;

function isLowCredibility(r: FlashpointReportIncident): boolean {
  if (HANDLE_TITLE_RE.test(r.title ?? "")) return true;
  const src = `${r.source ?? ""} ${r.sourceUrl ?? ""}`;
  if (SOCIAL_SOURCE_RE.test(src)) return true;
  const text = `${r.title ?? ""} ${r.summary ?? ""}`;
  if (HUMAN_INTEREST_RE.test(text)) return true;
  if (SPECULATIVE_CLAIM_RE.test(text)) return true;
  return false;
}

// --- Dedupe helpers --------------------------------------------------------
function normaliseTitle(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D"'`]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TITLE_STOP = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "as", "by",
  "off", "near", "after", "amid", "with", "from", "into", "over", "under",
  "says", "say", "said", "reports", "report", "warning", "warns",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
  "its", "it", "this", "that", "these", "those", "new",
]);

function titleKey(s: string): string {
  return normaliseTitle(s)
    .split(" ")
    .filter((w) => w && !TITLE_STOP.has(w))
    .slice(0, 6)
    .join(" ");
}

function topicSignature(title: string, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  const yyyy = day.slice(0, 4);
  const mm = day.slice(5, 7);
  const dd = Number(day.slice(8, 10));
  const bucket = `${yyyy}-${mm}-p${Math.floor((dd - 1) / 2)}`;
  const words = normaliseTitle(title)
    .split(" ")
    .filter((w) => w && !TITLE_STOP.has(w) && w.length >= 4);
  const top = [...new Set(words)]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 5)
    .sort();
  return `${bucket}|${top.join(" ")}`;
}

function dedupeByTitle<T extends { title: string; date: Date; severity: string }>(rows: T[]): T[] {
  const better = (a: T, b: T) => {
    const sa = SEV_RANK[sevKey(a.severity)] ?? 0;
    const sb = SEV_RANK[sevKey(b.severity)] ?? 0;
    if (sa !== sb) return sa > sb;
    return a.date.getTime() >= b.date.getTime();
  };
  const byTitle = new Map<string, T>();
  for (const r of rows) {
    const k = titleKey(r.title);
    if (!k) { byTitle.set(`__${Math.random()}`, r); continue; }
    const prev = byTitle.get(k);
    if (!prev || better(r, prev)) byTitle.set(k, r);
  }
  const bySig = new Map<string, T>();
  for (const r of byTitle.values()) {
    const k = topicSignature(r.title, r.date);
    const prev = bySig.get(k);
    if (!prev || better(r, prev)) bySig.set(k, r);
  }
  return Array.from(bySig.values());
}

// --- Bucketing -------------------------------------------------------------
const ACTIVISM_ISSUES = new Set([
  "Protest",
  "Strike / labour action",
  "Student activism",
  "Sit-in",
]);
const UNREST_ISSUES = new Set([
  "Riot / public disorder",
  "Crackdown",
  "Clash",
  "Curfew / emergency order",
  "Security force operation",
  "Political unrest",
  "Tribal violence",
  "Roadblock / access disruption",
]);

function bucketFor(issue: string): "activism" | "unrest" | "other" {
  if (ACTIVISM_ISSUES.has(issue)) return "activism";
  if (UNREST_ISSUES.has(issue)) return "unrest";
  return "other";
}

function enrich(rows: FlashpointReportIncident[]): EnrichedIncident[] {
  return rows
    .map((r) => {
      let date: Date;
      try { date = parseISO(r.occurredAt); } catch { date = new Date(NaN); }
      const issue = classifyIncidentType({
        topic: r.topic,
        title: r.title,
        summary: r.summary ?? null,
        source: r.source ?? null,
        sourceUrl: r.sourceUrl ?? null,
        location: r.location ?? null,
      });
      return { ...r, date, issue, bucket: bucketFor(issue) };
    })
    .filter((r) => !isNaN(r.date.getTime()));
}

function sortByDateDesc<T extends { date: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
}

function countriesOf(rows: EnrichedIncident[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const c = (r.country ?? "").trim();
    if (!c) continue;
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// --- Dataset builder -------------------------------------------------------
export function buildFlashpointReportDataset(
  incidents: FlashpointReportIncident[],
  topic: string,
  issueDate: string,
): FlashpointReportDataset {
  const win = resolveReportWindow(topic, issueDate);

  const rawWindow = filterIncidentsToWindow(incidents, topic, issueDate, { byTopic: true });
  const passesRelevance = (i: FlashpointReportIncident) =>
    isTopicRelevant(topic, {
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    });
  const onTopic = rawWindow.filter(passesRelevance);
  const kineticDropped = onTopic.filter((r) => isKineticOnly(r)).length;
  const courtDropped = onTopic.filter((r) => isCourtOnly(r)).length;
  const scoped = onTopic.filter((r) => !isKineticOnly(r) && !isCourtOnly(r));

  const enrichedAll = sortByDateDesc(enrich(scoped));
  // Two-pass dedupe so syndicated rewrites of the same protest don't
  // dominate the operational read.
  const enriched = dedupeByTitle(enrichedAll);

  const activismRows = enriched.filter((r) => r.bucket === "activism");
  const unrestRows = enriched.filter((r) => r.bucket === "unrest");

  // Fast Facts
  const hs = highestSeverity(enriched);
  const countryCount = countriesOf(enriched);
  let topCountry = "—", topCountryN = 0;
  for (const [c, n] of countryCount) if (n > topCountryN) { topCountryN = n; topCountry = c; }
  const issueCount = new Map<string, number>();
  for (const r of enriched) issueCount.set(r.issue, (issueCount.get(r.issue) ?? 0) + 1);
  let topIssue = "—", topIssueN = 0;
  for (const [k, v] of issueCount) if (v > topIssueN) { topIssueN = v; topIssue = k; }
  const latest = enriched.length > 0
    ? format(dateMax(enriched.map((r) => r.date)), "dd MMM yyyy")
    : "—";

  const fastFacts: KpiCard[] = [
    { label: "Reporting Period", value: win.shortLabel },
    {
      label: "Records In Window",
      value: String(enriched.length),
      note: `${activismRows.length} activism, ${unrestRows.length} civil unrest`,
    },
    {
      label: "Highest Severity",
      value: hs.label,
      severity: hs.key || undefined,
      note: hs.key ? "Worst rating in window" : undefined,
    },
    {
      label: "Top Issue Type",
      value: topIssue,
      note: topIssueN > 0 ? `${topIssueN} record${topIssueN === 1 ? "" : "s"}` : undefined,
    },
    {
      label: "Most Affected Country",
      value: topCountry,
      note: topCountryN > 0 ? `${topCountryN} record${topCountryN === 1 ? "" : "s"}` : undefined,
    },
    { label: "Latest Incident", value: latest },
  ];

  // Country bar rows (top 12 only, identified countries)
  const countryRows: BarRow[] = Array.from(countryCount.entries())
    .map(([label, value]) => ({ label, value, color: "#465bff" }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  // --- Reads ---------------------------------------------------------------
  const activismRead = buildActivismRead(activismRows, win.shortLabel);
  const civilUnrestRead = buildCivilUnrestRead(unrestRows, win.shortLabel);
  const forecastRead = buildForecastRead({ activismRows, unrestRows, countryRows });
  const regionalCountryRead = buildRegionalCountryRead({
    enriched,
    countryRows,
  });

  // Related Incidents — prioritise activism + unrest, drop "Other" / weak buckets.
  const relatedIncidents = prioritiseRelated(enriched);

  // Auto-prose for the closing analyst sections.
  const autoCtx = { activismRows, unrestRows, countryRows, enriched };
  const autoWhatMatters = buildWhatMatters(autoCtx);
  const autoImplications = buildImplications(autoCtx);
  const autoWatchNext = buildWatchNext(autoCtx);
  const autoPolestarView = buildPolestarView(autoCtx);

  // Data note. Mirrors shipping's compact note: surface filter counts so
  // the reader understands what scope was applied, without leaking
  // internal classifier vocabulary.
  const noteParts: string[] = [];
  if (kineticDropped > 0) {
    noteParts.push(`${kineticDropped} kinetic armed-conflict record${kineticDropped === 1 ? "" : "s"} without a public-order hook were excluded so the read stays focused on activism, protests and civil unrest.`);
  }
  if (courtDropped > 0) {
    noteParts.push(`${courtDropped} court-only legal-process record${courtDropped === 1 ? "" : "s"} without a civil-unrest hook were excluded.`);
  }
  const dedupedDropped = enrichedAll.length - enriched.length;
  if (dedupedDropped > 0) {
    noteParts.push(`${dedupedDropped} syndicated duplicate${dedupedDropped === 1 ? " was" : "s were"} collapsed via two-pass title and topic-signature dedupe.`);
  }
  const dataNote = noteParts.length > 0
    ? noteParts.join(" ")
    : "Scope: activism, protests and civil unrest only. Kinetic armed-conflict reporting without a public-order hook is excluded by design.";

  return {
    reportingPeriodShort: win.shortLabel,
    reportingPeriodLong: `Reporting period: ${win.label}`,
    enriched,
    fastFacts,
    activismRows,
    unrestRows,
    countryRows,
    activismRead,
    civilUnrestRead,
    forecastRead,
    regionalCountryRead,
    relatedIncidents,
    autoWhatMatters,
    autoImplications,
    autoWatchNext,
    autoPolestarView,
    dataNote,
  };
}

// --- Prose builders --------------------------------------------------------
// Analyst-style prose, never count-led. Forbidden idioms include
// "X records sit in window", "Activity concentrates", "Most recent",
// "The leading patterns are", "The usable signal is", "Detail sits",
// "The reporting window is noisy". Forecast uses cautious vocabulary
// ("likely", "possible", "watch for", "risk increases if",
// "risk eases if").

function pickLead(rows: EnrichedIncident[]): EnrichedIncident | null {
  const credible = rows.find((r) => !isLowCredibility(r));
  return credible ?? rows[0] ?? null;
}

function buildActivismRead(rows: EnrichedIncident[], windowLabel: string): string {
  if (rows.length === 0) {
    return `No qualifying protest, strike, student-activism or sit-in records reached the file across the briefing window (${windowLabel}). Treat the quiet cycle as a reporting gap rather than a sustained easing: activism cadence in the covered geographies tends to be lumpy, with thin weeks routinely followed by a sharp escalation around a policy trigger or anniversary.\n\nKeep tracking opposition political calendars, union notifications, student-body statements and sectoral chambers (chemists, transporters, lawyers, traders) — those are the leading indicators that the next cycle will firm up rather than stay quiet.`;
  }
  const byType = new Map<string, EnrichedIncident[]>();
  for (const r of rows) {
    const arr = byType.get(r.issue) ?? [];
    arr.push(r);
    byType.set(r.issue, arr);
  }
  const ranked = Array.from(byType.entries()).sort((a, b) => b[1].length - a[1].length);
  const lead = pickLead(rows);
  const headline = lead
    ? `The activism picture across the briefing window (${windowLabel}) is anchored on ${ranked[0][0].toLowerCase()} reporting, with "${lead.title}" as the lead entry.`
    : `The activism picture across the briefing window (${windowLabel}) is anchored on ${ranked[0][0].toLowerCase()} reporting, though no credible single lead entry is available to quote here.`;
  const mix = ranked.slice(0, 3).map(([type, arr]) => `${type.toLowerCase()} (${arr.length})`);
  const mixLine = `The mix breaks down as ${joinList(mix)}${ranked.length > 3 ? `, with ${ranked.length - 3} further bucket${ranked.length - 3 === 1 ? "" : "s"} carrying single-figure entries` : ""}.`;
  const operational = `For operators, the practical read is that named opposition movements, sectoral unions and student bodies remain the primary drivers of street-level disruption. Roads, transport hubs and city-centre commercial districts are the typical pressure points; staff movement, last-mile logistics and customer-facing footfall are the first surfaces to feel the effect.`;
  return `${headline}\n\n${mixLine}\n\n${operational}`;
}

function buildCivilUnrestRead(rows: EnrichedIncident[], windowLabel: string): string {
  if (rows.length === 0) {
    return `No qualifying riot, clash, crackdown, curfew or security-force operation records reached the file across the briefing window (${windowLabel}). A blank civil-unrest cycle alongside activism reporting usually means the state response has stayed below the threshold of mass arrests or curfew orders — useful, but reversible inside a single news cycle if a protest crosses a policy line.\n\nKeep tracking police statements, district-administration orders, internet-shutdown notices and any military-aid-to-civil-power references. Those move ahead of curfew impositions and visible street-level enforcement.`;
  }
  const lead = pickLead(rows);
  const sev = highestSeverity(rows);
  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.issue, (byType.get(r.issue) ?? 0) + 1);
  const ranked = Array.from(byType.entries()).sort((a, b) => b[1] - a[1]);
  const headline = lead
    ? `Civil unrest in the briefing window (${windowLabel}) carries a highest severity of ${sev.label.toLowerCase()}, led by "${lead.title}".`
    : `Civil unrest in the briefing window (${windowLabel}) carries a highest severity of ${sev.label.toLowerCase()}.`;
  const composition = `The composition is dominated by ${ranked.slice(0, 2).map(([t, n]) => `${t.toLowerCase()} (${n})`).join(" and ")}${ranked.length > 2 ? `, with ${ranked.slice(2).map(([t, n]) => `${t.toLowerCase()} (${n})`).join(", ")} also on file` : ""}.`;
  const operational = `Operationally, crackdowns and curfew orders matter more than the headline protest count: they signal where the state is prepared to escalate enforcement and where staff movement, commercial operations and venue access can be disrupted at short notice. Where security-force operations cluster around a single city or district, expect rolling road closures and intermittent connectivity.`;
  return `${headline}\n\n${composition}\n\n${operational}`;
}

function buildForecastRead(opts: {
  activismRows: EnrichedIncident[];
  unrestRows: EnrichedIncident[];
  countryRows: BarRow[];
}): string {
  const { activismRows, unrestRows, countryRows } = opts;
  const lead = countryRows[0];
  const total = activismRows.length + unrestRows.length;
  const activismShare = total > 0 ? activismRows.length / total : 0;
  const unrestShare = total > 0 ? unrestRows.length / total : 0;
  const lines: string[] = [];
  if (total === 0) {
    return `Forecast for the next 7-14 days is for a continued thin reporting cycle, with limited fresh activism or civil-unrest reporting expected on current signals. The risk increases if a policy trigger lands (court ruling, fuel-price decision, election-calendar event) or a named opposition movement publishes a fresh protest schedule. The risk eases if political calendars stay quiet and sectoral chambers remain unmobilised.`;
  }
  if (lead) {
    lines.push(
      `Across the next 7-14 days, ${lead.label} is likely to remain the leading source of activism and civil-unrest reporting on current cadence, with ${lead.value} record${lead.value === 1 ? "" : "s"} on file this cycle. Adjacent cities and university campuses are possible secondary flashpoints.`,
    );
  } else {
    lines.push(
      `Across the next 7-14 days, the geographic concentration is likely to stay loose on current cadence, with no single country dominating the file. Watch for a coordinated opposition or sectoral call that could sharpen the picture inside a single news cycle.`,
    );
  }
  if (activismShare >= 0.6) {
    lines.push(
      `Activism reporting dominates the current mix, so the most likely escalation path is from announced rallies and sectoral walkouts into intermittent road closures and city-centre disruption. Risk increases if security forces respond with mass arrests, tear gas or curfew orders; risk eases if organisers stand down voluntarily or political talks open.`,
    );
  } else if (unrestShare >= 0.6) {
    lines.push(
      `Civil-unrest reporting dominates the current mix, which usually signals the state response is already running ahead of fresh organising. The most likely path is for visible enforcement (curfews, mass arrests, security operations) to continue. Risk eases if curfew orders are lifted and protest leaders are released; risk increases if a fatality or a high-profile detention triggers a fresh round of street mobilisation.`,
    );
  } else {
    lines.push(
      `Activism and civil-unrest reporting are roughly balanced, which is the typical pattern when announced rallies are routinely met with police orders and selective detentions. The next 7-14 days are likely to keep that rhythm. Watch for a policy trigger or court decision that tips the balance toward either side.`,
    );
  }
  lines.push(
    `Cautious read: a thin cycle is not a sustained easing in these geographies. A single political event can repopulate the file inside 48 hours, so the forecast should be treated as a baseline rather than a prediction.`,
  );
  return lines.join("\n\n");
}

function buildRegionalCountryRead(opts: {
  enriched: EnrichedIncident[];
  countryRows: BarRow[];
}): string {
  const { enriched, countryRows } = opts;
  if (enriched.length === 0) {
    return `No qualifying flashpoint records were tied to a country in the briefing window, so the geographic picture is empty this cycle. A blank cycle is unusual rather than reassuring across the covered geographies.`;
  }
  if (countryRows.length === 0) {
    return `Country-level attribution is incomplete this cycle; identified incident countries are sparse in the file even where the operational signal is present.`;
  }
  const lead = countryRows[0];
  const second = countryRows[1];
  const third = countryRows[2];
  const headline = second
    ? `Across the briefing window the file leans on ${lead.label} with ${lead.value} record${lead.value === 1 ? "" : "s"} against ${second.value} for ${second.label}${third ? ` and ${third.value} for ${third.label}` : ""}.`
    : `Across the briefing window the file is concentrated on ${lead.label} with ${lead.value} record${lead.value === 1 ? "" : "s"}.`;
  const reach = countryRows.length > 3
    ? `A further ${countryRows.length - 3} countr${countryRows.length - 3 === 1 ? "y" : "ies"} carry single-figure or low-volume entries; the full distribution is in the chart below.`
    : `The chart below shows the full distribution.`;
  return `${headline} ${reach}`;
}

function prioritiseRelated(rows: EnrichedIncident[]): EnrichedIncident[] {
  // Strong: activism + civil unrest buckets. Weak: "Other / Crime / Armed
  // group / Robbery" — kept only if there's headroom after strong rows.
  // Hard-exclude armed-robbery / crime / armed-group activity (drone /
  // militant items already filtered out of the dataset upstream).
  const strong: EnrichedIncident[] = [];
  const rest: EnrichedIncident[] = [];
  for (const r of rows) {
    if (r.issue === "Armed robbery" || r.issue === "Crime / public safety" || r.issue === "Armed group activity") continue;
    if (r.bucket === "activism" || r.bucket === "unrest") strong.push(r);
    else rest.push(r);
  }
  const ordered = dedupeByTitle([...strong, ...rest]);
  return ordered.slice(0, 8);
}

interface AutoCtx {
  activismRows: EnrichedIncident[];
  unrestRows: EnrichedIncident[];
  countryRows: BarRow[];
  enriched: EnrichedIncident[];
}

function buildWhatMatters(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  const lines: string[] = [];
  if (ctx.activismRows.length + ctx.unrestRows.length === 0) {
    return `The operational read this cycle is shaped by an absence of fresh activism and civil-unrest reporting rather than by any single event. That is a reporting gap, not a sustained easing — the covered geographies have not been quiet for long historically, and the next political trigger usually repopulates the file inside a week.\n\nFor businesses on the ground, the practical implication is that standing readiness on city-centre commercial districts, transport hubs and staff movement should not be drawn down on the strength of a thin briefing cycle.`;
  }
  if (lead) {
    lines.push(
      `The cycle's centre of gravity sits with ${lead.label}, which carries ${lead.value} record${lead.value === 1 ? "" : "s"} across the activism and civil-unrest mix. That matters operationally because protest cadence in ${lead.label} routinely converts into rolling road closures, intermittent connectivity disruption and pressure on staff movement at short notice.`,
    );
  } else {
    lines.push(
      `Geographic concentration is loose this cycle, which usually signals a broadly distributed political mood rather than a single flashpoint. That can flip quickly: a named opposition call or a single policy trigger tends to pull activity back to one or two cities.`,
    );
  }
  if (ctx.activismRows.length > 0 && ctx.unrestRows.length > 0) {
    lines.push(
      `Activism reporting (${ctx.activismRows.length}) running alongside civil-unrest reporting (${ctx.unrestRows.length}) is the classic pattern when announced rallies are routinely met with police orders, selective detentions and tear-gas dispersal. The risk profile sits in the second-order response: curfew impositions, internet shutdowns and mass arrests usually follow a single high-visibility incident rather than a slow build.`,
    );
  } else if (ctx.activismRows.length > 0) {
    lines.push(
      `The mix this cycle leans on activism rather than civil unrest, which usually means the state response has stayed below the threshold of visible enforcement. That can change inside a single news cycle if a rally crosses a policy line.`,
    );
  } else {
    lines.push(
      `The mix this cycle leans on civil unrest rather than fresh activism, which usually signals the state response is running ahead of new organising. Expect visible enforcement (curfew orders, mass arrests) to continue until the political trigger eases.`,
    );
  }
  return lines.join("\n\n");
}

function buildImplications(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  const parts: string[] = [];
  parts.push(
    `Operators with city-centre exposure in ${lead ? lead.label : "the affected geographies"} should be running live duty-of-care reviews on staff movement, last-mile logistics and any customer-facing operations on protest routes. Activism cadence in these geographies converts into rolling road closures and intermittent transport disruption faster than headline media coverage suggests.`,
  );
  if (ctx.unrestRows.length > 0) {
    parts.push(
      `Where civil-unrest reporting is on the file, security planning should price in curfew impositions, internet-shutdown orders and short-notice mass arrests around named flashpoints. Crisis-comms cascade lists, alternative-route plans and a clear escalation threshold for closing offices early are the practical first-line mitigations.`,
    );
  }
  if (ctx.activismRows.length >= 3) {
    parts.push(
      `On the commercial side, sectoral walkouts (chemists, transporters, traders, lawyers) and student-body actions can disrupt supply chains and retail footfall ahead of any visible street-level escalation. Procurement, distribution and customer-service teams should treat sectoral calls as early-warning signals rather than background noise.`,
    );
  }
  return parts.join("\n\n");
}

function buildWatchNext(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  const lines: string[] = [];
  lines.push(
    `Track opposition political calendars in ${lead ? lead.label : "the affected geographies"}, named protest schedules from union and student bodies, and sectoral chamber notifications (chemists, transporters, lawyers, traders). Those move ahead of street-level disruption.`,
  );
  lines.push(
    `Watch for district-administration orders under Section 144 or equivalent public-order legislation, fresh police statements on rally permissions, and any military-aid-to-civil-power references. Curfew impositions, internet-shutdown notices and mass-arrest reporting are the leading indicators that the state response has crossed the threshold of visible enforcement.`,
  );
  if (ctx.unrestRows.length > 0) {
    lines.push(
      `On civil unrest specifically, monitor any fatalities, high-profile detentions or footage of security-force violence — these are the single clearest signals that the current cycle will firm up rather than ease through the next reporting window.`,
    );
  } else {
    lines.push(
      `Even on a quiet civil-unrest cycle, monitor for a triggering event (court ruling, fuel-price decision, election-calendar move). Those are the typical accelerants when a thin briefing cycle flips into a sharp escalation.`,
    );
  }
  return lines.join("\n\n");
}

function buildPolestarView(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  const parts: string[] = [];
  parts.push(
    `Our read on the cycle is that the structural picture across the covered geographies remains a "quiet weeks, sharp incidents" cadence rather than a sustained easing of activism or civil-unrest risk. ${lead ? `${lead.label} continues to set the tempo` : `No single country dominated this cycle, but the regional baseline has not reset`}, and operators should plan against that rhythm rather than the headline weekly count.`,
  );
  parts.push(
    `For commercial decisions, the practical implication is that staff movement plans, office-closure thresholds and crisis-comms cascade lists should be treated as live operational documents and reviewed every cycle — not annual exercises. The cost of a stale plan is realised the day a curfew lands or a city-centre rally turns kinetic, not on the day it is written.`,
  );
  if (lead) {
    parts.push(
      `Geographically the pressure this cycle sat with ${lead.label}. We expect the same cities and political triggers to set the tempo through the next reporting window unless a credible easing of the underlying political driver — court decision, opposition standdown, formal talks — disrupts the pattern.`,
    );
  }
  return parts.join("\n\n");
}

export const FLASHPOINT_SEV_LABEL = SEV_LABEL;
