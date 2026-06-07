import Parser from "rss-parser";
import { fetchFeed } from "./feedFetch";
import { db, strikesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { cleanText, hasWord, parseDate } from "./text";
import { geocode } from "./geocode";
import { recordSourceHealth } from "./sourceHealth";
import type { FeedStat } from "./types";

// Missile Strike Tracker live ingest.
//
// The strikes table (theatres land_gcc + maritime_hormuz) had NO live source —
// it was legacy-import/manual only, so it froze at the last hand entry. This
// module gives it a config-driven Google-News ingest mirroring newsTopic.ts,
// but it writes the strikes schema (munition / target / infrastructure /
// casualties / confidence) instead of the incidents table.
//
// Precision-first: a strict allow/deny gate keeps real kinetic events and drops
// the heavy surrounding noise (YouTube video junk, economic/markets commentary,
// diplomatic condemnations, procurement / arms-race / drone-delivery pieces,
// travel advisories, and out-of-theatre perpetrator stories). Casualties are
// recorded ONLY when an explicit death count is stated — never inferred.
//
// It deliberately does NOT close the shared DB pool — see runFlashpointIngest.

export type StrikeTheatre = "land_gcc" | "maritime_hormuz";

type StrikeFeed = {
  label: string;
  q: string;
  theatre: StrikeTheatre;
  defaultCountry: string;
};

export type StrikesIngestSummary = {
  mode: "commit" | "dry-run";
  sourcesFetched: number;
  itemsConsidered: number;
  acceptedRaw: number;
  acceptedUnique: number;
  duplicateInDb: number;
  newToInsert: number;
  inserted: number;
  rejected: number;
  totalAfter: number | null;
  latestRecord: string | null;
  lastUpdated: string | null;
  perFeed: FeedStat[];
  byTheatre: Array<[string, number]>;
  byCountry: Array<[string, number]>;
  logLines: string[];
};

function gnews(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

// Per-country land feeds keep the default country unambiguous; in-text detection
// then refines (an article in the Bahrain feed that names Kuwait is tagged
// Kuwait). The maritime feeds default to the waterway and detect the littoral
// state when one is named.
const STRIKE_FEEDS: StrikeFeed[] = [
  // --- Land: GCC ---
  {
    label: "Saudi Arabia strikes",
    theatre: "land_gcc",
    defaultCountry: "Saudi Arabia",
    q: `(drone OR missile OR ballistic OR "air defense" OR "air defence" OR interception OR projectile OR rocket OR airstrike OR "shot down") ("Saudi Arabia" OR Riyadh OR Jeddah OR Dammam OR Jizan OR Abha OR Najran) when:21d`,
  },
  {
    label: "UAE strikes",
    theatre: "land_gcc",
    defaultCountry: "United Arab Emirates",
    q: `(drone OR missile OR ballistic OR "air defense" OR interception OR projectile OR rocket OR airstrike OR "shot down") ("United Arab Emirates" OR UAE OR "Abu Dhabi" OR Dubai OR Fujairah OR Barakah) when:21d`,
  },
  {
    label: "Kuwait strikes",
    theatre: "land_gcc",
    defaultCountry: "Kuwait",
    q: `(drone OR missile OR ballistic OR "air defense" OR interception OR projectile OR rocket OR airstrike OR "shot down") (Kuwait OR "Kuwait City" OR Arifjan) when:21d`,
  },
  {
    label: "Bahrain strikes",
    theatre: "land_gcc",
    defaultCountry: "Bahrain",
    q: `(drone OR missile OR ballistic OR "air defense" OR interception OR projectile OR rocket OR airstrike OR "shot down") (Bahrain OR Manama) when:21d`,
  },
  {
    label: "Qatar strikes",
    theatre: "land_gcc",
    defaultCountry: "Qatar",
    q: `(drone OR missile OR ballistic OR "air defense" OR interception OR projectile OR rocket OR airstrike OR "shot down") (Qatar OR Doha OR "Al Udeid") when:21d`,
  },
  {
    label: "Oman strikes",
    theatre: "land_gcc",
    defaultCountry: "Oman",
    q: `(drone OR missile OR ballistic OR "air defense" OR interception OR projectile OR rocket OR airstrike OR "shot down") (Oman OR Muscat OR Salalah) when:21d`,
  },
  {
    label: "Jordan strikes",
    theatre: "land_gcc",
    defaultCountry: "Jordan",
    q: `(drone OR missile OR ballistic OR "air defense" OR interception OR projectile OR rocket OR airstrike OR "shot down") (Jordan OR Amman) when:21d`,
  },
  // --- Maritime: Strait of Hormuz / Gulf of Oman ---
  {
    label: "Hormuz vessel attacks",
    theatre: "maritime_hormuz",
    defaultCountry: "Strait of Hormuz",
    q: `(tanker OR vessel OR ship OR "cargo ship") (attack OR attacked OR drone OR missile OR mine OR limpet OR seized OR boarded OR struck OR explosion OR hijack) ("Strait of Hormuz" OR Hormuz OR "Gulf of Oman" OR "Persian Gulf") when:21d`,
  },
  {
    label: "Gulf vessel attacks",
    theatre: "maritime_hormuz",
    defaultCountry: "Strait of Hormuz",
    q: `(tanker OR vessel OR ship) (attack OR attacked OR drone OR missile OR mine OR limpet OR seized OR boarded OR struck OR hijack) (Iran OR Fujairah OR Oman OR "United Arab Emirates") when:21d`,
  },
];

// At least one kinetic / strike cue must appear, or the item is not an event.
const STRIKE_CUE =
  /\b(drone|uav|kamikaze|shahed|loitering munition|missile|ballistic|cruise|rocket|projectile|air ?strike|airstrike|shot down|struck|strike|barrage|shelling|intercept|limpet|mine|seized|boarded|hijack)\b/i;

// Reject when any of these appear — the recurring noise classes around real
// Gulf strike coverage. Verb patterns use a leading \b + stem (no trailing
// boundary) so inflections are caught too: /\bcondemn/ matches condemn,
// condemns, condemning, condemned, condemnation — the plural/participle leaks
// ("summons", "condemning") were the most common false accepts in the dry-run.
const STRIKE_DENY: RegExp[] = [
  // YouTube / video aggregator junk (id in trailing parens, e.g. "(lVmg7Ws6zh)").
  /\([A-Za-z0-9_-]{8,}\)\s*$/,
  /\byoutube\b/i,
  // Markets / economy commentary.
  /\b(bond|stocks?|stock market|property|real estate|dollar|crude|oil prices?|oil spikes?|investment|ipo|economy|gdp|inflation|merger)\b/i,
  // Diplomatic reactions, not events.
  /\b(condemn|denounce|summon|slam|solidarity|express\w* concern|calls? for|pledg|vows?\b)/i,
  // Procurement / industry / capability / deals, not strikes. No trailing \b:
  // it made plurals slip ("cope cages", "swarms").
  /\b(arms race|drone swarm|swarm|manufacturer|clone|venture|procure|procurement|acquire|acquisition|permit|integrat|iris-t|readiness|enhance|anti-?drone|drone shield|drone strateg|drone technology|drone training|drone academy|drone expertise|drone deal|satellite tech|drone deliver|medical deliver|medicine|exercise|drill|unveil|showcase|startup|arsenal|beef|cope cage|iron dome|anti-?missile batter|underwater drone|mou\b|memorandum|\blng\b|expansion|develop\w* (?:underwater|drone))/i,
  // Drugs / smuggling / ordinary crime — not strikes (no trailing \b so
  // "narcotics"/"drugs" are caught).
  /\b(narcotic|smuggl|trafficking|drug)/i,
  // Pilgrimage logistics.
  /\b(hajj|haj|umrah|pilgrim)\b/i,
  // Travel / aviation logistics syndication (airlines suspending/cancelling).
  /\b(travel advice|advice for travel|travel advisor|safe to travel|tourism|holiday|suspend\w* flights?|cancel\w* flights?|resume\w* flights?|airlines?|airways|flight chaos|airspace shutdown|re-?route)\b/i,
  // Explainers / speculation / opinion / debunks, not confirmed events.
  /\b(fact[- ]?check|debunk|false claim|misinformation|what is|explainer|explained|opinion|analysis:|fears|warns? against|threatens? to|could hit|may target|how to|go(?:es|ing)? ballistic)\b/i,
  // Space launches (the "rocket" homonym).
  /\b(rocket (?:launch|firm|test|explod)|launch pad|spacex|blue origin|new glenn?|space launch|paraglid)\b/i,
  // Out-of-theatre perpetrator / comparison / foreign-war stories — a Gulf
  // state named only as attacker elsewhere, or another theatre entirely. No
  // trailing \b so "Ukraine"/"Ukrainian" are caught.
  /\b(sudan|khartoum|nyala|ethiopia|ukrain|zaporizhzh|kharkiv|kyiv|russia|north korea|south korea|yellow sea|seoul|pyongyang|latvia|lithuania|estonia|poland|mali\b|gaza|west bank|florida|taiwan|chinese invasion|venezuela|somalia|nigeria)/i,
];

type CountryAlias = { canonical: string; aliases: string[] };

// GCC littoral + Iran. Order matters: a GCC target named alongside Iran (the
// usual attacker) resolves to the GCC country, never to Iran.
const COUNTRY_ALIASES: CountryAlias[] = [
  { canonical: "United Arab Emirates", aliases: ["uae", "united arab emirates", "abu dhabi", "dubai", "fujairah", "sharjah", "barakah"] },
  { canonical: "Saudi Arabia", aliases: ["saudi arabia", "saudi", "riyadh", "jeddah", "dammam", "jizan", "abha", "najran", "khamis mushait"] },
  { canonical: "Kuwait", aliases: ["kuwait city", "kuwait", "arifjan", "ali al salem"] },
  { canonical: "Bahrain", aliases: ["bahrain", "manama"] },
  { canonical: "Qatar", aliases: ["qatar", "doha", "al udeid", "al-udeid"] },
  { canonical: "Oman", aliases: ["oman", "muscat", "salalah"] },
  { canonical: "Jordan", aliases: ["jordan", "amman"] },
  { canonical: "Iran", aliases: ["iran", "iranian", "qeshm", "bandar abbas"] },
];

const GCC_COUNTRIES = new Set([
  "United Arab Emirates",
  "Saudi Arabia",
  "Kuwait",
  "Bahrain",
  "Qatar",
  "Oman",
  "Jordan",
]);

const MARITIME_COUNTRIES = new Set([
  "Iran",
  "Oman",
  "United Arab Emirates",
  "Saudi Arabia",
  "Bahrain",
  "Qatar",
  "Kuwait",
  "Strait of Hormuz",
]);

// Approximate centre of the Strait of Hormuz, for maritime rows that resolve to
// no littoral state.
const HORMUZ_CENTROID: [number, number] = [26.57, 56.25];

// Bounding box for the Middle East / Gulf theatre. Any geocode outside this box
// is a bad match (e.g. a foreign city named only in a source masthead) and must
// never set a strike's location. Generous enough to cover Jordan through Iran
// and the whole Arabian Gulf / Gulf of Oman / Red Sea, tight enough to exclude
// East Asia, Europe and the Americas.
function inGulfTheatre(lat: number, lng: number): boolean {
  return lat >= 8 && lat <= 42 && lng >= 30 && lng <= 66;
}

function detectCountry(hay: string): string | null {
  const match = COUNTRY_ALIASES.find((c) => c.aliases.some((a) => hasWord(hay, a)));
  return match ? match.canonical : null;
}

function classifyMunition(t: string): string {
  const hasDrone = /\b(drone|uav|kamikaze|shahed|loitering munition|quadcopter)\b/i.test(t);
  const hasBallistic = /\bballistic\b/i.test(t);
  const hasCruise = /\bcruise missile\b/i.test(t);
  const hasMissile = /\b(missile|rocket|projectile)\b/i.test(t);
  if (hasDrone && (hasMissile || hasBallistic || hasCruise)) return "mixed";
  if (hasBallistic) return "ballistic_missile";
  if (hasCruise) return "cruise_missile";
  if (hasDrone) return "drone";
  // An unspecified missile/rocket: the type is genuinely unknown.
  return "unknown";
}

function classifyTarget(t: string): string {
  if (/\b(airport|air terminal|aviation|airfield|terminal 1|terminal 2)\b/i.test(t)) return "airport_aviation";
  if (/\b(nuclear|reactor|power plant|power station|barakah|refinery|oil field|oilfield|pipeline|grid|substation)\b/i.test(t)) return "energy_infrastructure";
  if (/\b(air ?base|airbase|base|camp|military|troops|forces|installation|radar|defen[cs]e site|barracks)\b/i.test(t)) return "military_site";
  if (/\b(tanker|vessel|cargo ship|container ship|warship|frigate)\b/i.test(t)) return "vessel";
  if (/\b(port|harbour|harbor|jetty|dock|terminal)\b/i.test(t)) return "port_maritime";
  if (/\b(government|ministry|palace|parliament|presidential)\b/i.test(t)) return "government_facility";
  if (/\b(residential|neighbou?rhood|civilian|home|house|market|mall|school|hospital)\b/i.test(t)) return "civilian_area";
  return "unknown";
}

function classifyInfrastructure(t: string): string {
  if (/\b(airport|air terminal|aviation|airfield|terminal 1|terminal 2)\b/i.test(t)) return "airport";
  if (/\b(nuclear|reactor|power plant|power station|barakah|grid|substation)\b/i.test(t)) return "power";
  if (/\b(refinery|oil field|oilfield|pipeline|gas)\b/i.test(t)) return "oil_gas";
  if (/\b(air ?base|airbase|base|camp|military|radar|barracks|installation)\b/i.test(t)) return "military";
  if (/\b(port|harbour|harbor|jetty|dock)\b/i.test(t)) return "port";
  if (/\b(government|ministry|palace|parliament|presidential)\b/i.test(t)) return "government";
  if (/\b(residential|neighbou?rhood|home|house)\b/i.test(t)) return "civilian_residential";
  return "unknown";
}

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// Explicit death count only. Injuries are never counted, and a missing count
// yields null — we do not infer casualties.
function parseCasualties(t: string): number | null {
  const clamp = (n: number): number | null => (Number.isFinite(n) && n > 0 && n <= 10000 ? n : null);
  let m = t.match(/(\d+)\s+(?:people\s+)?(?:killed|dead|deaths|fatalities)\b/i);
  if (m) return clamp(parseInt(m[1]!, 10));
  // "killing 12", "kills 12" — the number must be DIRECTLY governed by a death
  // verb. "leaving" is deliberately excluded: "leaving 12 injured" is wounded,
  // not dead, and counting it would fabricate fatalities.
  m = t.match(/\b(?:killing|kills|killed)\s+(?:at least\s+)?(\d+)\b/i);
  if (m) return clamp(parseInt(m[1]!, 10));
  m = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people\s+)?(?:killed|dead)\b/i);
  if (m) return clamp(WORD_NUM[m[1]!.toLowerCase()] ?? 0);
  if (/\b(?:a person|one person|an? \w+ citizen|an? \w+ national)\s+(?:was\s+)?killed\b/i.test(t)) return 1;
  if (/\bkill(?:s|ed|ing)?\s+(?:one|a)\b/i.test(t)) return 1;
  return null;
}

const MAJOR_SOURCES = [
  "ap news", "associated press", "reuters", "bbc", "al jazeera", "the new york times",
  "wall street journal", "wsj", "cnbc", "afp", "france 24", "the national", "gulf news",
  "bloomberg", "pbs", "npr", "the telegraph", "euronews", "al-monitor", "al arabiya",
  "abc news", "cnn", "the guardian", "kyiv post", "anadolu",
];

function classifyConfidence(source: string): "low" | "medium" | "high" {
  const s = source.toLowerCase();
  return MAJOR_SOURCES.some((m) => s.includes(m)) ? "high" : "medium";
}

function clusterKey(theatre: string, country: string, munition: string, when: Date): string {
  return [theatre, country.toLowerCase(), munition, when.toISOString().slice(0, 10)].join("||");
}

type Accepted = {
  theatre: StrikeTheatre;
  country: string;
  munition: string;
  targetCategory: string;
  infrastructure: string;
  casualties: number | null;
  confidence: "low" | "medium" | "high";
  occurredAt: Date;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string;
  feedLabel: string;
};

type Rejected = { title: string; reason: string; feedLabel: string };

async function strikeStats(): Promise<{
  totalAfter: number;
  latestRecord: string | null;
  lastUpdated: string | null;
}> {
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS count,
           MAX(occurred_at) AS latest,
           MAX(created_at)  AS updated
    FROM strikes
  `);
  const row = res.rows[0] as
    | { count: number; latest: Date | string | null; updated: Date | string | null }
    | undefined;
  const latest = row?.latest ? new Date(row.latest).toISOString().slice(0, 10) : null;
  const updated = row?.updated ? new Date(row.updated).toISOString() : null;
  return { totalAfter: row?.count ?? 0, latestRecord: latest, lastUpdated: updated };
}

/**
 * Run the live Missile Strike Tracker ingest for both theatres. Returns a
 * structured summary. Does NOT close the shared DB pool.
 */
export async function runStrikesIngest(
  opts: { commit?: boolean } = {},
): Promise<StrikesIngestSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const log = (s: string) => logLines.push(s);

  log(`strikes scraper — ${STRIKE_FEEDS.length} feeds, mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  const parser = new Parser({
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0 (PolestarWorkbench StrikesScraper)" },
  });

  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  const feedErrors: { feed: string; error: string }[] = [];
  const perFeed: Record<string, FeedStat> = {};

  const processFeed = async (feed: StrikeFeed) => {
    perFeed[feed.label] = { name: feed.label, found: 0, accepted: 0, rejected: 0 };
    try {
      const parsed = await fetchFeed(parser, gnews(feed.q), { stagger: true });
      const items = parsed.items ?? [];
      perFeed[feed.label].found = items.length;
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

        const hay = `${rawTitle}\n${summary}`;

        const denyHit = STRIKE_DENY.find((re) => re.test(hay));
        if (denyHit) {
          rejected.push({ title: rawTitle, reason: `deny:${denyHit.source.slice(0, 24)}`, feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }
        if (!STRIKE_CUE.test(hay)) {
          rejected.push({ title: rawTitle, reason: "no-strike-cue", feedLabel: feed.label });
          perFeed[feed.label].rejected++;
          continue;
        }

        // Strip the trailing " - Source" Google News appends, so country
        // detection runs on the editorial headline only.
        const dashIdx = rawTitle.lastIndexOf(" - ");
        const sourceName = dashIdx > 0 ? rawTitle.slice(dashIdx + 3).trim() : (parsed.title ?? feed.label);
        const cleanTitle = dashIdx > 0 ? rawTitle.slice(0, dashIdx).trim() : rawTitle;
        const titleLc = cleanTitle.toLowerCase();
        const text = `${cleanTitle} ${summary}`;

        // TITLE-FIRST country detection. The dry-run showed that detecting from
        // the summary too lets the wrong country win — a Jordan/Ukraine/Korea
        // event surfaced in a Gulf feed gets stamped with whichever GCC name
        // happens to appear in the blurb. Requiring the country in the HEADLINE
        // is the single biggest precision lever.
        const detected = detectCountry(titleLc);
        let country: string;
        if (feed.theatre === "land_gcc") {
          // Land events must name a GCC state in the headline, full stop.
          if (!detected || !GCC_COUNTRIES.has(detected)) {
            rejected.push({ title: rawTitle, reason: "land-country-not-in-title", feedLabel: feed.label });
            perFeed[feed.label].rejected++;
            continue;
          }
          country = detected;
        } else {
          // Maritime headlines often name no country (just "the Gulf" / "a
          // tanker"), so fall back to the waterway — but only when the headline
          // actually carries a maritime cue, which filters out land stories that
          // merely mention a ship/vessel in passing.
          const maritimeCue =
            /\b(hormuz|gulf of oman|persian gulf|the gulf|strait|tanker|vessel|ship|cargo|freight|merchant|maritime|naval|warship|port|boarded|seized|hijack)\b/i.test(
              titleLc,
            );
          if (!maritimeCue) {
            rejected.push({ title: rawTitle, reason: "no-maritime-cue", feedLabel: feed.label });
            perFeed[feed.label].rejected++;
            continue;
          }
          country = detected && MARITIME_COUNTRIES.has(detected) ? detected : feed.defaultCountry;
        }

        accepted.push({
          theatre: feed.theatre,
          country,
          munition: classifyMunition(text),
          targetCategory: classifyTarget(text),
          infrastructure: classifyInfrastructure(text),
          casualties: parseCasualties(text),
          confidence: classifyConfidence(sourceName),
          occurredAt: when,
          title: cleanTitle.slice(0, 500),
          summary: (summary || cleanTitle).slice(0, 1000),
          source: sourceName.slice(0, 200),
          sourceUrl: link,
          feedLabel: feed.label,
        });
        perFeed[feed.label].accepted++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      feedErrors.push({ feed: feed.label, error: msg });
      perFeed[feed.label].error = msg;
    }
  };

  const CONCURRENCY = 2;
  for (let i = 0; i < STRIKE_FEEDS.length; i += CONCURRENCY) {
    await Promise.allSettled(STRIKE_FEEDS.slice(i, i + CONCURRENCY).map(processFeed));
  }

  // In-batch dedupe: collapse to ONE row per {theatre, country, munition, day},
  // keeping the highest-confidence / longest candidate. This deliberately
  // UNDER-counts when two genuinely distinct strikes share that bucket on the
  // same day — a conservative choice. Syndication of one event across outlets
  // (many rewritten headlines, many URLs) is the dominant duplicate class here,
  // and for this tracker inflating the strike count with near-duplicates is the
  // worse failure than occasionally merging two same-day same-munition events.
  const better = (a: Accepted, prev: Accepted): boolean =>
    (a.confidence === "high" && prev.confidence !== "high") ||
    (a.casualties != null && prev.casualties == null) ||
    a.summary.length > prev.summary.length;

  const byCluster = new Map<string, Accepted>();
  for (const a of accepted) {
    const k = clusterKey(a.theatre, a.country, a.munition, a.occurredAt);
    const prev = byCluster.get(k);
    if (!prev || better(a, prev)) byCluster.set(k, a);
  }
  const uniqueAccepted = [...byCluster.values()];

  // DB dedupe against existing strikes rows. A candidate is a duplicate if its
  // sourceUrl already exists, or it falls in a cluster ALREADY in the DB (a
  // syndicated copy from another outlet, or a re-run of an event a prior run
  // stored). Same cluster key as the in-batch step, so the two stages agree.
  const existing = await db
    .select({
      theatre: strikesTable.theatre,
      country: strikesTable.country,
      munition: strikesTable.munition,
      occurredAt: strikesTable.occurredAt,
      sourceUrl: strikesTable.sourceUrl,
    })
    .from(strikesTable);

  const existingKeys = new Set<string>();
  const existingUrls = new Set<string>();
  for (const row of existing) {
    existingKeys.add(clusterKey(row.theatre, row.country, row.munition, new Date(row.occurredAt)));
    if (row.sourceUrl) existingUrls.add(row.sourceUrl);
  }

  const toInsert: Accepted[] = [];
  let dupeInDb = 0;
  for (const a of uniqueAccepted) {
    const key = clusterKey(a.theatre, a.country, a.munition, a.occurredAt);
    if (existingUrls.has(a.sourceUrl) || existingKeys.has(key)) {
      dupeInDb++;
      continue;
    }
    toInsert.push(a);
    existingUrls.add(a.sourceUrl); // guard against the same URL twice in one run
  }

  // Report
  log("\n=== Per-feed ===");
  for (const f of STRIKE_FEEDS) {
    const s = perFeed[f.label];
    if (s.error) log(`  ${f.label.padEnd(24)} ERROR: ${s.error}`);
    else
      log(
        `  ${f.label.padEnd(24)} found=${s.found.toString().padStart(3)}  accepted=${s.accepted
          .toString()
          .padStart(3)}  rejected=${s.rejected.toString().padStart(3)}`,
      );
  }

  const byTheatre = new Map<string, number>();
  const byCountry = new Map<string, number>();
  for (const a of uniqueAccepted) {
    byTheatre.set(a.theatre, (byTheatre.get(a.theatre) ?? 0) + 1);
    byCountry.set(a.country, (byCountry.get(a.country) ?? 0) + 1);
  }
  const byTheatreArr = [...byTheatre.entries()].sort((a, b) => b[1] - a[1]);
  const byCountryArr = [...byCountry.entries()].sort((a, b) => b[1] - a[1]);

  log("\n=== Totals ===");
  log(`  Feeds queried        : ${STRIKE_FEEDS.length}`);
  log(`  Feed errors          : ${feedErrors.length}`);
  log(`  Items found          : ${accepted.length + rejected.length}`);
  log(`  Accepted (raw)       : ${accepted.length}`);
  log(`  Accepted (clustered) : ${uniqueAccepted.length}`);
  log(`  Duplicate in DB      : ${dupeInDb}`);
  log(`  New to insert        : ${toInsert.length}`);
  log(`  Rejected             : ${rejected.length}`);
  log("\n=== Theatre coverage (clustered) ===");
  for (const [t, n] of byTheatreArr) log(`  ${t.padEnd(18)} ${n}`);
  if (byTheatreArr.length === 0) log("  (none)");
  log("\n=== Country coverage (clustered) ===");
  for (const [c, n] of byCountryArr) log(`  ${c.padEnd(22)} ${n}`);
  if (byCountryArr.length === 0) log("  (none)");

  log("\n=== Sample accepted (clustered) ===");
  const sample = [...uniqueAccepted].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  for (const a of sample) {
    const d = a.occurredAt.toISOString().slice(0, 10);
    const cas = a.casualties != null ? `${a.casualties}d` : "-";
    log(`  ${d} ${a.country.padEnd(20)} ${a.munition.padEnd(17)} ${a.targetCategory.padEnd(20)} ${cas.padStart(4)}  ${a.title.slice(0, 90)}`);
  }

  if (commit) {
    await recordSourceHealth(
      "strikes",
      STRIKE_FEEDS.map((f) => ({
        name: f.label,
        url: gnews(f.q),
        ok: !perFeed[f.label]?.error,
        error: perFeed[f.label]?.error ?? null,
      })),
      { sourceType: "rss", reliability: 3, notes: "Live Google News strike-tracker feed — auto-monitored each ingest run." },
    );
  }

  const base = {
    mode: (commit ? "commit" : "dry-run") as StrikesIngestSummary["mode"],
    sourcesFetched: STRIKE_FEEDS.length,
    itemsConsidered: accepted.length + rejected.length,
    acceptedRaw: accepted.length,
    acceptedUnique: uniqueAccepted.length,
    duplicateInDb: dupeInDb,
    newToInsert: toInsert.length,
    rejected: rejected.length,
    perFeed: STRIKE_FEEDS.map((f) => perFeed[f.label]),
    byTheatre: byTheatreArr,
    byCountry: byCountryArr,
  };

  if (!commit) {
    log("\nDRY-RUN — no rows written. Re-run with --commit to insert.");
    return { ...base, inserted: 0, totalAfter: null, latestRecord: null, lastUpdated: null, logLines };
  }

  if (toInsert.length === 0) {
    log("\nNothing to insert.");
    const stats = await strikeStats();
    return { ...base, inserted: 0, ...stats, logLines };
  }

  let geocoded = 0;
  const rows: (typeof strikesTable.$inferInsert)[] = toInsert.map((a) => {
    const geo = geocode(a.country, `${a.title} ${a.summary}`);
    let latitude = geo?.latitude ?? null;
    let longitude = geo?.longitude ?? null;
    let location = geo?.location ?? null;
    // Hard in-theatre clamp. Both theatres are firmly Middle East / Gulf, so a
    // location outside that box is always a bad geocode — typically a foreign
    // place named only in the source masthead (e.g. "Taipei" from the byline
    // "Taipei Times"). Drop the bogus city rather than mis-mark the strike.
    if (latitude != null && longitude != null && !inGulfTheatre(latitude, longitude)) {
      latitude = null;
      longitude = null;
      location = null;
    }
    if (latitude == null) {
      if (a.theatre === "maritime_hormuz") {
        [latitude, longitude] = HORMUZ_CENTROID;
        location = "Strait of Hormuz";
      } else {
        const centroid = geocode(a.country, "");
        latitude = centroid?.latitude ?? null;
        longitude = centroid?.longitude ?? null;
        location = null;
      }
    }
    if (latitude != null) geocoded++;
    return {
      theatre: a.theatre,
      country: a.country,
      location,
      latitude,
      longitude,
      occurredAt: a.occurredAt,
      munition: a.munition,
      targetCategory: a.targetCategory,
      infrastructure: a.infrastructure,
      casualties: a.casualties,
      source: a.source,
      sourceUrl: a.sourceUrl,
      confidence: a.confidence,
      summary: a.summary,
      analystNotes: `auto-scraped:${a.feedLabel}`,
    };
  });

  log(`\nGeocoded ${geocoded}/${rows.length} new rows.`);

  await db.insert(strikesTable).values(rows);
  const stats = await strikeStats();
  log(`\nInserted ${rows.length} rows. strikes total now: ${stats.totalAfter}`);

  return { ...base, inserted: rows.length, ...stats, logLines };
}
