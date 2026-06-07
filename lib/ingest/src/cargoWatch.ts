import Parser from "rss-parser";
import { fetchFeed } from "./feedFetch";
import { db, incidentsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { cleanText, hasWord, parseDate } from "./text";
import { classifySeverity } from "./severity";
import { geocode } from "./geocode";
import { evaluateIncidentRelevance } from "@workspace/relevance";
import { isLlmAvailable, screenBatch } from "./translateScreen";
import { recordSourceHealth } from "./sourceHealth";
import type { FeedStat, IngestOptions, IngestSummary } from "./types";

// Cargo Watch ingest core.
//
// Queries Google News RSS for cargo-crime terms across org/ME/APAC feeds,
// classifies items, dedupes, and inserts with topic='cargo_watch'.
// Mirrors flashpoint.ts in structure.

type Feed = {
  label: string;
  url: string;
  group: "org" | "me" | "apac";
};

const TERMS = [
  "cargo theft",
  "truck hijacking",
  "warehouse theft",
  "container theft",
  "freight theft",
  "depot theft",
  "pilferage",
  "seal tampering",
];

const TERM_QUERY = TERMS.map((t) => `"${t}"`).join(" OR ");

function gnews(query: string): string {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

// Local-language Google News editions. These surface genuine in-scope cargo
// incidents the English edition never carries. Items are translated + screened by
// the LLM stage (see translateScreen.ts) instead of the regex classifier.
function gnewsLocale(query: string, hl: string, gl: string, ceid: string): string {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

type LocalFeed = { label: string; lang: string; url: string };

const LOCAL_FEEDS: LocalFeed[] = [
  {
    label: "Local · Bahasa",
    lang: "Indonesian",
    url: gnewsLocale(
      `("pencurian kargo" OR "pembajakan truk" OR "perampokan truk" OR "pencurian gudang" OR "pencurian kontainer" OR "pembobolan gudang")`,
      "id",
      "ID",
      "ID:id",
    ),
  },
  {
    label: "Local · Arabic",
    lang: "Arabic",
    url: gnewsLocale(
      `("سرقة شحنة" OR "سرقة بضائع" OR "سرقة مستودع" OR "سطو على شاحنة")`,
      "ar",
      "AE",
      "AE:ar",
    ),
  },
  {
    label: "Local · Thai",
    lang: "Thai",
    url: gnewsLocale(`("ขโมยสินค้า" OR "ปล้นรถบรรทุก" OR "โจรกรรมสินค้า")`, "th", "TH", "TH:th"),
  },
];

// Cap on the number of NEW (unseen) items screened per local feed per run. The LLM
// screen is the only paid step; deduping by URL before screening keeps steady-state
// runs cheap, and this caps the cost of the first cold run.
const MAX_SCREEN_PER_FEED = 50;

const ME_COUNTRIES = [
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Oman",
  "Bahrain",
  "Kuwait",
  "Jordan",
];

const APAC_COUNTRIES = [
  "Singapore",
  "Malaysia",
  "Indonesia",
  "Thailand",
  "Vietnam",
  "Philippines",
  "India",
  "Pakistan",
];

const ORG_QUERIES: { label: string; q: string }[] = [
  { label: "TAPA EMEA", q: `TAPA (${TERM_QUERY})` },
  { label: "TT Club", q: `"TT Club" (${TERM_QUERY})` },
  { label: "BSI Supply Chain", q: `BSI supply chain (cargo theft OR pilferage)` },
  { label: "Safety4Sea cargo", q: `site:safety4sea.com (cargo theft OR pilferage)` },
  { label: "IUMI cargo crime", q: `IUMI cargo (theft OR crime OR pilferage)` },
];

const FEEDS: Feed[] = [
  ...ORG_QUERIES.map((o): Feed => ({ label: o.label, url: gnews(o.q), group: "org" })),
  ...ME_COUNTRIES.map((c): Feed => ({
    label: `ME · ${c}`,
    url: gnews(`(${TERM_QUERY}) "${c}"`),
    group: "me",
  })),
  ...APAC_COUNTRIES.map((c): Feed => ({
    label: `APAC · ${c}`,
    url: gnews(`(${TERM_QUERY}) "${c}"`),
    group: "apac",
  })),
];

// Country alias map → canonical country name stored in DB.
const COUNTRY_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "UAE", aliases: ["uae", "united arab emirates", "emirates", "dubai", "abu dhabi", "sharjah", "ajman"] },
  { canonical: "Saudi Arabia", aliases: ["saudi arabia", "saudi", "ksa", "riyadh", "jeddah", "dammam"] },
  { canonical: "Qatar", aliases: ["qatar", "doha"] },
  { canonical: "Oman", aliases: ["oman", "muscat", "salalah"] },
  { canonical: "Bahrain", aliases: ["bahrain", "manama"] },
  { canonical: "Kuwait", aliases: ["kuwait"] },
  { canonical: "Jordan", aliases: ["jordan", "amman", "aqaba"] },
  { canonical: "Singapore", aliases: ["singapore"] },
  { canonical: "Malaysia", aliases: ["malaysia", "kuala lumpur", "penang", "johor", "port klang"] },
  { canonical: "Indonesia", aliases: ["indonesia", "indonesian", "jakarta", "surabaya", "tanjung priok", "soekarno-hatta"] },
  { canonical: "Thailand", aliases: ["thailand", "bangkok", "laem chabang"] },
  { canonical: "Vietnam", aliases: ["vietnam", "viet nam", "hanoi", "ho chi minh", "haiphong", "cai mep"] },
  { canonical: "Philippines", aliases: ["philippines", "manila", "cebu"] },
  { canonical: "India", aliases: ["india", "mumbai", "delhi", "chennai", "kolkata", "bengaluru", "nhava sheva"] },
  { canonical: "Pakistan", aliases: ["pakistan", "karachi", "lahore", "port qasim"] },
];

// Allowlist: at least one must hit in title+summary for the item to qualify.
const ALLOW = [
  "cargo theft",
  "cargo hijack",
  "cargo crime",
  "cargo pilferage",
  "cargo robbery",
  "truck hijack",
  "lorry hijack",
  "truck robbery",
  "lorry robbery",
  "warehouse theft",
  "warehouse robbery",
  "warehouse burglary",
  "warehouse break-in",
  "godown theft",
  "godown robbery",
  "godown pilferage",
  "depot theft",
  "depot robbery",
  "depot pilferage",
  "seal tamper",
  "tampered seal",
  "container theft",
  "container pilferage",
  "freight theft",
  "freight robbery",
  "freight pilferage",
  "shipment hijack",
  "shipment stolen",
  "shipment theft",
  "shipment pilferage",
  "consignment stolen",
  "consignment theft",
  "consignment pilferage",
  "supply chain theft",
  "supply chain pilferage",
  "logistics theft",
  "logistics crime",
];

// Denylist: if any hit, reject even if allowlist matched.
const DENY = [
  // Maritime / kinetic — handled in Shipping/Strikes, not Cargo Watch.
  "houthi",
  "missile",
  "drone attack",
  "ballistic",
  "naval",
  "warship",
  "vessel attack",
  "ship attack",
  "tanker attack",
  "tanker seizure",
  "vessel seizure",
  // Operational/commercial noise.
  "port congestion",
  "port delay",
  "freight rate",
  "shipping rate",
  "container rate",
  "joint venture",
  "acquires",
  "acquired by",
  "tariff",
  "trade deal",
  // Non-cargo "pilferage" contexts that derail the India/Pakistan signal.
  "power pilferage",
  "power theft",
  "electricity pilferage",
  "electricity theft",
  "coal pilferage",
  "coal theft",
  "fuel pilferage",
  "oil pilferage",
  "water pilferage",
  "water theft",
  "spectrum pilferage",
  "pilferage of resources",
  "pilferage of funds",
  "pilferage of public",
  "data pilferage",
  // Political / corruption framing, not logistics crime.
  "corruption case",
  "embezzlement",
  "ponzi",
  "money laundering",
];

type Classified = {
  kept: boolean;
  reason: string;
  country: string | null;
};

// Foreign-context terms: if these appear in the TITLE alongside our
// country match, the story is likely diaspora/overseas coverage,
// not an in-country incident.
const FOREIGN_CONTEXT = [
  "california", "canada", "united states", "u.s.", "usa",
  "united kingdom", "britain", "europe", "european", "germany",
  "mexico", "brazil", "south africa", "japan", "china",
];

function classify(title: string, summary: string): Classified {
  const hay = `${title}\n${summary}`.toLowerCase();
  const titleLc = title.toLowerCase();

  const denyHit = DENY.find((d) => hay.includes(d));
  if (denyHit) return { kept: false, reason: `deny:${denyHit}`, country: null };

  const allowHit = ALLOW.find((a) => hay.includes(a));
  if (!allowHit) return { kept: false, reason: "no-allowlist-match", country: null };

  // Country must appear in TITLE (word-bounded) to count as an in-country
  // incident. Summary-only matches produce too many diaspora/byline misfires.
  const countryMatch = COUNTRY_ALIASES.find((c) =>
    c.aliases.some((a) => hasWord(titleLc, a)),
  );
  if (!countryMatch) return { kept: false, reason: "no-country-in-title", country: null };

  // Reject if the title also frames the incident as occurring in a
  // non-scope country (e.g. "Indians arrested in California").
  const foreign = FOREIGN_CONTEXT.find((f) => hasWord(titleLc, f));
  if (foreign) return { kept: false, reason: `foreign-context:${foreign}`, country: null };

  return { kept: true, reason: `allow:${allowHit}`, country: countryMatch.canonical };
}

function dedupeKey(title: string, when: Date, country: string): string {
  return [
    title.trim().toLowerCase().slice(0, 200),
    when.toISOString().slice(0, 10),
    country.trim().toLowerCase(),
    "cargo_watch",
  ].join("||");
}

// Canonicalises an LLM-returned country name to the exact in-scope name used by
// the workbench scope sets (artifacts/workbench/src/lib/cargoAnalysis.ts) and the
// geocoder. Returns null for anything OUTSIDE the APAC + Middle East scope, which
// drops the item — so a translated incident can never widen the page's scope.
const SCOPE_CANON: Record<string, string> = {
  // Middle East
  uae: "UAE",
  "united arab emirates": "UAE",
  emirates: "UAE",
  "saudi arabia": "Saudi Arabia",
  saudi: "Saudi Arabia",
  ksa: "Saudi Arabia",
  qatar: "Qatar",
  oman: "Oman",
  bahrain: "Bahrain",
  kuwait: "Kuwait",
  jordan: "Jordan",
  iran: "Iran",
  iraq: "Iraq",
  yemen: "Yemen",
  israel: "Israel",
  lebanon: "Lebanon",
  syria: "Syria",
  // APAC
  singapore: "Singapore",
  malaysia: "Malaysia",
  indonesia: "Indonesia",
  thailand: "Thailand",
  vietnam: "Vietnam",
  "viet nam": "Vietnam",
  philippines: "Philippines",
  cambodia: "Cambodia",
  laos: "Laos",
  myanmar: "Myanmar",
  burma: "Myanmar",
  india: "India",
  pakistan: "Pakistan",
  bangladesh: "Bangladesh",
  "sri lanka": "Sri Lanka",
  china: "China",
  "hong kong": "China",
  taiwan: "Taiwan",
  "south korea": "South Korea",
  korea: "South Korea",
  "republic of korea": "South Korea",
  japan: "Japan",
  australia: "Australia",
  "new zealand": "New Zealand",
  "papua new guinea": "Papua New Guinea",
};

export function canonScopeCountry(raw: string | null): string | null {
  if (!raw) return null;
  return SCOPE_CANON[raw.trim().toLowerCase()] ?? null;
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
    FROM incidents WHERE topic='cargo_watch'
  `);
  const row = res.rows[0] as { count: number; latest: Date | string | null; updated: Date | string | null } | undefined;
  const latest = row?.latest ? new Date(row.latest).toISOString().slice(0, 10) : null;
  const updated = row?.updated ? new Date(row.updated).toISOString() : null;
  return { totalAfter: row?.count ?? 0, latestRecord: latest, lastUpdated: updated };
}

/**
 * Run the Cargo Watch ingest. Returns a structured summary. Does NOT close
 * the shared DB pool — see runFlashpointIngest for the rationale.
 */
export async function runCargoWatchIngest(opts: IngestOptions = {}): Promise<IngestSummary> {
  const commit = opts.commit ?? false;
  const titleFilter = opts.titleFilter ? opts.titleFilter.toLowerCase() : null;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);
  log(`Cargo Watch scraper — ${FEEDS.length} feeds, mode=${commit ? "COMMIT" : "DRY-RUN"}${titleFilter ? `, title filter="${titleFilter}"` : ""}`);

  const parser = new Parser({
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench CargoWatchScraper)" },
  });

  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  const feedErrors: { feed: string; error: string }[] = [];
  const perFeed: Record<string, FeedStat> = {};

  // DB dedupe set is built up-front: the local-language stage uses existingUrls to
  // skip already-ingested items BEFORE spending an LLM call on them.
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
    if (row.topic !== "cargo_watch") continue;
    existingKeys.add(dedupeKey(row.title, row.occurredAt, row.country));
    if (row.sourceUrl) existingUrls.add(row.sourceUrl);
  }

  // Bounded concurrency: sequential fetching at 20s-per-feed can exceed
  // two minutes. Processing is order-independent.
  const CONCURRENCY = 4;
  const processFeed = async (feed: (typeof FEEDS)[number]) => {
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

        const c = classify(title, summary);
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
  const dbg = (s: string) => {
    if (process.env.CARGO_DEBUG) process.stderr.write(`[cargo ${new Date().toISOString().slice(11, 19)}] ${s}\n`);
  };
  dbg(`existing cargo rows: urls=${existingUrls.size}`);
  dbg(`english feeds starting (${FEEDS.length})`);
  for (let i = 0; i < FEEDS.length; i += CONCURRENCY) {
    await Promise.allSettled(FEEDS.slice(i, i + CONCURRENCY).map(processFeed));
    dbg(`english batch done ${Math.min(i + CONCURRENCY, FEEDS.length)}/${FEEDS.length}`);
  }
  dbg(`english accepted=${accepted.length}`);

  // Local-language stage. Each candidate is translated + screened by the LLM, then
  // its country is canonicalised to the in-scope set. If the LLM integration is
  // unavailable the stage is skipped entirely — the English pipeline is unaffected.
  const llmReady = isLlmAvailable();
  if (!llmReady) {
    log("\nLocal-language feeds skipped: OpenAI integration not configured.");
  } else {
    const localSeen = new Set<string>();
    const processLocalFeed = async (feed: LocalFeed) => {
      perFeed[feed.label] = { name: feed.label, found: 0, accepted: 0, rejected: 0 };
      dbg(`local "${feed.label}" fetching`);
      let parsed;
      try {
        parsed = await fetchFeed(parser, feed.url, { stagger: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        feedErrors.push({ feed: feed.label, error: msg });
        perFeed[feed.label].error = msg;
        return;
      }
      const items = parsed.items ?? [];
      perFeed[feed.label].found = items.length;

      // Collect NEW (unseen) candidates only, so the LLM screen never pays to
      // re-read items already in the DB or already seen this run.
      type Candidate = { headline: string; summary: string; when: Date; link: string; sourceName: string };
      const candidates: Candidate[] = [];
      for (const item of items) {
        const rawTitle = cleanText(item.title);
        const summary = cleanText(item.contentSnippet || item.content || "");
        const when = parseDate(item.isoDate || item.pubDate);
        const link = item.link?.trim();
        if (!rawTitle || !when || !link) {
          rejected.push({ title: rawTitle || "(no title)", reason: "missing-required-field", feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }
        if (existingUrls.has(link) || localSeen.has(link)) {
          perFeed[feed.label].rejected++;
          continue;
        }
        localSeen.add(link);
        const dashIdx = rawTitle.lastIndexOf(" - ");
        const sourceName = dashIdx > 0 ? rawTitle.slice(dashIdx + 3).trim() : (parsed.title ?? feed.label);
        const headline = dashIdx > 0 ? rawTitle.slice(0, dashIdx).trim() : rawTitle;
        candidates.push({ headline, summary, when, link, sourceName });
        if (candidates.length >= MAX_SCREEN_PER_FEED) break;
      }

      dbg(`local "${feed.label}" found=${items.length} screening=${candidates.length}`);
      const verdicts = await screenBatch(
        candidates.map((c) => ({ title: c.headline, summary: c.summary })),
        { concurrency: 4 },
      );
      dbg(`local "${feed.label}" screened`);

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const v = verdicts[i];
        if (!v.ok) {
          rejected.push({ title: c.headline, reason: `llm-error:${v.error}`, feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }
        const ver = v.verdict;
        if (!ver.inScope) {
          rejected.push({ title: c.headline, reason: `slop:${ver.reason}`.slice(0, 140), feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }
        const country = canonScopeCountry(ver.country);
        if (!country) {
          rejected.push({ title: c.headline, reason: `out-of-scope-country:${ver.country ?? "?"}`, feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }
        const titleEn = (ver.titleEn || c.headline).slice(0, 500);
        // Append the LLM-extracted city to the summary so the geocoder can place
        // the incident at city level rather than only the country centroid.
        const summaryEn = [ver.summaryEn || titleEn, ver.city ? `Location: ${ver.city}.` : ""].join(" ").trim();
        accepted.push({
          title: titleEn,
          summary: summaryEn,
          country,
          occurredAt: c.when,
          source: c.sourceName.slice(0, 200),
          sourceUrl: c.link,
          feedLabel: feed.label,
          reason: `llm:${ver.reason}`.slice(0, 200),
        });
        perFeed[feed.label].accepted++;
      }
    };
    // Sequential: each feed screens at its own internal concurrency. Running the
    // feeds one at a time keeps the combined request burst gentle on the LLM
    // proxy (the Retry-After backoff still covers transient throttling).
    for (const feed of LOCAL_FEEDS) {
      await processLocalFeed(feed);
    }
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

  const toInsert: Accepted[] = [];
  let dupeInDb = 0;
  let filteredOut = 0;
  for (const a of uniqueAccepted) {
    if (titleFilter && !a.title.toLowerCase().includes(titleFilter)) {
      filteredOut++;
      continue;
    }
    if (existingUrls.has(a.sourceUrl) || existingKeys.has(dedupeKey(a.title, a.occurredAt, a.country))) {
      dupeInDb++;
      continue;
    }
    toInsert.push(a);
  }

  // Report
  const allFeedLabels = [...FEEDS.map((f) => f.label), ...(llmReady ? LOCAL_FEEDS.map((f) => f.label) : [])];
  const totalFeeds = allFeedLabels.length;
  log("\n=== Per-feed ===");
  for (const label of allFeedLabels) {
    const s = perFeed[label];
    if (!s) continue;
    if (s.error) {
      log(`  ${label.padEnd(28)} ERROR: ${s.error}`);
    } else {
      log(`  ${label.padEnd(28)} found=${s.found.toString().padStart(3)}  accepted=${s.accepted.toString().padStart(3)}  rejected=${s.rejected.toString().padStart(3)}`);
    }
  }

  const countryCoverage = new Map<string, number>();
  for (const a of uniqueAccepted) {
    countryCoverage.set(a.country, (countryCoverage.get(a.country) ?? 0) + 1);
  }

  log("\n=== Totals ===");
  log(`  Feeds queried        : ${totalFeeds}`);
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

  if (process.env.CARGO_DEBUG) {
    const localLabels = new Set(LOCAL_FEEDS.map((f) => f.label));
    const localAccepted = uniqueAccepted.filter((a) => localLabels.has(a.feedLabel));
    process.stderr.write(`\n[cargo] === ACCEPTED local samples (${localAccepted.length}) ===\n`);
    for (const a of localAccepted) {
      process.stderr.write(
        `[cargo] (${a.feedLabel.replace("Local · ", "")}) [${a.country}] ${a.title}\n        ${a.reason}\n`,
      );
    }
    const localRej = rejected.filter((r) => localLabels.has(r.feedLabel));
    process.stderr.write(`\n[cargo] === REJECTED local samples (first 20 of ${localRej.length}) ===\n`);
    for (const r of localRej.slice(0, 20)) {
      process.stderr.write(`[cargo] ${r.reason} — ${r.title.slice(0, 90)}\n`);
    }
  }

  if (commit) {
    const healthFeeds = [
      ...FEEDS.map((f) => ({ name: f.label, url: f.url })),
      ...(llmReady ? LOCAL_FEEDS.map((f) => ({ name: f.label, url: f.url })) : []),
    ].map((f) => ({
      ...f,
      ok: !perFeed[f.name]?.error,
      error: perFeed[f.name]?.error ?? null,
    }));
    await recordSourceHealth("cargo_watch", healthFeeds, {
      sourceType: "rss",
      reliability: 3,
      notes: "Live cargo-theft news feed — auto-monitored each ingest run.",
    });
  }

  const summaryBase = {
    topic: "cargo_watch" as const,
    mode: (commit ? "commit" : "dry-run") as IngestSummary["mode"],
    sourcesFetched: totalFeeds,
    itemsConsidered: accepted.length + rejected.length,
    acceptedRaw: accepted.length,
    acceptedUnique: uniqueAccepted.length,
    duplicateInDb: dupeInDb,
    newToInsert: toInsert.length,
    rejected: rejected.length,
    perFeed: allFeedLabels.map((label) => perFeed[label]).filter(Boolean),
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
    const rel = evaluateIncidentRelevance("cargo_watch", {
      topic: "cargo_watch",
      title: a.title,
      summary: a.summary,
      source: a.source,
      sourceUrl: a.sourceUrl,
      location: geo?.location ?? null,
    });
    return {
      topic: "cargo_watch",
      title: a.title,
      summary: a.summary,
      country: a.country,
      location: geo?.location ?? null,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      occurredAt: a.occurredAt,
      severity: classifySeverity(a.title, a.summary, "cargo_watch"),
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
  log(`\nInserted ${rows.length} rows. cargo_watch total now: ${stats.totalAfter}`);

  return { ...summaryBase, inserted: rows.length, ...stats, logLines };
}
