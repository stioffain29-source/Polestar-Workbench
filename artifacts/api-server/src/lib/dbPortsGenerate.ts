import { z } from "zod";
import {
  DB_PORTS_IMPACT_AREAS,
  DB_PORTS_ITEM_MIN_WORDS,
  DB_PORTS_MAX_ITEMS,
  DB_PORTS_MAX_WATCH,
  DB_PORTS_OVERVIEW_MAX_WORDS,
  DB_PORTS_OVERVIEW_MIN_WORDS,
  DB_PORTS_SEVERITIES,
  DB_PORTS_THEMES,
  assessDbPortsItem,
  canonicalDbPortsCountry,
  canonicalSourceUrl,
  dbPortsImpactLabel,
  dbPortsThemeLabel,
  emptyDbPortsItem,
  isCalendarDate,
  isPublicSourceUrl,
  matchesExclusion,
  severityRank,
  sourceHost,
  themeFor,
  wordCount,
  type DbPortsDiscoveryRow,
  type DbPortsEvidence,
  type DbPortsImpactArea,
  type DbPortsItem,
  type DbPortsParameters,
  type DbPortsSeverity,
  type DbPortsTheme,
  type DbPortsWatchTarget,
} from "@workspace/db-ports";
import { dbPortsAiConfigured, dbPortsJson } from "./dbPortsAi";
import { readDbPortsDiscovery } from "./dbPortsDiscovery";

type Window = { startDate: string; endDate: string };

const OPERATIONAL_SIGNAL =
  /\b(?:clos(?:ure|ed|ing)|suspend|halt|strike|walkout|stoppage|blockad|block(?:ed|ing)|attack|theft|stolen|robber|piracy|boarding|smuggl|seiz|detain|fire|explosion|outage|blackout|cyber|ransomware|sanction|embargo|tariff|export\s+control|restrict|evacuat|damag|collision|grounding|capsiz|spill|congest|backlog|delay|divert|diversion|queue|typhoon|cyclone|storm|earthquake|flood|landslide|tsunami|quarantine|curfew|protest|unrest|riot|injur|killed|fatalit|death|shortage|disrupt|suspension|inspection|lockdown|accident|derail)/i;

const LOW_VALUE =
  /\b(?:preview|highlights|opinion|editorial|column|analysis\s+piece|listicle|top\s+\d+|photos?\s+of\s+the\s+day|obituary|horoscope|recipe)\b/i;

function textOf(row: DbPortsDiscoveryRow): string {
  return `${row.title} ${row.summary} ${row.location}`;
}

function tokens(value: string): Set<string> {
  return new Set(
    value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(token => token.length >= 4),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

// Vocabulary every ports headline shares. Two reports that agree only on these
// are not the same event, so they must never fold into one item.
const GENERIC_TOKENS = new Set([
  "port", "ports", "terminal", "terminals", "harbour", "harbor", "jetty", "wharf", "berth",
  "cargo", "freight", "shipping", "vessel", "vessels", "ship", "ships", "container", "containers",
  "customs", "police", "authority", "authorities", "government", "ministry", "workers", "company",
  "operations", "operation", "logistics", "supply", "chain", "trade", "export", "exports", "import",
  "imports", "report", "reports", "reported", "update", "updates", "news", "says", "said", "after",
  "amid", "over", "local", "national", "international", "region", "regional", "week", "month", "year",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  // Event words are what two DIFFERENT incidents of the same kind have in
  // common, so they cannot stand in for a place, operator or vessel either.
  "strike", "strikes", "striking", "walkout", "stoppage", "protest", "protests", "closure", "closed",
  "close", "closes", "closing", "delay", "delays", "delayed", "queue", "queues", "congestion",
  "outage", "blackout", "storm", "typhoon", "cyclone", "flood", "flooding", "earthquake", "fire",
  "blaze", "explosion", "accident", "collision", "theft", "stolen", "seized", "seizure", "attack",
  "disruption", "disrupted", "suspended", "suspension", "backlog", "shortage", "halted", "halt",
  "blocked", "blockade", "damage", "damaged", "injured", "killed", "deaths", "incident", "incidents",
]);

/** Repeat coverage of one event shares a distinctive word — a place, an
 * operator, a vessel. Overlap on shared trade vocabulary alone is not enough. */
function sharesAnchor(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) {
    if (token.length >= 5 && !GENERIC_TOKENS.has(token) && b.has(token)) return true;
  }
  return false;
}

export type DbPortsCluster = {
  country: string;
  rows: DbPortsDiscoveryRow[];
  tokens: Set<string>;
  score: number;
  assets: string[];
};

/** Screens already-collected rows against the configured geography, themes and
 * exclusions, then folds repeat coverage of one event into a single cluster. */
export function clusterDbPortsCandidates(
  rows: DbPortsDiscoveryRow[],
  parameters: DbPortsParameters,
  watchlist: DbPortsWatchTarget[],
): { clusters: DbPortsCluster[]; screened: number; excluded: number } {
  const included = new Set(parameters.includedCountries);
  const themes = new Set<string>(parameters.includedThemes);
  const exclusions = [...parameters.excludedRegions, ...parameters.excludedSubjects];
  const assetTerms = parameters.priorityAssets
    .map(asset => asset.replace(/^port\s+of\s+/i, "").trim())
    .filter(term => term.length >= 4);
  const clusters: DbPortsCluster[] = [];
  const byKey = new Map<string, number>();
  let screened = 0;
  let excluded = 0;

  for (const row of rows) {
    const country = canonicalDbPortsCountry(row.country);
    if (!country || !included.has(country)) { excluded += 1; continue; }
    if (!isPublicSourceUrl(row.sourceUrl)) { excluded += 1; continue; }
    const text = textOf(row);
    if (matchesExclusion(text, exclusions)) { excluded += 1; continue; }
    if (LOW_VALUE.test(row.title)) { excluded += 1; continue; }
    if (!OPERATIONAL_SIGNAL.test(text)) { excluded += 1; continue; }
    if (!themes.has(themeFor(text))) { excluded += 1; continue; }
    screened += 1;

    const urlKey = `${country}|${canonicalSourceUrl(row.sourceUrl)}`;
    const clusterKey = row.clusterKey ? `${country}|cluster:${row.clusterKey}` : null;
    const rowTokens = tokens(`${row.title} ${row.location}`);
    let index = byKey.get(urlKey) ?? (clusterKey ? byKey.get(clusterKey) : undefined);
    if (index === undefined) {
      index = clusters.findIndex(
        cluster => cluster.country === country &&
          overlap(cluster.tokens, rowTokens) >= 0.55 &&
          sharesAnchor(cluster.tokens, rowTokens),
      );
      if (index < 0) index = undefined;
    }
    if (index === undefined) {
      const matchedAssets = parameters.priorityAssets.filter((asset, position) => {
        const term = assetTerms[position];
        return !!term && text.toLowerCase().includes(term.toLowerCase());
      });
      const watchAssets = watchlist
        .filter(target => target.active && target.country === country &&
          [target.name, ...target.aliases].some(alias => alias.length >= 4 && text.toLowerCase().includes(alias.toLowerCase())))
        .map(target => target.name);
      clusters.push({
        country,
        rows: [row],
        tokens: rowTokens,
        score: 0,
        assets: [...new Set([...matchedAssets, ...watchAssets])],
      });
      byKey.set(urlKey, clusters.length - 1);
      if (clusterKey) byKey.set(clusterKey, clusters.length - 1);
      continue;
    }
    const cluster = clusters[index]!;
    cluster.rows.push(row);
    for (const token of rowTokens) cluster.tokens.add(token);
    byKey.set(urlKey, index);
    if (clusterKey) byKey.set(clusterKey, index);
  }

  for (const cluster of clusters) {
    const hosts = new Set(cluster.rows.map(row => sourceHost(row.sourceUrl)).filter(Boolean));
    const persisted = cluster.rows.filter(row => row.id.startsWith("incident:")).length;
    const latest = cluster.rows.reduce<string>((newest, row) => row.sourceDate && row.sourceDate > newest ? row.sourceDate : newest, "");
    const signals = new Set(
      (textOf(cluster.rows[0]!).match(new RegExp(OPERATIONAL_SIGNAL.source, "gi")) ?? []).map(match => match.toLowerCase()),
    );
    cluster.score =
      Math.min(hosts.size, 4) * 1.5 +
      Math.min(signals.size, 3) +
      (cluster.assets.length ? 3 : 0) +
      (persisted ? 1 : 0) +
      (latest ? Number(latest.slice(8, 10)) * 0.01 : 0);
  }
  clusters.sort((a, b) => b.score - a.score);
  return { clusters, screened, excluded };
}

function clusterEvidence(cluster: DbPortsCluster, nowIso: string): DbPortsEvidence[] {
  const seen = new Set<string>();
  const ordered = [...cluster.rows].sort((a, b) =>
    Number(b.id.startsWith("incident:")) - Number(a.id.startsWith("incident:")));
  const evidence: DbPortsEvidence[] = [];
  for (const row of ordered) {
    const key = canonicalSourceUrl(row.sourceUrl);
    if (seen.has(key) || evidence.length >= 12) continue;
    seen.add(key);
    evidence.push({
      id: `evidence-${row.id.replace(/[^a-z0-9_-]/gi, "-")}`,
      sourceName: row.sourceName || "Publisher not identified",
      sourceUrl: row.sourceUrl,
      // A persisted incident row names its publisher; a discovery row does not
      // establish who reported first, so it stays marked as discovery.
      sourceType: row.id.startsWith("incident:") ? "news" : "discovery",
      publishedDate: null,
      sourceDate: row.sourceDate,
      retrievedAt: nowIso,
      excerpt: row.summary.slice(0, 800),
      originalTitle: row.title.slice(0, 1000),
      sourceRecord: row.id,
      verified: false,
    });
  }
  return evidence;
}

function clusterInput(cluster: DbPortsCluster, window: Window, parameters: DbPortsParameters): unknown {
  return {
    reportingPeriod: window,
    country: cluster.country,
    priorityAssetsMatched: cluster.assets,
    maximumItemWords: parameters.itemWordTarget,
    sourceReports: cluster.rows.slice(0, 8).map(row => ({
      title: row.title,
      reportedText: row.summary.slice(0, 1200),
      location: row.location,
      publisher: row.sourceName,
      storedSourceDate: row.sourceDate,
      storedEventDate: row.eventDate,
    })),
  };
}

const severityEnum = z.enum(DB_PORTS_SEVERITIES as [DbPortsSeverity, ...DbPortsSeverity[]]);
const themeEnum = z.enum(DB_PORTS_THEMES as [DbPortsTheme, ...DbPortsTheme[]]);
const impactEnum = z.enum(DB_PORTS_IMPACT_AREAS as [DbPortsImpactArea, ...DbPortsImpactArea[]]);

const DraftedItemSchema = z.object({
  include: z.boolean(),
  excludeReason: z.string(),
  headline: z.string(),
  location: z.string(),
  assets: z.array(z.string()),
  eventDate: z.string(),
  theme: themeEnum,
  severity: severityEnum,
  summary: z.string(),
  operationalImpact: z.string(),
  polestarView: z.string(),
  outlook: z.string(),
  materialityReason: z.string(),
  impactAreas: z.array(impactEnum),
  missingInfo: z.string(),
  confidence: z.enum(["unverified", "single_source", "corroborated", "official"]),
});

const ITEM_INSTRUCTION = [
  "You draft one item for a fortnightly Ports and Logistics Intelligence report covering APAC and Oceania.",
  "Write only from the supplied source reports. Never add a fact, figure, date, company, casualty count or consequence that the supplied text does not state. Where something material is missing, say so in missingInfo and leave the field empty rather than guessing.",
  "Set include to false when the material does not identify an event, an affected port, terminal, corridor, market or operational function, and a credible current or potential operational consequence. Routine commercial announcements, results, ceremonies, general political reporting and hazards with no operational relevance are excluded. Give the reason in excludeReason.",
  "headline: one plain factual line, no more than 14 words, no rhetoric.",
  "location: the city or area; assets: the named port, terminal or corridor only if the sources name it.",
  "eventDate: the date the event occurred in YYYY-MM-DD form, but only if the sources state it. Otherwise return an empty string.",
  "severity describes this event and its confirmed consequences, using exactly one of Insignificant, Low, Moderate, High, Extreme. Never write that anything is the highest severity and never describe the reader's overall organisational risk.",
  "summary (about 70 words): what happened, using confirmed information, attributed in plain English.",
  "operationalImpact (about 55 words): the effect on personnel, port or terminal operations, cargo or assets, landside access, maritime access, supply chain continuity, regulatory compliance or business continuity.",
  "polestarView (about 50 words): proportionate analysis that does not repeat the summary.",
  "outlook (about 40 words): realistic developments and indicators to monitor.",
  "The four fields together must read between 150 and the supplied maximum item words.",
  "confidence: official when an authority or operator statement is quoted, corroborated when independent publishers agree, single_source when one publisher carries it, unverified otherwise.",
  "Plain British English. No bullet points, no headings, no marketing language, no hedging filler.",
].join(" ");

/** The materiality rule decided here rather than left to the model: a report
 * item has to name where it happened and what it did to an operating function.
 * One decision serves the first draft and every later regeneration. */
function isMaterialDraft(
  draft: Pick<z.output<typeof DraftedItemSchema>, "location" | "assets" | "operationalImpact" | "materialityReason">,
  knownAssets: string[],
): boolean {
  const named = !!draft.location.trim() ||
    knownAssets.some(asset => asset.trim()) ||
    draft.assets.some(asset => asset.trim());
  return named && !!draft.operationalImpact.trim() && !!draft.materialityReason.trim();
}

function draftToItem(
  draft: z.output<typeof DraftedItemSchema>,
  cluster: DbPortsCluster,
  window: Window,
  parameters: DbPortsParameters,
  nowIso: string,
): DbPortsItem {
  const storedEventDate = cluster.rows.map(row => row.eventDate).find(date => date && isCalendarDate(date)) ?? null;
  const modelEventDate = isCalendarDate(draft.eventDate) && draft.eventDate <= window.endDate ? draft.eventDate : null;
  const belowFloor = severityRank(draft.severity) < severityRank(parameters.minimumSeverity);
  // A held near-miss still has to be identifiable in the analyst list, so when
  // the drafting pass declines to write a headline the collected source title
  // stands in. An item with no drafted headline is never selected: unreviewed
  // source wording must not reach the customer report as our own.
  const draftedHeadline = draft.headline.trim();
  const sourceTitle = cluster.rows.map(row => row.title.trim()).find(Boolean) ?? "";
  const material = isMaterialDraft(draft, cluster.assets);
  const notes = [
    draft.missingInfo.trim(),
    !draft.include && draft.excludeReason.trim()
      ? `Held during generation: ${draft.excludeReason.trim()}`
      : "",
    belowFloor && draft.include
      ? `Held during generation: severity ${draft.severity} is below the configured minimum of ${parameters.minimumSeverity}.`
      : "",
    draft.include && !draftedHeadline
      ? "Held during generation: the drafting pass returned no headline, so the collected source title is shown instead."
      : "",
    draft.include && !material
      ? "Held during generation: the materiality rule is not met — the reporting does not establish a consequence for a named port, terminal, corridor or operating function."
      : "",
  ].filter(Boolean).join(" ");
  const content = {
    ...emptyDbPortsItem(),
    headline: (draftedHeadline || sourceTitle).slice(0, 500),
    country: cluster.country,
    location: draft.location.slice(0, 200),
    assets: [...new Set([...cluster.assets, ...draft.assets])].slice(0, 10),
    eventDate: storedEventDate ?? modelEventDate,
    theme: draft.theme,
    disposition: draft.include && !belowFloor && !!draftedHeadline && material
      ? ("selected" as const)
      : ("hold" as const),
    severity: draft.severity,
    confidence: draft.confidence,
    summary: draft.summary.slice(0, 8000),
    unverifiedClaims: cluster.rows.map(row => row.summary).filter(Boolean).join(" ").slice(0, 4000),
    operationalImpact: draft.operationalImpact.slice(0, 4000),
    polestarView: draft.polestarView.slice(0, 4000),
    outlook: draft.outlook.slice(0, 4000),
    materialityReason: draft.materialityReason.slice(0, 2000),
    impactAreas: [...new Set(draft.impactAreas)],
    missingInfo: notes.slice(0, 4000),
    evidence: clusterEvidence(cluster, nowIso),
  };
  return {
    ...content,
    id: crypto.randomUUID(),
    mergedInto: null,
    updatedAt: nowIso,
    drafted: true,
    warnings: assessDbPortsItem(content, window, parameters),
  };
}

const DraftedWatchSchema = z.object({
  include: z.boolean(),
  issue: z.string(),
  location: z.string(),
  reasonForMonitoring: z.string(),
  triggerOrIndicator: z.string(),
  verificationStatus: z.enum(["unverified", "single_source", "corroborated", "official"]),
});

const WATCH_INSTRUCTION = [
  "You draft one Watchlist entry for a fortnightly Ports and Logistics Intelligence report covering APAC and Oceania.",
  "A Watchlist entry is a developing issue that may become material but does not yet justify a full item.",
  "Write only from the supplied source reports; never add facts they do not state.",
  "Set include to false if the material is already a confirmed, fully reported event, or if it has no plausible route to affecting ports, terminals, corridors or supply chain continuity.",
  "issue: one short factual line. location: the city, area or corridor.",
  "reasonForMonitoring: about 30 words on why it could become material.",
  "triggerOrIndicator: about 25 words naming the observable development that would make it material.",
  "Plain British English, no rhetoric.",
].join(" ");

function watchToItem(
  draft: z.output<typeof DraftedWatchSchema>,
  cluster: DbPortsCluster,
  window: Window,
  parameters: DbPortsParameters,
  nowIso: string,
): DbPortsItem {
  const content = {
    ...emptyDbPortsItem(),
    headline: (draft.issue.trim() || cluster.rows.map(row => row.title.trim()).find(Boolean) || "").slice(0, 500),
    country: cluster.country,
    location: draft.location.slice(0, 200),
    assets: cluster.assets.slice(0, 10),
    eventDate: cluster.rows.map(row => row.eventDate).find(date => date && isCalendarDate(date)) ?? null,
    theme: themeFor(textOf(cluster.rows[0]!)),
    disposition: "watch" as const,
    severity: null,
    confidence: draft.verificationStatus,
    summary: "",
    unverifiedClaims: cluster.rows.map(row => row.summary).filter(Boolean).join(" ").slice(0, 4000),
    materialityReason: draft.reasonForMonitoring.slice(0, 2000),
    outlook: draft.triggerOrIndicator.slice(0, 4000),
    evidence: clusterEvidence(cluster, nowIso),
  };
  return {
    ...content,
    id: crypto.randomUUID(),
    mergedInto: null,
    updatedAt: nowIso,
    drafted: true,
    warnings: assessDbPortsItem(content, window, parameters),
  };
}

const OverviewSchema = z.object({ overview: z.string() });

const OVERVIEW_INSTRUCTION = [
  "You write the Regional Overview of a fortnightly Ports and Logistics Intelligence report covering APAC and Oceania.",
  "Use only the supplied items. Add no event, figure or consequence that is not among them.",
  "It is an analytical summary, not a list of headlines: identify the most important developments, any change in the regional operating environment, emerging hotspots, material disruption, and what requires closer monitoring.",
  "Do not name anything the highest severity and do not describe the reader's overall organisational risk.",
  "Write continuous prose in plain British English within the supplied word band, and never exceed its maximum. No headings, no bullet points, no source citations.",
].join(" ");

async function mapPool<T, R>(values: T[], limit: number, run: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function generateDbPortsOverview(
  items: DbPortsItem[],
  parameters: DbPortsParameters,
  window: Window,
): Promise<string> {
  const selected = items.filter(item => item.disposition === "selected" && !item.mergedInto);
  if (!selected.length) {
    throw new Error("Select at least one priority item before generating the Regional Overview.");
  }
  const band = Math.min(Math.max(parameters.overviewWordTarget, DB_PORTS_OVERVIEW_MIN_WORDS), DB_PORTS_OVERVIEW_MAX_WORDS);
  const input = {
    reportingPeriod: window,
    // The configured overview length is the ceiling, not a suggestion: the
    // editor and the quality checks measure against the same number.
    wordBand: { minimum: DB_PORTS_OVERVIEW_MIN_WORDS, target: band, maximum: band },
    items: selected.map(item => ({
      headline: item.headline,
      country: item.country,
      location: item.location,
      theme: dbPortsThemeLabel(item.theme),
      severity: item.severity,
      operationalImpact: item.operationalImpact,
      impactAreas: item.impactAreas.map(dbPortsImpactLabel),
    })),
    watchlist: items.filter(item => item.disposition === "watch").map(item => ({
      issue: item.headline,
      location: item.location,
      reason: item.materialityReason,
    })),
  };
  const write = async (correction?: string): Promise<string> => {
    const result = await dbPortsJson(
      OverviewSchema,
      "db_ports_overview",
      correction ? `${OVERVIEW_INSTRUCTION} ${correction}` : OVERVIEW_INSTRUCTION,
      input,
    );
    return result.overview.trim();
  };

  // An instruction to stay inside a word band is not self-enforcing, so the
  // draft is measured, re-asked once against its own measurement, and finally
  // cut back to whole sentences that fit.
  let overview = await write();
  const words = wordCount(overview);
  if (words > band || words < DB_PORTS_OVERVIEW_MIN_WORDS) {
    overview = await write(
      `A previous attempt ran to ${words} words, which is outside the band. Write between ${DB_PORTS_OVERVIEW_MIN_WORDS} and ${band} words: ` +
      (words > band
        ? "drop the least consequential material rather than compressing every sentence."
        : "develop the analysis of the supplied items further, without adding anything new."),
    );
  }
  return fitOverviewToBand(overview, DB_PORTS_OVERVIEW_MIN_WORDS, band);
}

/** Cuts an over-long overview back at a sentence boundary. If no whole-sentence
 * cut keeps it above the minimum the text is left alone for the editor check to
 * report, because a truncated sentence would be worse than a long paragraph. */
function fitOverviewToBand(text: string, minimum: number, maximum: number): string {
  const trimmed = text.trim();
  if (wordCount(trimmed) <= maximum) return trimmed;
  const sentences = trimmed.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return trimmed;
  let kept = "";
  for (const sentence of sentences) {
    const candidate = `${kept}${sentence}`.trim();
    if (wordCount(candidate) > maximum) break;
    kept = `${candidate} `;
  }
  const fitted = kept.trim();
  return fitted && wordCount(fitted) >= minimum ? fitted : trimmed;
}

export async function regenerateDbPortsItem(
  item: DbPortsItem,
  parameters: DbPortsParameters,
  window: Window,
  nowIso: string,
): Promise<DbPortsItem> {
  if (!dbPortsAiConfigured()) {
    throw new Error("Draft generation requires the configured AI service; nothing was written.");
  }
  const draft = await dbPortsJson(DraftedItemSchema, "db_ports_item", ITEM_INSTRUCTION, {
    reportingPeriod: window,
    country: item.country,
    priorityAssetsMatched: item.assets,
    maximumItemWords: parameters.itemWordTarget,
    analystNotes: item.analystNotes,
    sourceReports: [
      ...item.evidence.map(entry => ({
        title: entry.originalTitle || item.headline,
        reportedText: entry.excerpt,
        location: item.location,
        publisher: entry.sourceName,
        storedSourceDate: entry.sourceDate,
        storedEventDate: item.eventDate,
      })),
      ...(item.unverifiedClaims.trim()
        ? [{
            title: item.headline,
            reportedText: item.unverifiedClaims.slice(0, 1200),
            location: item.location,
            publisher: "Stored collection text",
            storedSourceDate: null,
            storedEventDate: item.eventDate,
          }]
        : []),
    ],
  });
  // A redraft has to clear the same bar as a first draft. If it no longer does,
  // the item drops out of the report rather than exporting on its old standing.
  const material = isMaterialDraft(draft, item.assets);
  const belowFloor = severityRank(draft.severity) < severityRank(parameters.minimumSeverity);
  const failure = !draft.include && draft.excludeReason.trim()
    ? `Held after regeneration: ${draft.excludeReason.trim()}`
    : !draft.include
      ? "Held after regeneration: the drafting pass judged the material outside the report's inclusion rule."
      : belowFloor
        ? `Held after regeneration: severity ${draft.severity} is below the configured minimum of ${parameters.minimumSeverity}.`
        : !material
          ? "Held after regeneration: the materiality rule is not met — the redraft does not establish a consequence for a named port, terminal, corridor or operating function."
          : "";
  const demoted = !!failure && item.disposition === "selected";
  const content = {
    ...item,
    disposition: demoted ? ("hold" as const) : item.disposition,
    headline: draft.headline.slice(0, 500) || item.headline,
    location: draft.location.slice(0, 200) || item.location,
    assets: [...new Set([...item.assets, ...draft.assets])].slice(0, 10),
    eventDate: item.eventDate ??
      (isCalendarDate(draft.eventDate) && draft.eventDate <= window.endDate ? draft.eventDate : null),
    theme: draft.theme,
    severity: draft.severity,
    confidence: draft.confidence,
    summary: draft.summary.slice(0, 8000),
    operationalImpact: draft.operationalImpact.slice(0, 4000),
    polestarView: draft.polestarView.slice(0, 4000),
    outlook: draft.outlook.slice(0, 4000),
    materialityReason: draft.materialityReason.slice(0, 2000),
    impactAreas: [...new Set(draft.impactAreas)],
    missingInfo: [draft.missingInfo.trim(), failure].filter(Boolean).join(" ").slice(0, 4000),
  };
  return {
    ...content,
    updatedAt: nowIso,
    drafted: true,
    warnings: assessDbPortsItem(content, window, parameters),
  };
}

export type DbPortsGeneration = {
  items: DbPortsItem[];
  overview: string;
  detail: string;
};

/** Generate Draft: screen collected material, fold repeat coverage, draft the
 * priority items and Watchlist, then write the overview from what survived.
 * Items the analyst created or edited by hand are never overwritten. */
export async function generateDbPortsDraft(
  row: { startDate: string; endDate: string; items: DbPortsItem[] },
  parameters: DbPortsParameters,
  watchlist: DbPortsWatchTarget[],
  nowIso: string,
): Promise<DbPortsGeneration> {
  if (!dbPortsAiConfigured()) {
    throw new Error("Draft generation requires the configured AI service; nothing was written.");
  }
  const window = { startDate: row.startDate, endDate: row.endDate };
  const discovery = await readDbPortsDiscovery(window);
  const { clusters, screened, excluded } = clusterDbPortsCandidates(discovery.rows, parameters, watchlist);

  const kept = row.items.filter(item => !item.drafted);
  const keptUrls = new Set(
    kept.flatMap(item => item.evidence.map(entry => canonicalSourceUrl(entry.sourceUrl))),
  );
  const fresh = clusters.filter(
    cluster => !cluster.rows.some(candidate => keptUrls.has(canonicalSourceUrl(candidate.sourceUrl))),
  );

  const target = Math.max(1, Math.min(parameters.targetItems, 40));
  // Analyst items already occupy part of the report, so the generator drafts
  // into the space that is left. Without this the target and the five-entry
  // Watchlist cap would be exceeded and the whole run rejected on save.
  const keptSelected = kept.filter(item => item.disposition === "selected" && !item.mergedInto).length;
  const keptWatch = kept.filter(item => item.disposition === "watch" && !item.mergedInto).length;
  const room = Math.max(0, target - keptSelected);
  const watchRoom = Math.max(0, DB_PORTS_MAX_WATCH - keptWatch);
  // A little headroom so items the model holds back do not shrink the report
  // below target, without ever drafting padding beyond the material found.
  const itemClusters = room ? fresh.slice(0, room + 5) : [];
  const watchClusters = parameters.includeWatchlist && watchRoom
    ? fresh.slice(itemClusters.length, itemClusters.length + watchRoom)
    : [];

  const drafted = await mapPool(itemClusters, 4, async cluster => {
    const draft = await dbPortsJson(
      DraftedItemSchema,
      "db_ports_item",
      ITEM_INSTRUCTION,
      clusterInput(cluster, window, parameters),
    );
    return draftToItem(draft, cluster, window, parameters, nowIso);
  });

  const selected = drafted.filter(item => item.disposition === "selected");
  const held = drafted.filter(item => item.disposition !== "selected");
  const trimmed = selected.slice(0, room);
  for (const extra of selected.slice(room)) {
    held.push({ ...extra, disposition: "hold", missingInfo:
      [extra.missingInfo, "Held during generation: beyond the configured item target."].filter(Boolean).join(" ") });
  }

  const watchDrafts = watchClusters.length
    ? await mapPool(watchClusters, 4, async cluster => {
        const draft = await dbPortsJson(
          DraftedWatchSchema,
          "db_ports_watch",
          WATCH_INSTRUCTION,
          clusterInput(cluster, window, parameters),
        );
        return draft.include ? watchToItem(draft, cluster, window, parameters, nowIso) : null;
      })
    : [];
  const watchItems = watchDrafts.filter((item): item is DbPortsItem => !!item).slice(0, watchRoom);

  // The edition itself is capped, so held near-misses take only the space left
  // once the report's own items are in. Nothing selected or kept is dropped.
  const capacity = Math.max(0, DB_PORTS_MAX_ITEMS - (kept.length + trimmed.length + watchItems.length));
  const heldWithinCap = held.slice(0, capacity);
  const items = [...kept, ...trimmed, ...watchItems, ...heldWithinCap];
  // The overview describes the report as it now stands — analyst items
  // included — so it can never survive as a summary of items that have gone.
  const overview = items.some(item => item.disposition === "selected" && !item.mergedInto)
    ? await generateDbPortsOverview(items, parameters, window)
    : "";
  const detail =
    `Screened ${screened} collected reports into ${clusters.length} distinct events; ` +
    `${excluded} were outside the configured geography, themes or materiality rule. ` +
    `Drafted ${trimmed.length} priority items, ${watchItems.length} watchlist entries and held ${held.length} near-misses. ` +
    `${kept.length} analyst items were left untouched.` +
    (discovery.truncated ? " The collection read hit its row cap; coverage may be incomplete." : "");
  return { items, overview, detail };
}
