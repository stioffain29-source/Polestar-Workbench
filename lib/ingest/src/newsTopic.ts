import Parser from "rss-parser";
import { fetchFeed } from "./feedFetch";
import { db, incidentsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { cleanText, hasWord, parseDate } from "./text";
import { classifySeverity, type SeverityTopic } from "./severity";
import { geocode } from "./geocode";
import { evaluateIncidentRelevance } from "@workspace/relevance";
import { recordSourceHealth } from "./sourceHealth";
import type { FeedStat, IngestOptions, IngestSummary } from "./types";

// Generic Google-News topic ingest.
//
// energy, fertiliser and fuel were import-only — no live source kept them
// current, so those monitors froze at the last manual import. This module is a
// config-driven generalisation of the shipping scraper: each topic supplies its
// feeds, allow/deny lists and country aliases, and the shared runner classifies,
// dedupes, geocodes and inserts with the correct topic. The allow/deny lists are
// aligned to each topic's REQUIRED rule in @workspace/relevance so accepted items
// pass the central relevance gate; each row still carries the persisted relevance
// verdict so any item that slips the keyword filter is dropped by the API/monitor
// via relevance_status.
//
// It deliberately does NOT close the shared DB pool — see runFlashpointIngest.

export type CountryAlias = { canonical: string; aliases: string[] };

export type TopicFeed = {
  label: string;
  q: string;
  defaultCountry: string;
  /**
   * Google News edition for this feed. Country feeds MUST set this to the
   * country's own edition (e.g. India -> gl=IN, ceid=IN:en) — the default
   * US edition pulls US-local distribution faults (Duke Energy outages,
   * county feeder trips, "outage tracker" SEO pages) that loosely match a
   * quoted country name and then get mis-stamped with the feed's default
   * country. A per-country edition pulls that country's own grid news.
   */
  gl?: string;
  hl?: string;
  ceid?: string;
  /**
   * A DIRECT outlet RSS URL. When set, the Google-News query builder (`q` /
   * gl / hl / ceid) is bypassed entirely and this URL is fetched verbatim.
   * Direct-outlet feeds carry a clean headline with NO trailing
   * " - Publisher" masthead, so the runner does not split the title; the
   * source name comes from the feed channel title (falling back to
   * `sourceName`, then the feed label). `q` may be left empty for such feeds.
   */
  directUrl?: string;
  /**
   * Preferred display source name for a DIRECT feed, used only when the feed's
   * RSS channel title is absent. Never fabricated for Google-News feeds.
   */
  sourceName?: string;
};

export type NewsTopicConfig = {
  topic: SeverityTopic;
  /** Google News queries; each becomes one RSS feed. */
  feeds: TopicFeed[];
  /** At least one must appear in title+summary for the item to qualify. */
  allow: string[];
  /** If any appears, reject even when the allowlist matched. */
  deny: string[];
  /** Alias → canonical country map. Order matters (specific before broad). */
  countryAliases: CountryAlias[];
  /**
   * Optional source-based confidence tiering. When set, each inserted row's
   * confidence is derived from its publisher name; when omitted the row keeps
   * the conservative "low" default unchanged. OPT-IN so existing commodity
   * topics (energy / fertiliser / fuel) are not affected.
   */
  classifyConfidence?: (source: string) => "low" | "medium" | "high";
};

export function gnews(
  query: string,
  edition?: { gl?: string; hl?: string; ceid?: string },
): string {
  const q = encodeURIComponent(query);
  const hl = encodeURIComponent(edition?.hl ?? "en-US");
  const gl = encodeURIComponent(edition?.gl ?? "US");
  const ceid = encodeURIComponent(edition?.ceid ?? "US:en");
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

type Feed = TopicFeed & { url: string };

export type Classified = { kept: boolean; reason: string; country: string | null };

export function detectCountry(hay: string, aliases: CountryAlias[]): string | null {
  const match = aliases.find((c) => c.aliases.some((a) => hasWord(hay, a)));
  return match ? match.canonical : null;
}

// Remove the publisher masthead from text before COUNTRY detection. Google News
// repeats the source name into the RSS summary, so a cross-border story from
// "The Times of India" about strikes "inside Pakistan" carries the token "india"
// from the masthead — and because detectCountry returns the first alias-ordered
// match (India is listed before Pakistan), the publisher's country wrongly wins
// over the event's. Stripping the masthead as a CONTIGUOUS phrase removes only
// the publisher occurrence; a genuine in-body country mention is untouched. A
// no-op when the source name is empty or absent from the text.
export function stripSourceMasthead(hay: string, sourceName: string): string {
  const masthead = sourceName.toLowerCase().trim();
  if (!masthead) return hay;
  return hay.split(masthead).join(" ");
}

// Countries OUTSIDE every monitor's Asia / Gulf / Oceania footprint. A
// country-edition Google-News feed routinely cross-syndicates a foreign story
// that names NO in-region country (e.g. a Libyan "libyaupdate.com" fuel story
// surfacing in the Pakistan edition). The old code then blind-stamped it with
// the feed's defaultCountry and the geocoder dropped it on that country's
// centroid — a Libya story tagged Pakistan, a Cuba blackout tagged Indonesia.
// When the text names no in-region country AND a foreign signal appears in the
// title/summary (word match) or the source name/domain (substring), reject the
// row rather than mis-stamp it. Deliberately omits turkey / russia / europe-as-
// single-token where they collide with legitimate Middle East coverage; europe/
// european is kept because the failing rows were literally European jet-fuel
// stories stamped Philippines and no in-region Gulf alias overlaps it.
const OUT_OF_REGION: { token: string; canonical: string }[] = [
  // Africa
  { token: "libya", canonical: "Libya" },
  { token: "egypt", canonical: "Egypt" },
  { token: "nigeria", canonical: "Nigeria" },
  { token: "niger", canonical: "Niger" },
  { token: "sudan", canonical: "Sudan" },
  { token: "algeria", canonical: "Algeria" },
  { token: "morocco", canonical: "Morocco" },
  { token: "tunisia", canonical: "Tunisia" },
  { token: "ethiopia", canonical: "Ethiopia" },
  { token: "kenya", canonical: "Kenya" },
  { token: "ghana", canonical: "Ghana" },
  { token: "somalia", canonical: "Somalia" },
  { token: "angola", canonical: "Angola" },
  { token: "zambia", canonical: "Zambia" },
  { token: "zimbabwe", canonical: "Zimbabwe" },
  { token: "uganda", canonical: "Uganda" },
  { token: "tanzania", canonical: "Tanzania" },
  { token: "cameroon", canonical: "Cameroon" },
  { token: "senegal", canonical: "Senegal" },
  { token: "mozambique", canonical: "Mozambique" },
  { token: "south africa", canonical: "South Africa" },
  // Americas
  { token: "cuba", canonical: "Cuba" },
  { token: "venezuela", canonical: "Venezuela" },
  { token: "colombia", canonical: "Colombia" },
  { token: "brazil", canonical: "Brazil" },
  { token: "argentina", canonical: "Argentina" },
  { token: "mexico", canonical: "Mexico" },
  { token: "texas", canonical: "United States" },
  { token: "american", canonical: "United States" },
  // Europe
  { token: "france", canonical: "France" },
  { token: "germany", canonical: "Germany" },
  { token: "spain", canonical: "Spain" },
  { token: "italy", canonical: "Italy" },
  { token: "britain", canonical: "United Kingdom" },
  { token: "england", canonical: "United Kingdom" },
  { token: "ireland", canonical: "Ireland" },
  { token: "europe", canonical: "Europe" },
  { token: "european", canonical: "Europe" },
];

// Source-domain fragments that betray a foreign publisher even when the text
// names no country. Substring-matched against the source name + host because a
// masthead like "libyaupdate.com" has no word boundary around "libya". ".vn" is
// the Vietnamese state portal (source "Vietnam.vn") cross-syndicating Bahasa
// world/forest-fire stories into the indonesia_local feed; gated on !detected so
// a vietnam.vn item genuinely naming a tracked country is still kept.
const OUT_OF_REGION_DOMAIN = [".uk", ".eg", ".ly", ".ng", ".za", ".vn"];

function detectOutOfRegion(textHay: string, sourceHay: string): string | null {
  for (const { token, canonical } of OUT_OF_REGION) {
    if (hasWord(textHay, token) || sourceHay.includes(token)) return canonical;
  }
  if (OUT_OF_REGION_DOMAIN.some((d) => sourceHay.includes(d))) return "Foreign";
  return null;
}

function classify(
  title: string,
  summary: string,
  feed: Feed,
  cfg: NewsTopicConfig,
  sourceName = "",
  host = "",
): Classified {
  const hay = `${title}\n${summary}`.toLowerCase();

  const denyHit = cfg.deny.find((d) => hay.includes(d));
  if (denyHit) return { kept: false, reason: `deny:${denyHit}`, country: null };

  const allowHit = cfg.allow.find((a) => hay.includes(a));
  if (!allowHit) return { kept: false, reason: "no-allowlist-match", country: null };

  // Land-based incidents are usually in the feed's country, so accept a country
  // match anywhere in title+summary then fall back to the per-feed default. Strip
  // the publisher masthead FIRST so a source name (e.g. "The Times of India",
  // repeated into the summary by Google News) cannot stamp the wrong country on a
  // cross-border event ("strikes ... inside Pakistan" must resolve to Pakistan,
  // not India).
  const geoHay = stripSourceMasthead(hay, sourceName);
  const detected = detectCountry(geoHay, cfg.countryAliases);

  // No in-region country in the text means we are about to blind-trust the
  // feed's defaultCountry. Before doing so, reject obvious cross-syndicated
  // foreign stories so they are not mis-stamped onto an in-region centroid.
  if (!detected) {
    const foreign = detectOutOfRegion(geoHay, `${sourceName} ${host}`.toLowerCase());
    if (foreign) return { kept: false, reason: `out-of-region:${foreign}`, country: null };
  }

  const country = detected ?? feed.defaultCountry;

  return { kept: true, reason: `allow:${allowHit}`, country };
}

/**
 * Test/diagnostic wrapper around the internal ingest `classify` gate. Runs the
 * REAL allow/deny + country/out-of-region logic a given `NewsTopicConfig` uses
 * during ingest, without needing a live feed. Kept thin so unit tests lock the
 * exact production classification and catch drift when the allow/deny lists in
 * `topicConfigs.ts` change.
 */
export function classifyNewsItem(
  cfg: NewsTopicConfig,
  title: string,
  summary = "",
  opts: { sourceName?: string; host?: string; defaultCountry?: string } = {},
): Classified {
  const feed: Feed = {
    label: "test",
    q: "",
    defaultCountry: opts.defaultCountry ?? "Unknown",
    url: "",
  };
  return classify(title, summary, feed, cfg, opts.sourceName ?? "", opts.host ?? "");
}

function dedupeKey(title: string, when: Date, country: string, topic: string): string {
  return [
    title.trim().toLowerCase().slice(0, 200),
    when.toISOString().slice(0, 10),
    country.trim().toLowerCase(),
    topic,
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

type Rejected = { title: string; reason: string; feedLabel: string };

async function topicStats(
  topic: string,
): Promise<{ totalAfter: number; latestRecord: string | null; lastUpdated: string | null }> {
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS count,
           MAX(occurred_at) AS latest,
           MAX(created_at)  AS updated
    FROM incidents WHERE topic = ${topic}
  `);
  const row = res.rows[0] as
    | { count: number; latest: Date | string | null; updated: Date | string | null }
    | undefined;
  const latest = row?.latest ? new Date(row.latest).toISOString().slice(0, 10) : null;
  const updated = row?.updated ? new Date(row.updated).toISOString() : null;
  return { totalAfter: row?.count ?? 0, latestRecord: latest, lastUpdated: updated };
}

/**
 * Run a config-driven Google-News topic ingest. Returns a structured summary.
 * Does NOT close the shared DB pool.
 */
export async function runNewsTopicIngest(
  cfg: NewsTopicConfig,
  opts: IngestOptions = {},
): Promise<IngestSummary> {
  const commit = opts.commit ?? false;
  const titleFilter = opts.titleFilter ? opts.titleFilter.toLowerCase() : null;
  const topic = cfg.topic;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);

  const FEEDS: Feed[] = cfg.feeds.map((f) => ({
    ...f,
    // A DIRECT outlet feed supplies its own RSS URL verbatim; only a Google
    // News feed goes through the query builder.
    url: f.directUrl ?? gnews(f.q, { gl: f.gl, hl: f.hl, ceid: f.ceid }),
  }));
  log(
    `${topic} scraper — ${FEEDS.length} feeds, mode=${commit ? "COMMIT" : "DRY-RUN"}${
      titleFilter ? `, title filter="${titleFilter}"` : ""
    }`,
  );

  const parser = new Parser({
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench TopicScraper)" },
  });

  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  const feedErrors: { feed: string; error: string }[] = [];
  const perFeed: Record<string, FeedStat> = {};

  const CONCURRENCY = 2;
  const processFeed = async (feed: Feed) => {
    perFeed[feed.label] = { name: feed.label, found: 0, accepted: 0, rejected: 0 };
    try {
      const parsed = await fetchFeed(parser, feed.url, { stagger: true });
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

        // A DIRECT outlet feed's headline has no trailing " - Publisher"
        // masthead, so the title is used verbatim and the source name is the
        // feed channel title (falling back to the configured name, then the
        // label). Google-News feeds keep the " - " masthead split.
        let sourceName: string;
        let cleanTitle: string;
        if (feed.directUrl) {
          cleanTitle = title;
          sourceName = feed.sourceName ?? parsed.title ?? feed.label;
        } else {
          const dashIdx = title.lastIndexOf(" - ");
          sourceName = dashIdx > 0 ? title.slice(dashIdx + 3).trim() : (parsed.title ?? feed.label);
          cleanTitle = dashIdx > 0 ? title.slice(0, dashIdx).trim() : title;
        }
        let host = "";
        try {
          host = new URL(link).hostname.replace(/^www\./, "");
        } catch {
          /* link may be a Google News redirect without a parseable host */
        }

        const c = classify(cleanTitle, summary, feed, cfg, sourceName, host);
        if (!c.kept || !c.country) {
          rejected.push({ title, reason: c.reason, feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }

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
    const k = dedupeKey(a.title, a.occurredAt, a.country, topic);
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueAccepted.push(a);
  }

  // DB dedupe against existing rows for this topic.
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
    if (row.topic !== topic) continue;
    existingKeys.add(dedupeKey(row.title, row.occurredAt, row.country, topic));
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
    const key = dedupeKey(a.title, a.occurredAt, a.country, topic);
    if (existingUrls.has(a.sourceUrl) || existingKeys.has(key)) {
      dupeInDb++;
      continue;
    }
    toInsert.push(a);
    // Grow the guard sets as we accept rows so the same article under a
    // different default-country across overlapping feeds cannot insert twice.
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
      log(
        `  ${f.label.padEnd(28)} found=${s.found.toString().padStart(3)}  accepted=${s.accepted
          .toString()
          .padStart(3)}  rejected=${s.rejected.toString().padStart(3)}`,
      );
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

  if (commit) {
    // Direct-outlet feeds and Google-News feeds coexist in one config, so the
    // registry name and collection method are derived PER FEED — a direct feed
    // reads "Direct RSS — <label>" with the "Direct outlet RSS" method, a
    // Google-News feed keeps its historical "Google News — <label>" name.
    const anyDirect = FEEDS.some((f) => f.directUrl);
    await recordSourceHealth(
      topic,
      FEEDS.map((f) => ({
        name: `${f.directUrl ? "Direct RSS" : "Google News"} — ${f.label}`,
        url: f.url,
        ok: !perFeed[f.label]?.error,
        error: perFeed[f.label]?.error ?? null,
        collected: perFeed[f.label]?.found,
        retained: perFeed[f.label]?.accepted,
        rejected: perFeed[f.label]?.rejected,
      })),
      {
        sourceType: "rss",
        reliability: 3,
        notes: anyDirect
          ? "Live direct outlet RSS feed — auto-monitored each ingest run."
          : "Live Google News feed — auto-monitored each ingest run.",
        scrapeMethod: anyDirect ? "Direct outlet RSS" : "Google News RSS",
      },
    );
  }

  const summaryBase = {
    topic,
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
    const stats = await topicStats(topic);
    return { ...summaryBase, inserted: 0, ...stats, logLines };
  }

  let geocoded = 0;
  const ungeocoded: string[] = [];
  const rows: (typeof incidentsTable.$inferInsert)[] = toInsert.map((a) => {
    const geo = geocode(a.country, `${a.title} ${a.summary}`);
    if (geo) geocoded++;
    else ungeocoded.push(`${a.country} — ${a.title.slice(0, 80)}`);
    const rel = evaluateIncidentRelevance(topic, {
      topic,
      title: a.title,
      summary: a.summary,
      source: a.source,
      sourceUrl: a.sourceUrl,
      location: geo?.location ?? null,
    });
    return {
      topic,
      title: a.title,
      summary: a.summary,
      country: a.country,
      location: geo?.location ?? null,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      occurredAt: a.occurredAt,
      severity: classifySeverity(a.title, a.summary, topic),
      confidence: cfg.classifyConfidence ? cfg.classifyConfidence(a.source) : "low",
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
  const stats = await topicStats(topic);
  log(`\nInserted ${rows.length} rows. ${topic} total now: ${stats.totalAfter}`);

  return { ...summaryBase, inserted: rows.length, ...stats, logLines };
}
