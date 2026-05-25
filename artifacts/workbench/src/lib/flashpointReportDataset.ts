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
const KINETIC_ONLY_RE = /\b(drone[- ]?strike|missile[- ]?strike|air[- ]?strike|airstrike|airborne attack|artillery (strike|shelling|fire)|\bshelling\b|\bambush\b|\bied\b|bomb (attack|blast|kills|detonat)|suicide bomb|car bomb|gunmen (kill|attack)|gun battle|gunbattle|militants? (kill|attack|target|ambush|fire|raid|strike)|insurgents? (kill|attack|target|ambush)|jihadist|terror(ist)? attack|armed group (attack|kill|raid))\b/i;

// Tight protest / public-order cue list. Deliberately excludes ambiguous
// tokens like "strike", "walkout", "stoppage" and bare "clash" because
// they collide with kinetic vocabulary ("drone strike", "militants clash
// with troops"). Only explicit protest, public-order or named-movement
// markers can override the kinetic exclusion.
const PROTEST_HOOK_RE = /\b(protest|demonstration|rally|march|sit[- ]?in|riot|public disorder|looting|roadblock|crackdown|curfew|state of emergency|martial law|lockdown imposed|tear[- ]?gas|water cannon|rubber bullet|baton charge|student union|activist|opposition (call|rally|march)|union (call|rally|strike)|\bpti\b|imran khan|tehreek[- ]?e[- ]?insaf|section\s*144|assembly ban|detention of (protesters|activists|students)|chemists? (strike|walkout|shutdown)|pharmacists? (strike|walkout|shutdown)|lawyers? (strike|walkout|boycott)|traders? (strike|shutdown)|transporters? (strike|stoppage)|sectoral (strike|shutdown|walkout)|shutter[- ]down)\b/i;

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
    return `No qualifying flashpoint records were tied to a country in the briefing window, so the geographic picture is empty this cycle. Across the covered geographies a blank cycle is unusual rather than reassuring: opposition political calendars, sectoral chambers and student bodies typically repopulate the file inside a single news cycle once a policy trigger or anniversary lands.\n\nFor business users the practical read is that standing readiness on the historically affected city-centre commercial districts, transport hubs and government precincts should not be drawn down on the strength of one thin reporting cycle.`;
  }
  if (countryRows.length === 0) {
    return `Country-level attribution is incomplete this cycle; identified incident countries are sparse in the file even where the operational signal is present. That usually reflects upstream source coverage rather than a real absence of street-level activity.\n\nBusiness users with footprint in the historically affected geographies should keep crisis-comms cascade lists and staff-movement plans on a live footing until the next cycle either confirms or reverses the apparent quiet.`;
  }
  const lead = countryRows[0];
  const second = countryRows[1];
  const third = countryRows[2];
  const headline = second
    ? `Across the briefing window the file leans on ${lead.label} with ${lead.value} record${lead.value === 1 ? "" : "s"} against ${second.value} for ${second.label}${third ? ` and ${third.value} for ${third.label}` : ""}.`
    : `Across the briefing window the file is concentrated on ${lead.label} with ${lead.value} record${lead.value === 1 ? "" : "s"}.`;
  // Per-country operational breakdown using the dataset's own bucket
  // tags. This gives the reader a genuine country-level read on what
  // is driving mobilisation, what form activity is likely to take and
  // where the disruption will land — not just count narration.
  const byCountry = new Map<string, EnrichedIncident[]>();
  for (const r of enriched) {
    const c = (r.country ?? "").trim();
    if (!c) continue;
    const arr = byCountry.get(c) ?? [];
    arr.push(r);
    byCountry.set(c, arr);
  }
  const driverFor = (rows: EnrichedIncident[]): string => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.issue, (counts.get(r.issue) ?? 0) + 1);
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return "mixed activism and civil-unrest signal";
    if (ranked.length === 1) return ranked[0][0].toLowerCase();
    return `${ranked[0][0].toLowerCase()} alongside ${ranked[1][0].toLowerCase()}`;
  };
  const formFor = (rows: EnrichedIncident[]): string => {
    const a = rows.filter((r) => r.bucket === "activism").length;
    const u = rows.filter((r) => r.bucket === "unrest").length;
    if (a > 0 && u > 0) return "announced rallies and sectoral walkouts that routinely draw a visible enforcement response";
    if (a >= u) return "announced rallies, sectoral walkouts and student-body actions converting into rolling road closures";
    return "visible state enforcement — curfew orders, mass arrests and security-force operations around named flashpoints";
  };
  const lociFor = (rows: EnrichedIncident[]): string => {
    const issues = new Set(rows.map((r) => r.issue));
    if (issues.has("Crackdown") || issues.has("Curfew / emergency order")) return "city-centre commercial districts, government precincts and university campuses";
    if (issues.has("Strike / labour action")) return "wholesale markets, transport corridors and sectoral premises (pharmacies, courts, hauliers)";
    if (issues.has("Student activism")) return "university campuses, adjoining road networks and exam-board administrative offices";
    if (issues.has("Roadblock / access disruption")) return "named intercity highways, ring-roads and last-mile delivery corridors";
    return "city-centre commercial districts, transport hubs and government precincts";
  };
  const topThree = countryRows.slice(0, 3);
  const countryParas: string[] = [];
  for (const cr of topThree) {
    const rows = byCountry.get(cr.label) ?? [];
    if (rows.length === 0) continue;
    countryParas.push(
      `${cr.label} — ${cr.value} record${cr.value === 1 ? "" : "s"} this cycle, driven by ${driverFor(rows)}. The likely form of mobilisation is ${formFor(rows)}; the principal disruption loci are ${lociFor(rows)}. Business users with on-the-ground exposure should keep staff-movement and venue-access plans on a live footing and treat any opposition political-calendar event in the next 7-14 days as a potential accelerant.`,
    );
  }
  const reach = countryRows.length > 3
    ? `A further ${countryRows.length - 3} countr${countryRows.length - 3 === 1 ? "y" : "ies"} carry single-figure or low-volume entries this cycle; treat them as background signal that can firm up quickly if a regional trigger crosses borders. The full distribution is in the chart below.`
    : `The chart below shows the full distribution.`;
  const watch = `Watch for opposition political-calendar moves, sectoral chamber notifications (chemists, transporters, lawyers, traders), student-body statements, and district-administration orders under Section 144 or equivalent public-order legislation — those move ahead of street-level disruption and provide the cleanest leading signal that the country-level picture is firming.`;
  return [headline, ...countryParas, reach, watch].join("\n\n");
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
  const where = lead ? lead.label : "the affected geographies";
  const parts: string[] = [];
  parts.push(
    `For operators with on-the-ground exposure in ${where}, the practical first-order implications sit with staff movement, journey management and site access. Daily commuting plans into central business districts and ministry quarters should be reviewed against the live protest calendar, not the previous quarter's pattern. Drivers and staff travelling on routes that cross courts, parliament approaches, university precincts or party headquarters should have alternative routings briefed in advance and clear criteria for turning back. Visitor travel — inbound principals, auditors, customers — needs the same screening: arrival windows, hotel zoning away from likely rally corridors, and a named local escort with delegated authority to abort a movement.`,
  );
  parts.push(
    `Site-level posture should reflect the same risk picture. Public-facing facilities (branches, showrooms, clinics, dealerships, customer-service counters) carry the highest exposure to opportunistic crowd action and should have published early-close protocols, shutter procedures and a single decision-maker for same-day closures. Plants, warehouses and corporate offices need a documented work-from-home / delayed-start trigger keyed to specific civil-unrest indicators rather than headline severity, and a security-posture step-up — perimeter checks, access-control hardening, visitor restrictions and standby for guard reinforcement — that can be activated inside an hour of a named flashpoint. Delivery disruption should be treated as a baseline planning assumption on protest days: last-mile reroutes, customer-comms templates for delayed orders and a freight contingency for blocked arterial routes.`,
  );
  parts.push(
    `Crisis-communications triggers and escalation thresholds need to be explicit and pre-agreed, not improvised under pressure. Define in advance the events that move the response from monitoring to action: a Section 144 / curfew order in the city of operation, a confirmed protest call on a route the business uses, a strike notice from a sector the business depends on, an injury or arrest involving staff, or any internet-shutdown notice. Each threshold should pair with a named owner, a defined audience (staff, customers, regulators, board) and a pre-cleared first message so the response is measured in minutes rather than hours.`,
  );
  if (ctx.activismRows.length >= 3) {
    parts.push(
      `Sectoral walkouts (chemists, pharmacists, transporters, traders, lawyers) and student-body mobilisation are not background noise — they routinely lead street-level escalation by 24-72 hours. Procurement, distribution and customer-service teams should be wired into the same early-warning feed as security, so a chamber announcement or a campus call converts into preventive stock build, customer expectation-setting and rota adjustments before the disruption lands.`,
    );
  }
  return parts.join("\n\n");
}

function buildWatchNext(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  const where = lead ? lead.label : "the affected geographies";
  const intro = `The following indicators sit ahead of street-level escalation in ${where} and should be tracked daily through the next reporting window. Each carries a specific operational meaning rather than a generic risk flag.`;
  const items: string[] = [
    `Protest calls and mobilisation dates from opposition parties, named movements and civil-society coalitions. A dated, location-specific call is the single best lead indicator for road closures, transport disruption and crowd action around the targeted venue.`,
    `Union strike notices — federation-level call-outs, sectoral chamber announcements (chemists, transporters, traders, lawyers) and confirmed walkout dates. Treat these as 24-72 hour warnings of supply-chain disruption, branch closures and customer-service degradation before any street activity is visible.`,
    `Court hearings and detention triggers — bail rulings, indictments, contempt findings and high-profile transfers involving political figures, activists or movement leaders. Adverse rulings convert into same-day rallies and route closures around court complexes.`,
    `Police permit refusals or assembly bans for announced rallies. A refusal rarely cancels the protest — it converts an organised event into a dispersed, harder-to-police one and raises the probability of clashes, baton charges and tear-gas dispersal at the venue.`,
    `Section 144 / curfew orders or their geographical expansion. A fresh imposition in a city of operation is the trigger for immediate work-from-home declaration, suspension of non-essential staff movement and customer-facing site closure.`,
    `Arrests, injuries and any confirmed fatalities in a protest or unrest context. These are the single clearest signal that the cycle will firm up rather than ease — expect retaliatory mobilisation, sympathy strikes in adjacent sectors and a hardened state response inside 48 hours.`,
    `Roadblocks and transport disruption — confirmed motorway closures, rail stoppages, port-access blockades and airport-route disruption. Validate these against named routes the business uses and convert into live driver advisories rather than passive monitoring.`,
    `Campus mobilisation — student-union calls, occupations, walkouts and university-administration closure notices. Campus action routinely seeds wider city-centre protest within a week and is a leading indicator of a sustained rather than one-off cycle.`,
    `Online calls moving to street action — verified hashtags, telegram channels or WhatsApp mobilisation that name a date and location. The transition from digital organising to a confirmed venue is where social-media noise becomes operationally relevant.`,
  ];
  if (ctx.unrestRows.length > 0) {
    items.push(
      `Visible enforcement steps already in play on the current file — internet-shutdown notices, mass-arrest reporting and military-aid-to-civil-power references. These indicate the state response has crossed the threshold of measured policing and the next cycle is likely to be harder, not softer.`,
    );
  } else {
    items.push(
      `Triggering events that historically flip a quiet civil-unrest cycle into a sharp one — fuel-price decisions, currency moves, election-calendar shifts, security-force fatalities or a major court ruling. Treat any of these as accelerants and step up monitoring cadence immediately.`,
    );
  }
  return `${intro}\n\n${items.map((l) => `\u2022 ${l}`).join("\n\n")}`;
}

function buildPolestarView(ctx: AutoCtx): string {
  const lead = ctx.countryRows[0];
  const second = ctx.countryRows[1];
  const where = lead ? lead.label : "the covered geographies";
  const parts: string[] = [];

  // 1. Mobilisation capacity judgement.
  const sectoral = ctx.activismRows.filter((r) => /\b(chemist|pharmacist|trader|transporter|lawyer|union|chamber|federation|sectoral)\b/i.test(`${r.title} ${r.summary ?? ""}`)).length;
  const student = ctx.activismRows.filter((r) => /\b(student|university|campus|college)\b/i.test(`${r.title} ${r.summary ?? ""}`)).length;
  const named = ctx.activismRows.filter((r) => /\b(pti|imran khan|tehreek|opposition|movement)\b/i.test(`${r.title} ${r.summary ?? ""}`)).length;
  const mobBuckets: string[] = [];
  if (named > 0) mobBuckets.push(`named-movement organising (${named})`);
  if (sectoral > 0) mobBuckets.push(`sectoral chamber and union action (${sectoral})`);
  if (student > 0) mobBuckets.push(`student and campus mobilisation (${student})`);
  const mobLine = mobBuckets.length > 0
    ? `Mobilisation capacity across ${where} is non-trivial this cycle, drawing on ${joinList(mobBuckets)}. That mix gives the political opposition multiple independent vectors for street action and is harder to contain than a single-issue protest wave.`
    : `Mobilisation capacity across ${where} sits below its structural ceiling this cycle. That is a function of timing rather than capacity — the organising infrastructure (parties, unions, student bodies, sectoral chambers) remains intact and can be reactivated by a single political trigger inside a week.`;
  parts.push(mobLine);

  // 2. Speed of escalation judgement.
  const hasEnforcement = ctx.unrestRows.some((r) => /\b(curfew|tear[- ]?gas|baton|water cannon|arrest|detention|section\s*144|crackdown|lockdown)\b/i.test(`${r.title} ${r.summary ?? ""}`));
  const escLine = hasEnforcement
    ? `Speed of escalation should be assumed to be fast. Visible enforcement (Section 144 orders, tear-gas dispersal, mass detentions, curfew impositions) is already on the file, which historically compresses the runway from a peaceful announced rally to a kinetic street incident from days to hours. Operators should not assume a graduated build-up.`
    : `Speed of escalation looks measured for now, but the structural runway is short. In the covered geographies, the gap between a peaceful announced rally and a kinetic street incident has historically been 24-72 hours once a political trigger lands. Plan against that compressed window rather than the current calm.`;
  parts.push(escLine);

  // 3. Likely protest geography.
  const geoBits: string[] = [];
  if (lead) geoBits.push(`${lead.label} (${lead.value} record${lead.value === 1 ? "" : "s"}) sets the tempo`);
  if (second) geoBits.push(`${second.label} (${second.value}) is the most likely secondary flashpoint`);
  const geoLine = geoBits.length > 0
    ? `Likely protest geography over the next 7-14 days concentrates where the current file is heaviest: ${joinList(geoBits)}. Within those countries, expect activity to cluster around the standard friction points — court complexes, party headquarters, ministry quarters, university precincts and main commercial arteries — rather than residential or suburban locations.`
    : `Likely protest geography is broadly distributed this cycle with no single country dominating, which historically signals a diffuse political mood. That can reconcentrate quickly: a named opposition call or a single policy trigger tends to pull activity back to one or two capitals within days.`;
  parts.push(geoLine);

  // 4. Business disruption risk judgement.
  parts.push(
    `Business disruption risk through the next window is judged moderate-to-elevated. Most exposure sits in three forms: short-notice transport and last-mile disruption on protest days, branch and public-facing site closures driven by Section 144 / curfew orders rather than direct targeting, and supply-chain friction from sectoral walkouts running ahead of street action. The single largest residual risk is a triggering event — adverse court ruling, fuel-price decision, security-force fatality — converting the current cycle from contained protests into sustained unrest. That is a low-probability, high-impact case and is what standing readiness on staff movement, site closure and crisis-comms is sized for.`,
  );

  return parts.join("\n\n");
}

export const FLASHPOINT_SEV_LABEL = SEV_LABEL;
