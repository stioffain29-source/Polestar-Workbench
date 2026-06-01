import Parser from "rss-parser";
import { db, incidentsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { cleanText, hasWord, parseDate } from "./text";
import { classifySeverity } from "./severity";
import { geocode } from "./geocode";
import { evaluateIncidentRelevance } from "@workspace/relevance";
import type { FeedStat, IngestOptions, IngestSummary } from "./types";

// Shipping ingest core.
//
// Shipping was previously import-only — no live source kept it current, so
// the monitor froze at the last manual import. This scraper queries Google
// News RSS for maritime-security / disruption signals across the chokepoints
// and the Middle East + APAC ports that matter to the Shipping monitor, then
// classifies, dedupes and inserts with topic='shipping'. It mirrors
// cargoWatch.ts in structure.
//
// The allowlist is aligned to REQUIRED.shipping in @workspace/relevance so
// accepted items pass the central relevance gate and surface in the monitor
// rather than being stored and then filtered out. Each row still carries the
// persisted relevance verdict (a few off-topic items can slip the keyword
// filter; the API/monitor drop those by relevance_status).

type Feed = {
  label: string;
  url: string;
  group: "chokepoint" | "vessel" | "port";
  /** Country tag used when the text itself names no in-scope country. */
  defaultCountry: string;
};

function gnews(query: string): string {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

// Chokepoint feeds — one per strait/canal that drives the Shipping monitor's
// Chokepoint Watch. Each carries a sensible default country for at-sea items.
const CHOKEPOINT_FEEDS: { label: string; q: string; defaultCountry: string }[] = [
  {
    label: "Strait of Hormuz",
    q: `"Strait of Hormuz" (tanker OR vessel OR ship OR shipping OR attack OR seized OR seizure OR closure OR blockade OR naval OR missile OR drone OR diversion)`,
    defaultCountry: "Iran",
  },
  {
    label: "Bab el-Mandeb",
    q: `("Bab el-Mandeb" OR "Bab al-Mandab") (vessel OR ship OR tanker OR attack OR shipping OR closure OR Houthi OR missile OR drone)`,
    defaultCountry: "Yemen",
  },
  {
    label: "Red Sea",
    q: `"Red Sea" (vessel OR tanker OR ship OR attack OR attacked OR shipping OR Houthi OR missile OR drone OR seized OR diversion)`,
    defaultCountry: "Yemen",
  },
  {
    label: "Suez Canal",
    q: `"Suez Canal" (disruption OR transit OR diversion OR backlog OR closure OR shipping OR vessel OR rerouting OR traffic)`,
    defaultCountry: "Unknown",
  },
  {
    label: "Strait of Malacca",
    q: `"Strait of Malacca" (vessel OR ship OR tanker OR attack OR piracy OR robbery OR boarding OR hijack)`,
    defaultCountry: "Malaysia",
  },
  {
    label: "Singapore Strait",
    q: `"Singapore Strait" (vessel OR ship OR boarding OR robbery OR attack OR piracy OR hijack)`,
    defaultCountry: "Singapore",
  },
];

// Vessel-incident feeds — kinetic / seizure events across the region.
const VESSEL_FEEDS: { label: string; q: string; defaultCountry: string }[] = [
  {
    label: "Vessel attacks",
    q: `(vessel OR tanker OR "cargo ship" OR "container ship" OR "bulk carrier") (attacked OR seized OR boarded OR hijacked OR missile OR drone) (Hormuz OR "Red Sea" OR Gulf OR UAE OR Iran OR Yemen OR Oman OR Qatar OR Aden)`,
    defaultCountry: "Unknown",
  },
  {
    label: "Maritime advisories",
    q: `(UKMTO OR "maritime security" OR "naval advisory" OR "war risk insurance") (Hormuz OR "Red Sea" OR Gulf OR vessel OR tanker OR shipping)`,
    defaultCountry: "Unknown",
  },
];

const PORT_TERMS = `("port closure" OR "port shutdown" OR "port strike" OR "port congestion" OR "port disruption" OR "berth backlog")`;

// Port-disruption feeds across Middle East + APAC.
const PORT_COUNTRIES = [
  "United Arab Emirates",
  "Saudi Arabia",
  "Oman",
  "Qatar",
  "Singapore",
  "Malaysia",
  "Indonesia",
  "India",
  "Pakistan",
  "China",
  "South Korea",
];

const FEEDS: Feed[] = [
  ...CHOKEPOINT_FEEDS.map(
    (c): Feed => ({ label: `Chokepoint · ${c.label}`, url: gnews(c.q), group: "chokepoint", defaultCountry: c.defaultCountry }),
  ),
  ...VESSEL_FEEDS.map(
    (v): Feed => ({ label: `Vessel · ${v.label}`, url: gnews(v.q), group: "vessel", defaultCountry: v.defaultCountry }),
  ),
  ...PORT_COUNTRIES.map(
    (c): Feed => ({ label: `Port · ${c}`, url: gnews(`${PORT_TERMS} "${c}"`), group: "port", defaultCountry: c }),
  ),
];

// Country alias map → canonical country name stored in DB. Full names match
// the existing imported shipping rows (e.g. "United Arab Emirates", "Iran").
// Order matters: more specific actors (Yemen/Houthi) precede broader regional
// names so a Red Sea Houthi item is tagged Yemen, not Saudi Arabia.
const COUNTRY_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "Yemen", aliases: ["yemen", "yemeni", "houthi", "houthis", "aden", "hodeidah", "hudaydah", "bab el-mandeb", "bab al-mandab", "mandeb"] },
  { canonical: "Iran", aliases: ["iran", "iranian", "irgc", "bandar abbas", "strait of hormuz", "hormuz", "persian gulf"] },
  { canonical: "United Arab Emirates", aliases: ["united arab emirates", "uae", "emirates", "dubai", "abu dhabi", "fujairah", "sharjah", "jebel ali"] },
  { canonical: "Qatar", aliases: ["qatar", "doha"] },
  { canonical: "Oman", aliases: ["oman", "omani", "muscat", "salalah", "sohar", "gulf of oman", "duqm"] },
  { canonical: "Saudi Arabia", aliases: ["saudi arabia", "saudi", "ksa", "jeddah", "yanbu", "king abdullah port", "dammam"] },
  { canonical: "Singapore", aliases: ["singapore", "singapore strait"] },
  { canonical: "Malaysia", aliases: ["malaysia", "malaysian", "malacca", "strait of malacca", "port klang", "johor", "penang", "tanjung pelepas"] },
  { canonical: "Indonesia", aliases: ["indonesia", "indonesian", "jakarta", "tanjung priok", "batam", "surabaya"] },
  { canonical: "India", aliases: ["india", "indian", "mumbai", "nhava sheva", "chennai", "kandla", "mundra", "kolkata"] },
  { canonical: "Pakistan", aliases: ["pakistan", "karachi", "port qasim", "gwadar"] },
  { canonical: "China", aliases: ["china", "chinese", "shanghai", "ningbo", "shenzhen", "qingdao", "guangzhou"] },
  { canonical: "South Korea", aliases: ["south korea", "korean", "busan", "ulsan", "incheon"] },
  { canonical: "Japan", aliases: ["japan", "japanese", "yokohama", "kobe", "nagoya", "osaka"] },
  { canonical: "Vietnam", aliases: ["vietnam", "haiphong", "cai mep", "ho chi minh"] },
  { canonical: "Thailand", aliases: ["thailand", "laem chabang", "bangkok"] },
  { canonical: "Philippines", aliases: ["philippines", "manila", "cebu"] },
];

// Allowlist: at least one must hit in title+summary for the item to qualify.
// Kept aligned with REQUIRED.shipping so accepted items pass the relevance
// gate (vessel/port attack, seizure, chokepoint, naval advisory, war risk,
// route diversion, freight rate).
const ALLOW = [
  "vessel attack",
  "vessel attacked",
  "ship attack",
  "ship attacked",
  "tanker attack",
  "tanker attacked",
  "cargo ship attack",
  "container ship attack",
  "bulk carrier attack",
  "attack on vessel",
  "attack on a vessel",
  "attack on tanker",
  "attack on ship",
  "attack on the vessel",
  "vessel seized",
  "tanker seized",
  "ship seized",
  "vessel seizure",
  "tanker seizure",
  "ship seizure",
  "seizure of",
  "boarded",
  "boarding",
  "hijack",
  "hijacked",
  "missile",
  "drone",
  "projectile",
  "torpedo",
  "limpet mine",
  "port closure",
  "port shutdown",
  "port strike",
  "port congestion",
  "port disruption",
  "port attack",
  "berth backlog",
  "chokepoint",
  "strait of hormuz",
  "bab el-mandeb",
  "bab al-mandab",
  "suez canal",
  "strait of malacca",
  "singapore strait",
  "naval advisory",
  "maritime advisory",
  "maritime warning",
  "maritime security",
  "naval patrol",
  "naval operation",
  "war risk",
  "insurance premium",
  // Diversion/rerouting terms are qualified with shipping context only —
  // bare "diversion"/"diverting" matched too many non-maritime stories that
  // were then dropped at the relevance gate (REQUIRED.shipping requires
  // route-diversion maritime context). Keeping the qualified forms preserves
  // ingestion precision.
  "route diversion",
  "shipping diversion",
  "vessel diversion",
  "tanker diversion",
  "diverting around",
  "rerouting",
  "reroute",
  "re-route",
  "freight rate",
];

// Denylist: if any hit, reject even if allowlist matched. Strips commercial
// tonnage trading, ship-finance, market-index and food-price noise — the same
// classes SHIPPING_EXCLUDE drops at the relevance layer, filtered up-front so
// they never reach the table.
const DENY = [
  // Commercial tonnage / ship-finance deals.
  "newbuild",
  "suezmax",
  "vlcc",
  "aframax",
  "panamax",
  "capesize",
  "handysize",
  "orderbook",
  "order book",
  "time charter",
  "charter assessment",
  "fleet renewal",
  "secondhand",
  "second-hand",
  "scrapping",
  "demolition sale",
  // Market indices / equities / corporate results.
  "contex",
  "container index",
  "world container index",
  "baltic dry",
  "baltic exchange",
  "share price",
  "stock price",
  "earnings",
  "quarterly result",
  "dividend",
  "buyback",
  "ipo",
  "acquisition of",
  "acquires",
  "acquired by",
  "merger",
  "joint venture",
  // Food / commodity price macro stories (SHIPPING_EXCLUDE territory).
  "food price",
  "food security",
  "food crisis",
  "grain price",
  "wheat price",
  "edible oil",
  "world food programme",
  "world food program",
  // Debunks, human-interest aftermath and opinion framing. "port strike"
  // collides with military strikes ON a port, which drags in funeral / viral-
  // debunk / op-ed pieces that are not maritime incidents. These markers strip
  // that noise (e.g. "City lays to rest youth killed in ... port strike",
  // "Old ... video viral with false claim").
  "lays to rest",
  "laid to rest",
  "viral",
  "false claim",
  "fact check",
  "fact-check",
  "fake video",
  "old video",
  "misleading",
  "debunk",
];

type Classified = {
  kept: boolean;
  reason: string;
  country: string | null;
};

function detectCountry(hay: string): string | null {
  const match = COUNTRY_ALIASES.find((c) => c.aliases.some((a) => hasWord(hay, a)));
  return match ? match.canonical : null;
}

function classify(title: string, summary: string, feed: Feed): Classified {
  const hay = `${title}\n${summary}`.toLowerCase();

  const denyHit = DENY.find((d) => hay.includes(d));
  if (denyHit) return { kept: false, reason: `deny:${denyHit}`, country: null };

  const allowHit = ALLOW.find((a) => hay.includes(a));
  if (!allowHit) return { kept: false, reason: "no-allowlist-match", country: null };

  // Maritime incidents are often at sea, so unlike cargo we accept a country
  // match anywhere in title+summary, then fall back to the feed's default
  // (e.g. Hormuz → Iran, Bab el-Mandeb → Yemen). "Unknown" mirrors the
  // existing import convention for unlocated at-sea items.
  const country = detectCountry(hay) ?? feed.defaultCountry;

  return { kept: true, reason: `allow:${allowHit}`, country };
}

function dedupeKey(title: string, when: Date, country: string): string {
  return [
    title.trim().toLowerCase().slice(0, 200),
    when.toISOString().slice(0, 10),
    country.trim().toLowerCase(),
    "shipping",
  ].join("||");
}

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

async function topicStats(): Promise<{ totalAfter: number; latestRecord: string | null; lastUpdated: string | null }> {
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS count,
           MAX(occurred_at) AS latest,
           MAX(created_at)  AS updated
    FROM incidents WHERE topic='shipping'
  `);
  const row = res.rows[0] as { count: number; latest: Date | string | null; updated: Date | string | null } | undefined;
  const latest = row?.latest ? new Date(row.latest).toISOString().slice(0, 10) : null;
  const updated = row?.updated ? new Date(row.updated).toISOString() : null;
  return { totalAfter: row?.count ?? 0, latestRecord: latest, lastUpdated: updated };
}

/**
 * Run the Shipping ingest. Returns a structured summary. Does NOT close the
 * shared DB pool — see runFlashpointIngest for the rationale.
 */
export async function runShippingIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  const commit = opts.commit ?? false;
  const titleFilter = opts.titleFilter ? opts.titleFilter.toLowerCase() : null;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  log(`Shipping scraper — ${FEEDS.length} feeds, mode=${commit ? "COMMIT" : "DRY-RUN"}${titleFilter ? `, title filter="${titleFilter}"` : ""}`);

  const parser = new Parser({
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench ShippingScraper)" },
  });

  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  const feedErrors: { feed: string; error: string }[] = [];
  const perFeed: Record<string, FeedStat> = {};

  // Bounded concurrency: sequential fetching at 20s-per-feed can exceed two
  // minutes. Processing is order-independent.
  const CONCURRENCY = 8;
  const processFeed = async (feed: (typeof FEEDS)[number]) => {
    perFeed[feed.label] = { name: feed.label, found: 0, accepted: 0, rejected: 0 };
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = parsed.items ?? [];
      perFeed[feed.label].found = items.length;
      for (const item of items) {
        const title = cleanText(item.title);
        const summary = cleanText(item.contentSnippet || item.content || "");
        const when = parseDate(item.isoDate || item.pubDate);
        const link = item.link?.trim();

        if (!title || !when || !link) {
          rejected.push({ title: title || "(no title)", reason: "missing-required-field", feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }

        const c = classify(title, summary, feed);
        if (!c.kept || !c.country) {
          rejected.push({ title, reason: c.reason, feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }

        // Google News titles often append " - Source Name". Extract it.
        const dashIdx = title.lastIndexOf(" - ");
        const sourceName = dashIdx > 0 ? title.slice(dashIdx + 3).trim() : (parsed.title ?? feed.label);
        const cleanTitle = dashIdx > 0 ? title.slice(0, dashIdx).trim() : title;

        accepted.push({
          title: cleanTitle.slice(0, 500),
          summary: summary || cleanTitle,
          country: c.country,
          occurredAt: when,
          source: sourceName.slice(0, 200),
          sourceUrl: link,
          feedLabel: feed.label,
          reason: c.reason,
        });
        perFeed[feed.label].accepted++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      feedErrors.push({ feed: feed.label, error: msg });
      perFeed[feed.label].error = msg;
    }
  };
  for (let i = 0; i < FEEDS.length; i += CONCURRENCY) {
    await Promise.allSettled(FEEDS.slice(i, i + CONCURRENCY).map(processFeed));
  }

  // In-batch dedupe (multiple feeds can return the same article).
  const seen = new Set<string>();
  const uniqueAccepted: Accepted[] = [];
  for (const a of accepted) {
    const k = dedupeKey(a.title, a.occurredAt, a.country);
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueAccepted.push(a);
  }

  // DB dedupe against existing shipping rows.
  const existing = await db
    .select({
      title: incidentsTable.title,
      occurredAt: incidentsTable.occurredAt,
      country: incidentsTable.country,
      topic: incidentsTable.topic,
      sourceUrl: incidentsTable.sourceUrl,
    })
    .from(incidentsTable);

  const existingKeys = new Set<string>();
  const existingUrls = new Set<string>();
  for (const row of existing) {
    if (row.topic !== "shipping") continue;
    existingKeys.add(dedupeKey(row.title, row.occurredAt, row.country));
    if (row.sourceUrl) existingUrls.add(row.sourceUrl);
  }

  const toInsert: Accepted[] = [];
  let dupeInDb = 0;
  let filteredOut = 0;
  for (const a of uniqueAccepted) {
    if (titleFilter && !a.title.toLowerCase().includes(titleFilter)) {
      filteredOut++;
      continue;
    }
    const key = dedupeKey(a.title, a.occurredAt, a.country);
    if (existingUrls.has(a.sourceUrl) || existingKeys.has(key)) {
      dupeInDb++;
      continue;
    }
    toInsert.push(a);
    // Grow the guard sets as we accept rows so a same-URL article that
    // surfaced under a different default-country across overlapping feeds (a
    // different title/date/country key, so it slipped the earlier key-only
    // in-batch dedupe) cannot be inserted twice in one run.
    existingUrls.add(a.sourceUrl);
    existingKeys.add(key);
  }

  // Report
  log("\n=== Per-feed ===");
  for (const f of FEEDS) {
    const s = perFeed[f.label];
    if (s.error) {
      log(`  ${f.label.padEnd(28)} ERROR: ${s.error}`);
    } else {
      log(`  ${f.label.padEnd(28)} found=${s.found.toString().padStart(3)}  accepted=${s.accepted.toString().padStart(3)}  rejected=${s.rejected.toString().padStart(3)}`);
    }
  }

  const countryCoverage = new Map<string, number>();
  for (const a of uniqueAccepted) {
    countryCoverage.set(a.country, (countryCoverage.get(a.country) ?? 0) + 1);
  }

  log("\n=== Totals ===");
  log(`  Feeds queried        : ${FEEDS.length}`);
  log(`  Feed errors          : ${feedErrors.length}`);
  log(`  Items found          : ${accepted.length + rejected.length}`);
  log(`  Accepted (raw)       : ${accepted.length}`);
  log(`  Accepted (unique)    : ${uniqueAccepted.length}`);
  log(`  Duplicate in DB      : ${dupeInDb}`);
  if (titleFilter) log(`  Excluded by filter   : ${filteredOut}`);
  log(`  New to insert        : ${toInsert.length}`);
  log(`  Rejected             : ${rejected.length}`);

  log("\n=== Country coverage (unique accepted) ===");
  const sortedCov = [...countryCoverage.entries()].sort((a, b) => b[1] - a[1]);
  for (const [c, n] of sortedCov) log(`  ${c.padEnd(22)} ${n}`);
  if (sortedCov.length === 0) log("  (none)");

  const summaryBase = {
    topic: "shipping" as const,
    mode: (commit ? "commit" : "dry-run") as IngestSummary["mode"],
    sourcesFetched: FEEDS.length,
    itemsConsidered: accepted.length + rejected.length,
    acceptedRaw: accepted.length,
    acceptedUnique: uniqueAccepted.length,
    duplicateInDb: dupeInDb,
    newToInsert: toInsert.length,
    rejected: rejected.length,
    perFeed: FEEDS.map((f) => perFeed[f.label]),
    countryCoverage: sortedCov,
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

  let geocoded = 0;
  const ungeocoded: string[] = [];
  const rows: (typeof incidentsTable.$inferInsert)[] = toInsert.map((a) => {
    const geo = geocode(a.country, `${a.title} ${a.summary}`);
    if (geo) geocoded++;
    else ungeocoded.push(`${a.country} — ${a.title.slice(0, 80)}`);
    const rel = evaluateIncidentRelevance("shipping", {
      topic: "shipping",
      title: a.title,
      summary: a.summary,
      source: a.source,
      sourceUrl: a.sourceUrl,
      location: geo?.location ?? null,
    });
    return {
      topic: "shipping",
      title: a.title,
      summary: a.summary,
      country: a.country,
      location: geo?.location ?? null,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      occurredAt: a.occurredAt,
      severity: classifySeverity(a.title, a.summary, "shipping"),
      confidence: "low",
      source: a.source,
      sourceUrl: a.sourceUrl,
      analystNotes: `auto-scraped:${a.feedLabel}`,
      relevanceStatus: rel.status,
      relevanceScore: rel.score,
      relevanceReason: rel.reason,
      relevanceVersion: rel.version,
      relevanceEvaluatedAt: new Date(),
    };
  });

  log(`\nGeocoded ${geocoded}/${rows.length} new rows.`);
  if (ungeocoded.length > 0) {
    log(`  WARNING: ${ungeocoded.length} row(s) could not be geocoded (inserted without coordinates):`);
    for (const u of ungeocoded) log(`    - ${u}`);
  }

  await db.insert(incidentsTable).values(rows);
  const stats = await topicStats();
  log(`\nInserted ${rows.length} rows. shipping total now: ${stats.totalAfter}`);

  return { ...summaryBase, inserted: rows.length, ...stats, logLines };
}
