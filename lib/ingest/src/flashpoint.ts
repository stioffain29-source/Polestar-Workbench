import Parser from "rss-parser";
import { db, incidentsTable, sourcesTable } from "@workspace/db";
import { sql, eq, or, gte, isNotNull } from "drizzle-orm";
import { cleanText, hasWord, parseDate } from "./text";
import { classifySeverity } from "./severity";
import type { FeedStat, IngestOptions, IngestSummary } from "./types";

const FEED_TIMEOUT_MS = 20000;
const FEED_UA = "Mozilla/5.0 (PolestarWorkbench FlashpointScraper)";

// Fetch + parse a feed robustly. rss-parser's parseURL does not reliably
// decompress gzip/br responses — some feeds (e.g. Jubi.id, the dedicated
// Indonesian West Papua source) return gzipped bytes that surface as a
// "Non-whitespace before first tag, Char: \x1F" XML error (\x1F is the
// gzip magic byte). Node's global fetch auto-decompresses gzip/deflate/br,
// so we fetch the body ourselves and hand the decoded text to parseString.
async function fetchFeed(parser: Parser, url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": FEED_UA,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Status code ${res.status}`);
    const body = await res.text();
    return await parser.parseString(body);
  } finally {
    clearTimeout(timer);
  }
}

// Flashpoint ingest core.
//
// Reads catalogued sources where topic='flashpoint' from the sources
// table and fetches RSS for each row that has a URL. Records that pass
// the Flashpoint relevance allowlist AND survive the kinetic /
// commercial-noise denylist get inserted with topic='flashpoint'. Each
// source row's last_success_at / last_failure_at is updated so Source
// Health reflects reality.
//
// Mirrors cargoWatch.ts in structure. Keep the two in sync when adding
// new dedupe / classification logic.

type Accepted = {
  title: string;
  summary: string;
  country: string;
  occurredAt: Date;
  source: string;
  sourceUrl: string;
  feedLabel: string;
  reason: string;
};

type Rejected = {
  title: string;
  reason: string;
  feedLabel: string;
};

// Required Flashpoint cues. Mirror of REQUIRED.flashpoint in
// artifacts/workbench/src/lib/topicRelevance.ts. At least one must hit
// in title+summary for the item to qualify.
const FLASHPOINT_REQUIRED: RegExp[] = [
  /\b(protest|demonstration|rally|march|sit[- ]in|strike|walkout|stoppage|riot|public disorder|looting|roadblock|road block|unrest|disorder|crackdown|clash)/i,
  /\b(curfew|state of emergency|martial law|lockdown imposed)/i,
  /\b(security forces?|police|military) .{0,30}(deployed|operation|clash|crackdown|tear[- ]?gas|baton|rubber bullet|water cannon|mass arrest)/i,
  /\b(students?|workers|farmers|union|opposition|civil society|teachers|chemists?|lawyers?) .{0,30}(protest|march|rally|strike|gather|walkout|boycott)/i,
];

// Deny list. Excludes kinetic armed-conflict, cargo-theft noise,
// commercial / market commentary and the live-blog / fluff patterns
// stripped by EXCLUDE_PHRASES in topicRelevance.ts. Order does not
// matter; a single hit rejects the item.
const FLASHPOINT_DENY: RegExp[] = [
  // Kinetic armed conflict
  /\b(drone[- ]?strike|missile[- ]?strike|air[- ]?strike|airstrike|airborne attack|artillery (strike|shelling|fire)|\bshelling\b|\bambush\b|\bied\b|bomb (attack|blast|kills|detonat)|suicide bomb|car bomb|gunmen (kill|attack)|gun battle|gunbattle|militants? (kill|attack|target|ambush|raid|strike|fire)|insurgents? (kill|attack|target|ambush)|jihadist|terror(ist)? attack|armed group (attack|kill|raid)|terrorists? killed|wanted (commander|terrorist|ringleader)|quadcopter)\b/i,
  // Cargo / freight noise (handled by cargo_watch)
  /\b(cargo theft|truck hijack|warehouse theft|container theft|freight theft|depot theft|cargo robbery|seal tamper)\b/i,
  // Commercial / market commentary
  /\b(share price|stock price|earnings|quarterly (result|results|report)|dividend|buyback|ipo|market cap|futures contract|hedge fund|analyst (note|target|forecast)|price target|upgrade rating|downgrade rating)\b/i,
  /\b(oil futures|crude futures|brent futures|wti futures|petrol price today|diesel price today|fuel price today)\b/i,
  // Shared exclusions from topicRelevance.ts EXCLUDE_PHRASES
  /\bnews live\b/i,
  /\blive (updates?|blog)\b/i,
  /^live:/i,
  /\bhiking\b/i,
  /\binca trail\b/i,
  /\btourist who died\b/i,
  /\bobituary\b/i,
  /\bsport(s)? results?\b/i,
  /\bmatch report\b/i,
  /\bbox office\b/i,
  /\bcelebrity\b/i,
  /\bentertainment news\b/i,
  /\brecipe\b/i,
];

// Country aliases for in-text matching. Restricted to the 14 APAC
// targets the Flashpoint Data Coverage Audit calls out, plus Myanmar
// (genuine flashpoint signal source) and Vietnam (occasional). UAE and
// other ME entries are deliberately excluded — they belong to Strike,
// not Flashpoint.
const COUNTRY_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "Australia",         aliases: ["australia", "sydney", "melbourne", "brisbane", "canberra", "perth", "adelaide"] },
  { canonical: "Bangladesh",        aliases: ["bangladesh", "dhaka", "chittagong"] },
  { canonical: "China",             aliases: ["china", "beijing", "shanghai", "guangzhou", "shenzhen", "hong kong"] },
  { canonical: "India",             aliases: ["india", "delhi", "mumbai", "chennai", "bengaluru", "kolkata", "hyderabad"] },
  { canonical: "Indonesia",         aliases: ["indonesia", "jakarta", "java", "sumatra", "bali", "sulawesi", "surabaya", "bandung"] },
  { canonical: "Japan",             aliases: ["japan", "tokyo", "osaka", "kyoto", "yokohama", "nagoya", "fukuoka"] },
  { canonical: "Malaysia",          aliases: ["malaysia", "kuala lumpur", "penang", "johor", "sabah", "sarawak"] },
  { canonical: "Myanmar",           aliases: ["myanmar", "burma", "yangon", "mandalay", "naypyidaw"] },
  { canonical: "Nepal",             aliases: ["nepal", "kathmandu", "pokhara"] },
  { canonical: "Pakistan",          aliases: ["pakistan", "karachi", "lahore", "islamabad", "rawalpindi", "peshawar"] },
  // NOTE: Papua New Guinea and Indonesian West Papua are resolved by
  // resolvePapuaPng() (below), NOT by this alias table, because they share
  // the ambiguous word "papua". Do not re-add a "papua"/"png" alias here.
  { canonical: "Philippines",       aliases: ["philippines", "manila", "cebu", "davao", "quezon city"] },
  { canonical: "South Korea",       aliases: ["south korea", "seoul", "busan", "incheon", "daegu"] },
  { canonical: "Sri Lanka",         aliases: ["sri lanka", "colombo", "kandy", "jaffna"] },
  { canonical: "Thailand",          aliases: ["thailand", "bangkok", "chiang mai", "phuket"] },
  { canonical: "Vietnam",           aliases: ["vietnam", "viet nam", "hanoi", "ho chi minh", "haiphong"] },
];

// Papua / PNG disambiguation. The Indonesian province of Papua / West Papua
// and the independent state of Papua New Guinea share the word "papua"; a
// naive alias list mis-routes Jayapura / West-Papua stories to "Papua New
// Guinea", which then drops them from BOTH country reports (wrong token for
// the Papua report; stripped from PNG by the West-Papua content guard).
// Resolve them explicitly. Keep these markers in sync with the report-side
// guards in artifacts/workbench/src/lib/countryMatch.ts
// (WEST_PAPUA_CONTEXT_RE / PNG_CONTEXT_RE).
const PNG_MARKERS =
  /\b(papua new guinea|png|port moresby|lae|mount hagen|mt hagen|bougainville|enga|hela|highlands highway|madang|morobe|kokopo|goroka|wewak|kimbe|tari|pngdf|rpngc|marape|bismarck archipelago)\b/i;
const WEST_PAPUA_MARKERS =
  /\b(west papua|papua barat|jayapura|wamena|manokwari|sorong|merauke|nabire|timika|mimika|biak|fakfak|jayawijaya|free west papua|opm|tpnpb|papua pegunungan|papua tengah|papua selatan|papua barat daya|highland papua)\b/i;
const INDONESIA_CONTEXT = /\b(indonesia|indonesian|tni|polri|jakarta)\b/i;

/**
 * Resolve a Papua-region country tag, or null when the text is not about
 * either Papua. Cross-border records (both PNG and West Papua markers) are
 * tagged with both so they appear in both country reports.
 */
function resolvePapuaPng(hay: string): string | null {
  const png = PNG_MARKERS.test(hay);
  const wp = WEST_PAPUA_MARKERS.test(hay);
  if (png && wp) return "West Papua; Papua New Guinea";
  if (png) return "Papua New Guinea";
  if (wp) return "West Papua";
  // Bare "papua" with Indonesian context but no province marker -> West Papua.
  if (/\bpapua\b/i.test(hay) && INDONESIA_CONTEXT.test(hay)) return "West Papua";
  return null;
}

function classify(title: string, summary: string): {
  kept: boolean;
  reason: string;
  country: string | null;
} {
  const hay = `${title}\n${summary}`;

  for (const re of FLASHPOINT_DENY) {
    if (re.test(hay)) return { kept: false, reason: `deny:${re.source.slice(0, 30)}`, country: null };
  }
  const allowHit = FLASHPOINT_REQUIRED.find((re) => re.test(hay));
  if (!allowHit) return { kept: false, reason: "no-flashpoint-cue", country: null };

  // Country must appear in TITLE or SUMMARY (broader than cargo-watch
  // because Flashpoint headlines often omit the country, e.g.
  // "Students hold protest against fee hike" with the country only in
  // the summary's dateline). Papua / PNG are resolved first by
  // resolvePapuaPng so Indonesian West Papua is not mis-routed to PNG.
  let country = resolvePapuaPng(hay);
  if (!country) {
    const m = COUNTRY_ALIASES.find((c) => c.aliases.some((a) => hasWord(hay, a)));
    country = m ? m.canonical : null;
  }
  if (!country) return { kept: false, reason: "no-apac-country", country: null };

  return { kept: true, reason: `allow:${allowHit.source.slice(0, 30)}`, country };
}

function dedupeKey(title: string, when: Date, country: string): string {
  return [
    title.trim().toLowerCase().slice(0, 200),
    when.toISOString().slice(0, 10),
    country.trim().toLowerCase(),
    "flashpoint",
  ].join("||");
}

async function topicStats(): Promise<{ totalAfter: number; latestRecord: string | null; lastUpdated: string | null }> {
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS count,
           MAX(occurred_at) AS latest,
           MAX(created_at)  AS updated
    FROM incidents WHERE topic='flashpoint'
  `);
  const row = res.rows[0] as { count: number; latest: Date | string | null; updated: Date | string | null } | undefined;
  const latest = row?.latest ? new Date(row.latest).toISOString().slice(0, 10) : null;
  const updated = row?.updated ? new Date(row.updated).toISOString() : null;
  return { totalAfter: row?.count ?? 0, latestRecord: latest, lastUpdated: updated };
}

/**
 * Run the Flashpoint ingest. Returns a structured summary. Does NOT close
 * the shared DB pool — callers that own the process lifecycle (CLI) are
 * responsible for that; long-lived callers (the API server) must not.
 */
export async function runFlashpointIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  log(`Flashpoint scraper — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const sources = await db
    .select({
      id: sourcesTable.id,
      name: sourcesTable.name,
      url: sourcesTable.url,
      sourceType: sourcesTable.sourceType,
    })
    .from(sourcesTable)
    .where(eq(sourcesTable.topic, "flashpoint"));

  const fetchable = sources.filter(
    (s) =>
      !!s.url &&
      (s.sourceType === "rss" || s.sourceType === "news") &&
      /^https?:\/\//.test(s.url),
  );

  log(`Catalogued flashpoint sources: ${sources.length}, fetchable: ${fetchable.length}`);

  const parser = new Parser({
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench FlashpointScraper)" },
  });

  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  const perFeed: Record<string, FeedStat> = {};

  // Feeds are fetched with bounded concurrency. Sequential fetching of
  // ~39 feeds at a 20s-per-feed timeout can exceed two minutes.
  // Processing is otherwise identical and order-independent.
  const CONCURRENCY = 8;
  const processFeed = async (s: (typeof fetchable)[number]) => {
    perFeed[s.name] = { name: s.name, found: 0, accepted: 0, rejected: 0 };
    try {
      const parsed = await fetchFeed(parser, s.url!);
      const items = parsed.items ?? [];
      perFeed[s.name].found = items.length;
      for (const item of items) {
        const title = cleanText(item.title);
        const summary = cleanText(item.contentSnippet || item.content || "");
        const when = parseDate(item.isoDate || item.pubDate) ?? new Date();
        const link = item.link?.trim();
        if (!title || !link) {
          rejected.push({ title: title || "(no title)", reason: "missing-field", feedLabel: s.name });
          perFeed[s.name].rejected++;
          continue;
        }
        const c = classify(title, summary);
        if (!c.kept || !c.country) {
          rejected.push({ title, reason: c.reason, feedLabel: s.name });
          perFeed[s.name].rejected++;
          continue;
        }
        accepted.push({
          title: title.slice(0, 500),
          summary: summary || title,
          country: c.country,
          occurredAt: when,
          source: s.name,
          sourceUrl: link,
          feedLabel: s.name,
          reason: c.reason,
        });
        perFeed[s.name].accepted++;
      }
      if (commit) {
        await db
          .update(sourcesTable)
          .set({ lastSuccessAt: new Date(), errorMessage: null })
          .where(eq(sourcesTable.id, s.id));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      perFeed[s.name].error = msg;
      if (commit) {
        await db
          .update(sourcesTable)
          .set({ lastFailureAt: new Date(), errorMessage: msg.slice(0, 500) })
          .where(eq(sourcesTable.id, s.id));
      }
    }
  };
  for (let i = 0; i < fetchable.length; i += CONCURRENCY) {
    await Promise.allSettled(fetchable.slice(i, i + CONCURRENCY).map(processFeed));
  }

  // In-batch dedupe (key + URL).
  const seenKeys = new Set<string>();
  const seenUrls = new Set<string>();
  const uniqueAccepted: Accepted[] = [];
  for (const a of accepted) {
    const k = dedupeKey(a.title, a.occurredAt, a.country);
    if (seenKeys.has(k) || seenUrls.has(a.sourceUrl)) continue;
    seenKeys.add(k);
    seenUrls.add(a.sourceUrl);
    uniqueAccepted.push(a);
  }

  // DB dedupe against existing flashpoint rows + global source_url dedupe.
  // Scope to the last 365 days OR any row carrying a source_url.
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const existing = await db
    .select({
      title: incidentsTable.title,
      occurredAt: incidentsTable.occurredAt,
      country: incidentsTable.country,
      topic: incidentsTable.topic,
      sourceUrl: incidentsTable.sourceUrl,
    })
    .from(incidentsTable)
    .where(or(gte(incidentsTable.occurredAt, cutoff), isNotNull(incidentsTable.sourceUrl)));

  const existingKeys = new Set<string>();
  const existingUrls = new Set<string>();
  for (const row of existing) {
    if (row.sourceUrl) existingUrls.add(row.sourceUrl);
    if (row.topic === "flashpoint") existingKeys.add(dedupeKey(row.title, row.occurredAt, row.country));
  }

  const toInsert: Accepted[] = [];
  let dupeInDb = 0;
  for (const a of uniqueAccepted) {
    if (existingUrls.has(a.sourceUrl) || existingKeys.has(dedupeKey(a.title, a.occurredAt, a.country))) {
      dupeInDb++;
      continue;
    }
    toInsert.push(a);
  }

  // Report
  log("\n=== Per-feed ===");
  for (const s of fetchable) {
    const f = perFeed[s.name];
    if (f.error) {
      log(`  ${s.name.padEnd(32)} ERROR: ${f.error.slice(0, 80)}`);
    } else {
      log(`  ${s.name.padEnd(32)} found=${f.found.toString().padStart(3)} accepted=${f.accepted.toString().padStart(3)} rejected=${f.rejected.toString().padStart(3)}`);
    }
  }

  const countryCoverage = new Map<string, number>();
  for (const a of uniqueAccepted) {
    countryCoverage.set(a.country, (countryCoverage.get(a.country) ?? 0) + 1);
  }
  log("\n=== Country coverage (unique accepted) ===");
  for (const [c, n] of [...countryCoverage.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${c.padEnd(22)} ${n}`);
  }
  if (countryCoverage.size === 0) log("  (none)");

  log("\n=== Totals ===");
  log(`  Sources fetched     : ${fetchable.length}`);
  log(`  Items considered    : ${accepted.length + rejected.length}`);
  log(`  Accepted (raw)      : ${accepted.length}`);
  log(`  Accepted (unique)   : ${uniqueAccepted.length}`);
  log(`  Duplicate in DB     : ${dupeInDb}`);
  log(`  New to insert       : ${toInsert.length}`);
  log(`  Rejected            : ${rejected.length}`);

  const summaryBase = {
    topic: "flashpoint" as const,
    mode: (commit ? "commit" : "dry-run") as IngestSummary["mode"],
    sourcesFetched: fetchable.length,
    itemsConsidered: accepted.length + rejected.length,
    acceptedRaw: accepted.length,
    acceptedUnique: uniqueAccepted.length,
    duplicateInDb: dupeInDb,
    newToInsert: toInsert.length,
    rejected: rejected.length,
    perFeed: fetchable.map((s) => perFeed[s.name]),
    countryCoverage: [...countryCoverage.entries()].sort((a, b) => b[1] - a[1]),
  };

  if (!commit) {
    log("\nDRY-RUN — no rows written. Re-run with --commit to insert.");
    return { ...summaryBase, inserted: 0, totalAfter: null, latestRecord: null, lastUpdated: null, logLines };
  }

  if (toInsert.length === 0) {
    log("\nNothing to insert.");
    const stats = await topicStats();
    return { ...summaryBase, inserted: 0, ...stats, logLines };
  }

  const rows: (typeof incidentsTable.$inferInsert)[] = toInsert.map((a) => ({
    topic: "flashpoint",
    title: a.title,
    summary: a.summary,
    country: a.country,
    location: null,
    latitude: null,
    longitude: null,
    occurredAt: a.occurredAt,
    severity: classifySeverity(a.title, a.summary, "flashpoint"),
    confidence: "low",
    source: a.source,
    sourceUrl: a.sourceUrl,
    analystNotes: `auto-scraped:${a.feedLabel}`,
  }));

  await db.insert(incidentsTable).values(rows);
  const stats = await topicStats();
  log(`\nInserted ${rows.length} rows. flashpoint total now: ${stats.totalAfter}`);

  return { ...summaryBase, inserted: rows.length, ...stats, logLines };
}
