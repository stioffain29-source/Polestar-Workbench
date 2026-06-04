import Parser from "rss-parser";
import { db, incidentsTable, sourcesTable } from "@workspace/db";
import { sql, eq, or, gte, isNotNull } from "drizzle-orm";
import { cleanText, hasWord, parseDate } from "./text";
import { classifySeverity } from "./severity";
import { geocode } from "./geocode";
import { evaluateIncidentRelevance } from "@workspace/relevance";
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
  /\b(protest|demonstration|rally|march|sit[- ]in|strike|walkout|stoppage|riot|public disorder|looting|roadblock|road block|blockade|unrest|disorder|crackdown|clash)/i,
  /\b(curfew|state of emergency|martial law|lockdown imposed)/i,
  /\b(security forces?|police|military) .{0,30}(deployed|operation|clash|crackdown|tear[- ]?gas|baton|rubber bullet|water cannon|mass arrest)/i,
  /\b(students?|workers|farmers|union|opposition|civil society|teachers|chemists?|lawyers?) .{0,30}(protest|march|rally|strike|gather|walkout|boycott)/i,
];

// Deny list. Excludes kinetic armed-conflict, cargo-theft noise,
// commercial / market commentary and the live-blog / fluff patterns
// stripped by EXCLUDE_PHRASES in topicRelevance.ts. Order does not
// matter; a single hit rejects the item.
// FOREIGN kinetic signatures (drone/missile/air strikes, artillery, IEDs,
// car/suicide bombs, jihadist/terrorist attacks, quadcopters). These never
// describe Pacific (PNG / West Papua) communal or insurgent violence, so they
// are denied for EVERY country — including Pacific, where their presence
// instead signals mis-tagged foreign-conflict syndication.
const KINETIC_DENY_GLOBAL: RegExp =
  /\b(drone[- ]?strike|missile[- ]?strike|air[- ]?strike|airstrike|airborne attack|artillery (strike|shelling|fire)|\bshelling\b|\bied\b|bomb (attack|blast|kills|detonat)|suicide bomb|car bomb|jihadist|terror(ist)? attack|quadcopter)\b/i;

// INSURGENT / armed-group kinetic signatures (ambush, gun battle, gunmen /
// militants / insurgents kill-or-attack, armed-group raids, wanted
// commanders). Denied for the global APAC feed set so kinetic armed conflict
// (Myanmar, Mindanao, etc.) stays out of a protest/unrest tracker — BUT
// allowed when the resolved country is Pacific, because West Papua's TPNPB/OPM
// insurgency and PNG highlands armed clashes are explicitly IN scope (product
// owner: "include West Papua rebel/insurgent violence"). Applied in classify()
// AFTER country resolution, gated on isPacific.
const KINETIC_DENY_NONPACIFIC: RegExp =
  /\b(gunmen (kill|attack)|gun battle|gunbattle|militants? (kill|attack|target|ambush|raid|strike|fire)|insurgents? (kill|attack|target|ambush)|\bambush\b|armed group (attack|kill|raid)|terrorists? killed|wanted (commander|terrorist|ringleader))\b/i;

const FLASHPOINT_DENY: RegExp[] = [
  // Kinetic armed conflict — foreign signatures only (insurgent/armed-group
  // kinetic is handled conditionally in classify() so Pacific stays in scope).
  KINETIC_DENY_GLOBAL,
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
  // Sports-fixture noise: PNG's Post-Courier feed carries rugby-league match
  // previews whose "(amazing) round clash" trips the bare FLASHPOINT_REQUIRED
  // "clash" cue. These phrases are sports-only and never appear in genuine
  // crime/unrest incidents.
  /\b(rugby league|rugby union|\bnrl\b|digicel cup|premiership contention|grand final|kumuls|ladder leaders?|national football stadium)\b/i,
  // Football/rugby scoreline ("3-0 victory") and the "run riot over <team>"
  // idiom are sports-result framing, never a security incident. "run riot"
  // alone is NOT denied (genuine "youths run riot in town" unrest keeps it).
  /\b\d{1,2}-\d{1,2}\s+(?:victory|win|defeat|draw|loss|lead|triumph|thrashing)\b/i,
  /\brun riot over\b/i,
  /\bbox office\b/i,
  /\bcelebrity\b/i,
  /\bentertainment news\b/i,
  /\brecipe\b/i,
  // TV / documentary / trailer framing (e.g. "Tribal Conflict In PNG |
  // Vinnie Jones' Toughest Cops (Full Episode)") — not a live incident.
  /\b(full episode|toughest cops|docuseries|tv series|reality (show|series)|episode \d)\b/i,
  // YouTube-style video titles carry a random-case video id in parentheses
  // (e.g. "The Leafs Are Ready To Strike... Papua New Guinea (vFetqxZnwf)
  // - Mshale"). Matched by the lower->UPPER case transition that is the
  // video-id signature, so normal proper nouns like "(Highlands)" or
  // "(Bougainville)" are NOT denied. These are channel uploads, not reporting.
  /\([A-Za-z0-9_-]{0,14}[a-z][A-Z][A-Za-z0-9_-]{0,14}\)/,
];

// Pacific (PNG / West Papua) civilian crime & communal-violence cues.
// PNG's security signal is overwhelmingly violent CRIME (armed robbery,
// carjacking, raskol gangs, tribal fighting), which carries none of the
// protest/unrest cues in FLASHPOINT_REQUIRED and was therefore rejected.
// These cues are accepted ONLY when the resolved country is Pacific, so the
// global APAC feed set keeps its protest-only discipline (no worldwide
// routine-crime noise). Kinetic armed conflict is still excluded upstream
// by FLASHPOINT_DENY, which runs first.
// NOTE on scope discipline: cues here must be PHYSICAL-violence specific.
// Bare "attack"/"clash"/"violence" were tried and pulled false positives
// (a rugby "round clash", an MP's rhetorical "attack" in a debate, "violence
// against women" awareness campaigns), so attack/clash are kept QUALIFIED and
// bare "violence" is excluded. "kill(ed)", "raid", "wanted <person>", "mob
// <act>", "rebels/separatists" are the cues that capture the genuine PNG/West
// Papua incidents the global protest-only allowlist misses.
const PACIFIC_CRIME: RegExp =
  /\b(armed robbery|robbery|robbed|hold[- ]?up|carjack(?:ing|ed)?|home invasion|stabb(?:ed|ing)|machete attack|bush[- ]?knife|raskol|tribal (?:fight|clash|war|warfare|violence|conflict)|gang[- ]?(?:rape|violence|attack|war|fight|members?|shooting)|police raid|raid(?:ed|s)?|wanted (?:criminal|man|men|suspect|fugitive|offender)|shot dead|shooting|gunned down|opened fire|gun(?:point|fire|fight)|gun battle|firefight|kidnap(?:p?ed|ping)?|abduct(?:ion|ed)?|looting|murder(?:ed|s)?|manslaughter|kill(?:ed|ings?|s)?|fatalit(?:y|ies)|massacre|found dead|beaten to death|mob (?:attack|violence|justice|turns|sets|storms|burn|beat)|payback (?:killing|attack)|sorcery|riot(?:ing|s)?|arson|rebels?|separatists?|insurgen(?:t|ts|cy)|deadly clash|armed clash|violent clash)\b/i;

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
  /\b(papua new guinea|png|port moresby|lae|taraka|mount hagen|mt hagen|bougainville|enga|hela|highlands highway|madang|morobe|kokopo|goroka|wewak|kimbe|tari|pngdf|rpngc|marape|bismarck archipelago)\b/i;
const WEST_PAPUA_MARKERS =
  /\b(west papua|papua barat|jayapura|wamena|manokwari|sorong|merauke|nabire|timika|mimika|biak|fakfak|jayawijaya|free west papua|opm|tpnpb|papua pegunungan|papua tengah|papua selatan|papua barat daya|highland papua)\b/i;
const INDONESIA_CONTEXT = /\b(indonesia|indonesian|tni|polri|jakarta)\b/i;
// West Papua insurgency context. Per analyst direction, rebel / separatist
// violence in the Indonesian Papua theatre (West Papua militants vs the
// Indonesian military) is IN scope for the Papua country report. Bare
// "papua" alongside any of these resolves to West Papua even without an
// explicit province marker (e.g. "Rebels in Papua region kill 8").
const WP_INSURGENCY =
  /\b(rebels?|separatists?|insurgen(?:t|ts|cy)|opm|tpnpb|west papua national liberation|indonesian (?:military|soldiers?|troops?|forces?))\b/i;

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
  // Bare "papua" with Indonesian or insurgency context but no province
  // marker -> West Papua (Indonesian Papua theatre).
  if (/\bpapua\b/i.test(hay) && (INDONESIA_CONTEXT.test(hay) || WP_INSURGENCY.test(hay)))
    return "West Papua";
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

  const isPacific =
    country === "Papua New Guinea" ||
    country === "West Papua" ||
    country === "West Papua; Papua New Guinea";

  // Insurgent / armed-group kinetic conflict is denied everywhere EXCEPT the
  // Pacific (West Papua's TPNPB/OPM insurgency + PNG highlands armed clashes
  // are in scope). Must run AFTER country resolution so the gate can apply.
  if (!isPacific && KINETIC_DENY_NONPACIFIC.test(hay)) {
    return { kept: false, reason: "deny:kinetic-nonpacific", country: null };
  }

  const allowHit = FLASHPOINT_REQUIRED.find((re) => re.test(hay));
  if (allowHit) {
    if (!country) return { kept: false, reason: "no-apac-country", country: null };
    return { kept: true, reason: `allow:${allowHit.source.slice(0, 30)}`, country };
  }

  // No protest/unrest cue. Accept ONLY Pacific civilian crime & communal
  // violence (PNG's dominant security signal); every other country still
  // requires a FLASHPOINT_REQUIRED cue so the global feed set stays clean.
  if (isPacific && PACIFIC_CRIME.test(hay)) {
    return { kept: true, reason: "allow:pacific-crime", country };
  }

  return { kept: false, reason: country ? "no-flashpoint-cue" : "no-apac-country", country: null };
}

function dedupeKey(title: string, when: Date, country: string): string {
  return [
    title.trim().toLowerCase().slice(0, 200),
    when.toISOString().slice(0, 10),
    country.trim().toLowerCase(),
    "flashpoint",
  ].join("||");
}

const CASUALTY_WORD =
  /^(killed|kills|dead|deaths?|wounded|injured|fatalit(?:y|ies)|massacred?|slain)$/;

// Distinctive "event signature" trigrams of a headline used to recognise a
// SYNDICATED REHASH (an aggregator re-running an old event with a fresh date).
// We deliberately keep ONLY trigrams that carry a DIGIT *and* sit next to a
// casualty word (e.g. "15 killed in", "after 23 dead"). A bare casualty phrase
// ("two killed in clash") or a lone number is too generic and would risk
// rejecting genuine recurring incidents — precision matters more than recall
// here because a false positive permanently drops a real record at ingest.
function eventSignatureTrigrams(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/\s-\s[^-]*$/, "") // drop trailing " - Source" attribution
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 3 <= words.length; i++) {
    const tri = [words[i], words[i + 1], words[i + 2]];
    const hasDigit = tri.some((w) => /\d/.test(w));
    const hasCasualty = tri.some((w) => CASUALTY_WORD.test(w));
    if (hasDigit && hasCasualty) out.add(tri.join(" "));
  }
  return out;
}

function normCountry(c: string): string {
  return c.trim().toLowerCase();
}

// Minimum age gap for a match to count as a syndicated rehash (an aggregator
// re-running a months-old event with a fresh publication date) rather than
// genuine follow-up coverage of a current event.
const REHASH_MIN_AGE_MS = 45 * 24 * 60 * 60 * 1000;

// Maximum age gap. A genuine syndication recycle re-runs within a bounded
// window (weeks to a year or so). A shared casualty trigram against a record
// MORE than this far in the past is far more likely a DISTINCT recurring event
// than a recycle — e.g. PNG capital riots with "15 killed" occurred in
// Jan-2024 AND again Jun-2026; the generic "15 killed in" trigram collides
// 29 months apart even though they are unrelated events. Beyond this bound the
// candidate must NOT be treated as a rehash, or genuine current incidents are
// permanently dropped at ingest (the root cause of "the report is thin").
const REHASH_MAX_AGE_MS = 548 * 24 * 60 * 60 * 1000; // ~18 months

// Minimum title-token overlap (Jaccard, after stripping the trailing
// " - Source" attribution) for two items to count as the SAME recycled
// article rather than two different events that merely share a numeric
// casualty trigram. Two distinct PNG riot headlines ("declares state of
// emergency after 15 killed in riots" vs "vows crackdown after 15 killed in
// riots") score below this; a true recycle (near-identical headline) scores
// far above it.
const REHASH_MIN_TITLE_SIMILARITY = 0.6;

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/\s-\s[^-]*$/, "") // drop trailing " - Source" attribution
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
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
  // Event-signature index of existing flashpoint rows, so a freshly-dated
  // aggregator item that re-runs a months-old event ("15 killed in riots")
  // can be rejected instead of poisoning the rolling window with stale news.
  const existingSignatures: { ms: number; country: string; sig: Set<string>; title: string }[] = [];
  for (const row of existing) {
    if (row.sourceUrl) existingUrls.add(row.sourceUrl);
    if (row.topic === "flashpoint") {
      existingKeys.add(dedupeKey(row.title, row.occurredAt, row.country));
      const sig = eventSignatureTrigrams(row.title);
      if (sig.size > 0)
        existingSignatures.push({ ms: row.occurredAt.getTime(), country: normCountry(row.country), sig, title: row.title });
    }
  }

  // A candidate is a rehash only when ALL hold against a SAME-COUNTRY prior
  // row: (1) it shares a distinctive digit+casualty trigram, (2) the prior is
  // 45 days to ~18 months older — too recent is a genuine follow-up, too old
  // is a distinct recurring event, not a recycle — and (3) the two headlines
  // are substantially similar, so two different events that merely share a
  // numeric casualty count ("15 killed in") are not collapsed. Each guard
  // exists to stop a false positive permanently dropping a real record.
  const isSyndicatedRehash = (a: Accepted): boolean => {
    const sig = eventSignatureTrigrams(a.title);
    if (sig.size === 0) return false;
    const aMs = a.occurredAt.getTime();
    const aCountry = normCountry(a.country);
    for (const prior of existingSignatures) {
      if (prior.country !== aCountry) continue; // same country only
      const age = aMs - prior.ms;
      if (age < REHASH_MIN_AGE_MS) continue; // must be >=45d older
      if (age > REHASH_MAX_AGE_MS) continue; // too old: distinct recurring event
      let shares = false;
      for (const phrase of sig) {
        if (prior.sig.has(phrase)) {
          shares = true;
          break;
        }
      }
      if (!shares) continue;
      if (titleSimilarity(a.title, prior.title) < REHASH_MIN_TITLE_SIMILARITY) continue;
      return true;
    }
    return false;
  };

  const toInsert: Accepted[] = [];
  let dupeInDb = 0;
  let rehashSkipped = 0;
  for (const a of uniqueAccepted) {
    if (existingUrls.has(a.sourceUrl) || existingKeys.has(dedupeKey(a.title, a.occurredAt, a.country))) {
      dupeInDb++;
      continue;
    }
    if (isSyndicatedRehash(a)) {
      rehashSkipped++;
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
  log(`  Rehash skipped      : ${rehashSkipped}`);
  log(`  New to insert       : ${toInsert.length}`);
  log(`  Rejected            : ${rejected.length}`);

  // Diagnostic: dump rejected items (optionally filtered by substring) so we
  // can see WHY real events are being dropped. Gated on an env var so normal
  // runs stay quiet. FLASHPOINT_DEBUG_REJECTS=1 dumps all; set it to a
  // substring (e.g. "lae") to filter the title.
  const dbgRejects = process.env.FLASHPOINT_DEBUG_REJECTS;
  if (dbgRejects) {
    const needle = dbgRejects === "1" ? "" : dbgRejects.toLowerCase();
    log("\n=== Rejected (debug) ===");
    for (const r of rejected) {
      if (needle && !r.title.toLowerCase().includes(needle)) continue;
      log(`  [${r.reason}] ${r.title.slice(0, 110)}`);
    }
  }

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

  let geocoded = 0;
  const ungeocoded: string[] = [];
  const rows: (typeof incidentsTable.$inferInsert)[] = toInsert.map((a) => {
    const geo = geocode(a.country, `${a.title} ${a.summary}`);
    if (geo) geocoded++;
    else ungeocoded.push(`${a.country} — ${a.title.slice(0, 80)}`);
    const rel = evaluateIncidentRelevance("flashpoint", {
      topic: "flashpoint",
      title: a.title,
      summary: a.summary,
      source: a.source,
      sourceUrl: a.sourceUrl,
      location: geo?.location ?? null,
    });
    return {
      topic: "flashpoint",
      title: a.title,
      summary: a.summary,
      country: a.country,
      location: geo?.location ?? null,
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      occurredAt: a.occurredAt,
      severity: classifySeverity(a.title, a.summary, "flashpoint"),
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
  log(`\nInserted ${rows.length} rows. flashpoint total now: ${stats.totalAfter}`);

  return { ...summaryBase, inserted: rows.length, ...stats, logLines };
}
