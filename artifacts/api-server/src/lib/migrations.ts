import { db, incidentsTable, reportsTable, countryReportsTable, countryBaselinesTable, sourcesTable } from "@workspace/db";
import { sql, eq, or, ne, isNull } from "drizzle-orm";
import { evaluateIncidentRelevance, RELEVANCE_RULE_VERSION } from "@workspace/relevance";
import { logger } from "./logger";
import { COUNTRY_BASELINE_SEEDS } from "./countryBaselineSeed";

// Catalogued Flashpoint regional sources that the audit identified as
// missing. Inserted idempotently on startup; existing rows are not
// touched. Keep the names stable — the scrape:flashpoint script joins on
// `name` to attribute records to a source row and to update
// last_success_at / last_failure_at.
const FLASHPOINT_REGIONAL_SOURCES: Array<{
  name: string;
  url: string;
  sourceType: string;
  reliability: number;
  notes: string;
}> = [
  // Direct publisher RSS, verified live from the Replit container.
  { name: "Malaysiakini",           url: "https://www.malaysiakini.com/rss/en/news.rss",            sourceType: "rss", reliability: 4, notes: "Owner: SE Asia desk. Malaysia — independent national, protest and labour coverage." },
  { name: "Free Malaysia Today",    url: "https://www.freemalaysiatoday.com/feed/",                 sourceType: "rss", reliability: 3, notes: "Owner: SE Asia desk. Malaysia — secondary national." },
  { name: "Khaosod English",        url: "https://www.khaosodenglish.com/feed/",                    sourceType: "rss", reliability: 4, notes: "Owner: SE Asia desk. Thailand — Bangkok protest and labour activity." },
  { name: "Prothom Alo English",    url: "https://en.prothomalo.com/feed/",                         sourceType: "rss", reliability: 4, notes: "Owner: South Asia desk. Bangladesh — largest national daily." },
  { name: "GMA News Online",        url: "https://data.gmanetwork.com/gno/rss/news/feed.xml",       sourceType: "rss", reliability: 4, notes: "Owner: PH desk. Philippines — major broadcaster, Metro Manila coverage." },
  { name: "Online Khabar English",  url: "https://english.onlinekhabar.com/feed",                   sourceType: "rss", reliability: 3, notes: "Owner: South Asia desk. Nepal — Kathmandu independent online." },
  // Google News country-targeted RSS. Used where direct publisher feeds
  // are gated, paywalled or return 404 from the Replit container. The
  // query string narrows to civil-unrest cues so the scraper's allowlist
  // can focus on relevance scoring. Reliable, stable URL pattern.
  { name: "Google News — Malaysia (Civil Unrest)",      url: "https://news.google.com/rss/search?q=%22Malaysia%22+protest+OR+strike+OR+rally+OR+demonstration&hl=en-MY&gl=MY&ceid=MY:en",   sourceType: "rss", reliability: 3, notes: "Owner: SE Asia desk. Country-wide civil unrest aggregator." },
  { name: "Google News — Sri Lanka (Civil Unrest)",     url: "https://news.google.com/rss/search?q=%22Sri+Lanka%22+protest+OR+strike+OR+rally+OR+demonstration&hl=en-LK&gl=LK&ceid=LK:en", sourceType: "rss", reliability: 3, notes: "Owner: South Asia desk. Country-wide civil unrest aggregator." },
  { name: "Google News — Thailand (Civil Unrest)",      url: "https://news.google.com/rss/search?q=%22Thailand%22+protest+OR+rally+OR+demonstration&hl=en-TH&gl=TH&ceid=TH:en",            sourceType: "rss", reliability: 3, notes: "Owner: SE Asia desk. Country-wide civil unrest aggregator." },
  { name: "Google News — Bangladesh (Civil Unrest)",    url: "https://news.google.com/rss/search?q=%22Bangladesh%22+protest+OR+strike+OR+rally+OR+hartal&hl=en-BD&gl=BD&ceid=BD:en",       sourceType: "rss", reliability: 3, notes: "Owner: South Asia desk. Country-wide civil unrest aggregator." },
  { name: "Google News — Indonesia (Civil Unrest)",     url: "https://news.google.com/rss/search?q=%22Indonesia%22+OR+%22Jakarta%22+protest+OR+rally+OR+demonstration&hl=en-ID&gl=ID&ceid=ID:en", sourceType: "rss", reliability: 3, notes: "Owner: SE Asia desk. Country and Jakarta civil unrest aggregator." },
  { name: "Google News — Philippines (Civil Unrest)",   url: "https://news.google.com/rss/search?q=%22Philippines%22+OR+%22Manila%22+protest+OR+rally+OR+strike&hl=en-PH&gl=PH&ceid=PH:en", sourceType: "rss", reliability: 3, notes: "Owner: PH desk. Country and Manila civil unrest aggregator." },
  { name: "Google News — Japan (Civil Unrest)",         url: "https://news.google.com/rss/search?q=%22Japan%22+OR+%22Tokyo%22+protest+OR+rally+OR+demonstration&hl=en-JP&gl=JP&ceid=JP:en", sourceType: "rss", reliability: 3, notes: "Owner: JP desk. Country and Tokyo civil unrest aggregator." },
  { name: "Google News — Nepal (Civil Unrest)",         url: "https://news.google.com/rss/search?q=%22Nepal%22+OR+%22Kathmandu%22+protest+OR+strike+OR+rally&hl=en-NP&gl=NP&ceid=NP:en",   sourceType: "rss", reliability: 3, notes: "Owner: South Asia desk. Country and Kathmandu civil unrest aggregator." },
  // when:14d constrains Google News to the last 14 days. Without it Google
  // returns a relevance-sorted mix spanning years, so genuine PNG incidents
  // arrive but never fall inside the report's rolling 7-day window. 14d (not
  // 7d) gives the scheduler a buffer between runs.
  { name: "Google News — Papua New Guinea (Crime & Security)", url: "https://news.google.com/rss/search?q=%22Papua+New+Guinea%22+(robbery+OR+carjacking+OR+raskol+OR+tribal+OR+ambush+OR+stabbed+OR+shot+OR+shooting+OR+killed+OR+murder+OR+violence+OR+assault+OR+kidnap+OR+rape+OR+mob+OR+sorcery)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. PNG violent-crime & communal-violence aggregator (armed robbery, carjacking, raskol gangs, tribal fighting, killings, mob/sorcery violence). Last 14 days." },
  { name: "Google News — Papua New Guinea (Civil Unrest)",    url: "https://news.google.com/rss/search?q=%22Papua+New+Guinea%22+(protest+OR+riot+OR+strike+OR+rally+OR+unrest+OR+looting+OR+roadblock)+when:14d&hl=en-PG&gl=PG&ceid=PG:en", sourceType: "rss", reliability: 3, notes: "Owner: Pacific desk. PNG country-wide civil unrest aggregator. Last 14 days." },
  // Pacific desk — Papua New Guinea and Indonesian West Papua wires. These
  // are the ONLY collection sources that feed the PNG and Papua country
  // reports; without them those reports have no live data on this
  // environment. Catalogued in the audit but previously only present in the
  // development database, so prod produced empty PNG/Papua reports until
  // seeded here.
  { name: "ABC News Australia",      url: "https://www.abc.net.au/news/feed/45910/rss.xml",                                 sourceType: "rss",  reliability: 4, notes: "Owner: ANZ desk. National broadcaster — protest, industrial action and policing across capitals." },
  { name: "Benar News",              url: "https://www.benarnews.org/english/rss2.xml",                                     sourceType: "rss",  reliability: 4, notes: "Owner: Asia desk. SE Asia regional desk — Philippines, Indonesia, Bangladesh." },
  { name: "Jubi.id (West Papua)",    url: "https://jubi.id/feed/",                                                          sourceType: "rss",  reliability: 3, notes: "Owner: Pacific desk. Jayapura / Indonesian Papua — community protest and security operations. Manual translation review required." },
  { name: "Post-Courier (PNG)",      url: "https://www.postcourier.com.pg/feed/",                                           sourceType: "rss",  reliability: 3, notes: "Owner: Pacific desk. Port Moresby — political demonstrations, sectoral strike action." },
  { name: "RNZ Pacific",             url: "https://www.rnz.co.nz/rss/pacific.xml",                                          sourceType: "rss",  reliability: 4, notes: "Owner: Pacific desk. Regional coverage for PNG, Solomons, Fiji and Indonesian Papua." },
  // Direct publisher RSS — regional national dailies and broadcasters.
  { name: "Daily Mirror Sri Lanka",  url: "http://www.dailymirror.lk/RSS_Feeds/news",                                       sourceType: "rss",  reliability: 4, notes: "Owner: South Asia desk. Sri Lanka — Colombo national daily." },
  { name: "Nepal Republica",         url: "https://myrepublica.nagariknetwork.com/feed/",                                   sourceType: "rss",  reliability: 3, notes: "Owner: South Asia desk. Secondary Nepal national — corroborates Kathmandu Post." },
  { name: "New Age Bangladesh",      url: "https://www.newagebd.net/rss.xml",                                               sourceType: "rss",  reliability: 3, notes: "Owner: South Asia desk. Bangladesh — labour and student coverage." },
  { name: "Sunday Times Sri Lanka",  url: "https://www.sundaytimes.lk/feed",                                                sourceType: "rss",  reliability: 3, notes: "Owner: South Asia desk. Sri Lanka — Colombo weekly, political coverage." },
  { name: "The Kathmandu Post",      url: "https://kathmandupost.com/rss",                                                  sourceType: "rss",  reliability: 4, notes: "Owner: South Asia desk. Kathmandu — political mobilisation, student unions, transport strikes." },
  { name: "Philippine Daily Inquirer", url: "https://www.inquirer.net/fullfeed",                                            sourceType: "rss",  reliability: 4, notes: "Owner: PH desk. National daily — city-disruption and protest calendaring across Metro Manila." },
  { name: "Rappler",                 url: "https://www.rappler.com/feed/",                                                  sourceType: "rss",  reliability: 4, notes: "Owner: PH desk. Manila protest activity, union calls, student mobilisation." },
  { name: "Prachatai English",       url: "https://prachatai.com/english/rss.xml",                                          sourceType: "rss",  reliability: 4, notes: "Owner: SE Asia desk. Thailand — civic-space, student mobilisation." },
  { name: "Tempo English",           url: "https://en.tempo.co/rss",                                                        sourceType: "rss",  reliability: 4, notes: "Owner: SE Asia desk. Indonesia — investigative weekly, civic-space coverage." },
  { name: "The Jakarta Post",        url: "https://www.thejakartapost.com/feed",                                            sourceType: "rss",  reliability: 4, notes: "Owner: SE Asia desk. Indonesia — Jakarta-Java national daily." },
  { name: "Kyodo News (English)",    url: "https://english.kyodonews.net/rss/news.xml",                                     sourceType: "rss",  reliability: 4, notes: "Owner: JP desk. Tokyo wire — labour disputes, civic protest and policing." },
  { name: "NHK World Japan",         url: "https://www3.nhk.or.jp/nhkworld/en/news/feeds/",                                 sourceType: "rss",  reliability: 4, notes: "Owner: JP desk. Japan — national broadcaster English wire." },
  { name: "The Japan Times",         url: "https://www.japantimes.co.jp/feed/",                                             sourceType: "rss",  reliability: 4, notes: "Owner: JP desk. National daily — Tokyo and Osaka mobilisation, union action." },
  // Thematic / cross-regional desks (civic-space, labour, education) and
  // wires. Several are non-RSS catalogue entries that fail to parse from the
  // container — retained so Source Health mirrors the verified development
  // catalogue and coverage warnings count the full source set.
  { name: "AFP Asia-Pacific",        url: "https://www.afp.com/en/news-hub",                                                sourceType: "news", reliability: 5, notes: "Owner: Asia desk. Secondary wire — corroborates Reuters and adds French-language coverage." },
  { name: "Reuters Asia Pacific Wire", url: "https://www.reuters.com/world/asia-pacific/",                                  sourceType: "news", reliability: 5, notes: "Owner: Asia desk. Primary wire for breaking protest, strike and security-force activity." },
  { name: "CIVICUS Monitor",         url: "https://monitor.civicus.org/api/",                                               sourceType: "api",  reliability: 5, notes: "Owner: Civic-space desk. Live tracker of assembly bans, detentions, internet shutdowns." },
  { name: "Human Rights Watch Asia", url: "https://www.hrw.org/asia",                                                       sourceType: "rss",  reliability: 4, notes: "Owner: Civic-space desk. Crackdown reporting, mass arrests, security-force conduct." },
  { name: "ITUC Global Rights Index", url: "https://www.ituc-csi.org/spip.php?page=backend",                                sourceType: "rss",  reliability: 4, notes: "Owner: Labour desk. International Trade Union Confederation — strike calls and labour-rights restrictions." },
  { name: "IndustriALL Global Union", url: "https://www.industriall-union.org/rss.xml",                                     sourceType: "rss",  reliability: 4, notes: "Owner: Labour desk. Sectoral union action (manufacturing, mining, energy)." },
  { name: "Education International APAC", url: "https://www.ei-ie.org/en/region/asia-pacific",                               sourceType: "rss",  reliability: 3, notes: "Owner: Education desk. Teacher and faculty mobilisation across APAC." },
  { name: "University World News Asia", url: "https://www.universityworldnews.com/region.php?region=Asia&format=rss",       sourceType: "rss",  reliability: 3, notes: "Owner: Education desk. Campus protests, student union activity, faculty walkouts." },
];

// Self-heal seed URLs on every startup. The seed loop below only inserts
// rows whose `name` is new; it never updates an existing row's URL. This
// block applies any URL corrections to already-inserted seed rows so the
// scraper picks up the fix without manual DB surgery. Idempotent — if the
// URL is already correct the UPDATE is a no-op.
async function repairFlashpointSeedUrls(): Promise<void> {
  for (const seed of FLASHPOINT_REGIONAL_SOURCES) {
    await db
      .update(sourcesTable)
      .set({ url: seed.url, sourceType: seed.sourceType, notes: seed.notes })
      .where(sql`${sourcesTable.name} = ${seed.name} AND (${sourcesTable.url} IS DISTINCT FROM ${seed.url})`);
  }
}

// Topics that must each have at least one report card in the Report Builder.
// Kept in sync with TOPIC_LABELS on the client.
const REQUIRED_TOPIC_REPORTS: Array<{
  topic: string;
  title: string;
}> = [
  { topic: "energy",      title: "APAC Energy Watch" },
  { topic: "fuel",        title: "APAC Fuel Watch" },
  { topic: "fertiliser",  title: "South Asia Fertiliser Watch" },
  { topic: "cargo_watch", title: "APAC Cargo Watch" },
  { topic: "shipping",    title: "Hormuz Maritime Watch" },
  { topic: "protests",    title: "APAC Flashpoint" },
];

// Reports that were previously auto-seeded but have since been retired.
// Removed on startup so they disappear from every environment without
// requiring manual deletion in the UI.
const RETIRED_REPORT_TITLES: string[] = [
  "Indo-Pacific Flashpoint Tracker",
  "APAC Fuel Theft & Diversion Outlook",
  "South Asia Fertiliser Supply Risk Brief",
  "APAC Cargo Theft & Hijack Monthly",
  "Weekly Energy Brief - GCC Grid Pressure",
  "Hormuz Maritime Threat Update",
  "PNG Election Cycle Risk Brief",
];

/**
 * Idempotent data migrations applied at startup.
 *
 * Each block detects an "old-data" marker and only runs if the migration has
 * not been applied yet, so it is safe to run repeatedly across deploys.
 */
export async function runDataMigrations(): Promise<void> {
  logger.info("runDataMigrations: starting");
  try {
    // 0) Country report narrative is now fully data-driven: the Situation,
    //    What Happened and Implications sections are generated from the live
    //    7-day window at render time and the stored overview / trend_summary
    //    / implications columns are no longer read anywhere. Legacy rows
    //    still hold pre-written prose that implied fresh weekly activity even
    //    when the window was empty, which would resurface in any older or
    //    cached build that still rendered the stored text. Wipe them at the
    //    source so no environment can ever serve the stale narrative again.
    //    Idempotent: only touches rows that still hold non-empty values.
    {
      const res = await db.execute(sql`
        UPDATE country_reports
        SET overview = '', trend_summary = '', implications = ''
        WHERE COALESCE(overview, '') <> ''
           OR COALESCE(trend_summary, '') <> ''
           OR COALESCE(implications, '') <> ''
      `);
      if (res.rowCount && res.rowCount > 0) {
        logger.info(
          { rows: res.rowCount },
          "Cleared stale stored country report narrative (overview/trend_summary/implications)",
        );
      }
    }

    // 1) Severity vocabulary: critical/elevated/moderate/low  →
    //    insignificant/low/moderate/high/extreme.
    //
    //    Detected by the presence of any row using the old terms
    //    'critical' or 'elevated', which do not exist in the new vocabulary.
    const [oldSev] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentsTable)
      .where(
        or(
          eq(incidentsTable.severity, "critical"),
          eq(incidentsTable.severity, "elevated"),
        ),
      );

    if ((oldSev?.n ?? 0) > 0) {
      logger.info({ rows: oldSev?.n }, "Migrating severity vocabulary");
      await db.execute(sql`
        UPDATE incidents SET severity = CASE severity
          WHEN 'critical' THEN 'extreme'
          WHEN 'elevated' THEN 'moderate'
          WHEN 'moderate' THEN 'low'
          WHEN 'low'      THEN 'insignificant'
          ELSE severity
        END
      `);
    }

    // 2) Fertiliser content was originally seeded under topic='flashpoint'.
    //    Move it to its own topic. Detected by absence of any fertiliser rows
    //    combined with the presence of the original fertiliser-themed titles
    //    still sitting under flashpoint.
    const [fertCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentsTable)
      .where(eq(incidentsTable.topic, "fertiliser"));

    if ((fertCount?.n ?? 0) === 0) {
      const res = await db.execute(sql`
        UPDATE incidents
        SET topic = 'fertiliser'
        WHERE topic = 'flashpoint'
          AND (
            title ILIKE '%urea%'
            OR title ILIKE '%phosphate%'
            OR title ILIKE '%fertiliser%'
            OR title ILIKE '%fertilizer%'
            OR title ILIKE '%potash%'
            OR title ILIKE '%DAP %'
          )
      `);
      if (res.rowCount && res.rowCount > 0) {
        logger.info({ rows: res.rowCount }, "Reclassified fertiliser incidents");
      }
    }
    // 3) Ensure every topic has at least one report card in the Report
    //    Builder. Idempotent: only inserts when no report exists for the
    //    topic, so re-runs and new environments self-heal without
    //    duplicating cards.
    // 3a) Remove any reports retired from the seed list, in every env.
    for (const retiredTitle of RETIRED_REPORT_TITLES) {
      try {
        const res = await db
          .delete(reportsTable)
          .where(eq(reportsTable.title, retiredTitle));
        if (res.rowCount && res.rowCount > 0) {
          logger.info({ title: retiredTitle, rows: res.rowCount }, "Removed retired report");
        }
      } catch (delErr) {
        logger.error({ err: delErr, title: retiredTitle }, "Failed to remove retired report");
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    logger.info({ count: REQUIRED_TOPIC_REPORTS.length }, "runDataMigrations: entering report seed loop");
    for (const seed of REQUIRED_TOPIC_REPORTS) {
      try {
        const [existing] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(reportsTable)
          .where(eq(reportsTable.title, seed.title));
        const n = existing?.n ?? 0;
        logger.info({ topic: seed.topic, title: seed.title, existing: n }, "runDataMigrations: report seed check");
        if (n === 0) {
          const inserted = await db
            .insert(reportsTable)
            .values({
              title: seed.title,
              topic: seed.topic,
              status: "draft",
              issueDate: today,
              author: "J. Sterling",
            })
            .returning({ id: reportsTable.id });
          logger.info({ topic: seed.topic, title: seed.title, id: inserted[0]?.id }, "Seeded missing topic report");
        }
      } catch (seedErr) {
        logger.error({ err: seedErr, topic: seed.topic }, "Failed to seed topic report");
      }
    }
    // 3b) ONE-TIME reset of legacy shipping report prose.
    //
    //     The Shipping preview/PDF render What Matters, Implications, Watch
    //     Next and Polestar View through the editor's pick(): saved prose is
    //     shown verbatim when present and not flagged stale, otherwise it
    //     falls back to the live Shipping dataset (buildShippingReportDataset
    //     → countryRows / chokepoint / vessel reads). Legacy rows still hold
    //     pre-written prose (e.g. a Polestar View naming "China and South
    //     Korea" while the live country chart shows Iran / Singapore), which
    //     made the Executive Summary, chart and Polestar View disagree.
    //
    //     Blank those four stored sections ONCE so the report falls back to
    //     the single live dataset and the three surfaces reconcile. This is
    //     marker-gated (NOT an every-boot wipe) so deliberate analyst edits
    //     made AFTER this reset are preserved across restarts. Bump the
    //     marker key if a future change ever requires re-resetting. We do
    //     NOT touch situation / what_happened — the shipping preview/PDF do
    //     not render them, so clearing them would be destructive for no gain.
    {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_migration_markers (
          key text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const markerKey = "shipping_prose_reset_v1";
      const existingMarker = await db.execute(sql`
        SELECT 1 FROM app_migration_markers WHERE key = ${markerKey}
      `);
      if ((existingMarker.rowCount ?? 0) === 0) {
        const res = await db.execute(sql`
          UPDATE reports
          SET what_matters = '', implications = '', polestar_view = '', watch_next = ''
          WHERE topic = 'shipping'
            AND (
                 COALESCE(what_matters, '')  <> ''
              OR COALESCE(implications, '')   <> ''
              OR COALESCE(polestar_view, '')  <> ''
              OR COALESCE(watch_next, '')     <> ''
            )
        `);
        await db.execute(sql`
          INSERT INTO app_migration_markers (key) VALUES (${markerKey})
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info(
          { rows: res.rowCount ?? 0, marker: markerKey },
          "One-time shipping report prose reset (now rendered from live dataset)",
        );
      }
    }
    // 4) Seed country baselines once. Maps each seed to a country
    //    report by case-insensitive name match. Skips any seed whose
    //    target slug already has a baseline so editor edits are never
    //    overwritten on restart.
    try {
      const countries = await db
        .select({ slug: countryReportsTable.slug, name: countryReportsTable.name })
        .from(countryReportsTable);
      const byName = new Map<string, string>();
      for (const c of countries) byName.set(c.name.trim().toLowerCase(), c.slug);

      for (const seed of COUNTRY_BASELINE_SEEDS) {
        let slug: string | undefined;
        for (const n of seed.countryNames) {
          const hit = byName.get(n.trim().toLowerCase());
          if (hit) { slug = hit; break; }
        }
        if (!slug) {
          logger.info({ names: seed.countryNames }, "baseline seed: no country report found, skipping");
          continue;
        }
        const [existing] = await db
          .select({ id: countryBaselinesTable.id })
          .from(countryBaselinesTable)
          .where(eq(countryBaselinesTable.slug, slug));
        if (existing) continue;
        await db.insert(countryBaselinesTable).values({
          slug,
          operatingEnvironment: seed.operatingEnvironment,
          securityContext: seed.securityContext,
          knownRiskAreas: seed.knownRiskAreas,
          keyCitiesProvinces: seed.keyCitiesProvinces,
          movementConstraints: seed.movementConstraints,
          infrastructureLimits: seed.infrastructureLimits,
          medicalEvac: seed.medicalEvac,
          resourceSectorExposure: seed.resourceSectorExposure,
          locationWatchlist: seed.locationWatchlist,
        });
        logger.info({ slug }, "Seeded country baseline");
      }
    } catch (baseErr) {
      logger.error({ err: baseErr }, "Country baseline seed failed");
    }

    // 5) Flashpoint topic-pollution cleanup. Idempotent: each pass operates
    //    on a narrow predicate, so re-running is a no-op once the rows are
    //    out of the flashpoint / protests bucket.
    //
    //    Source: attached_assets/flashpoint_data_coverage_audit.md.
    //    Audit found that 252 of 687 records under topic in (flashpoint,
    //    protests) were either kinetic armed-conflict, cargo-theft Google
    //    News records misrouted to protests, syndicated UAE drone-strike
    //    duplicates, or country-baseline watchlist rows surfacing as live
    //    incidents. Reassign to the correct topic where one fits, delete
    //    where the row never belonged in incidents at all, and de-duplicate
    //    by source_url so one syndicated story does not become 50 rows.
    try {
      const uae = await db.execute(sql`
        UPDATE incidents SET topic = 'strikes'
        WHERE topic IN ('flashpoint', 'protests')
          AND source = 'UAE Air-Defense / Missile Activity (Google News)'
      `);
      if (uae.rowCount && uae.rowCount > 0) {
        logger.info({ rows: uae.rowCount }, "flashpoint cleanup: moved UAE air-defense records to strikes");
      }

      const cargo = await db.execute(sql`
        UPDATE incidents SET topic = 'cargo_watch'
        WHERE topic IN ('flashpoint', 'protests')
          AND (
            source ~* '(cargo theft|truck.*theft|freight.*theft|trucking & transport|tobacco.*cargo|truck hijack)'
          )
      `);
      if (cargo.rowCount && cargo.rowCount > 0) {
        logger.info({ rows: cargo.rowCount }, "flashpoint cleanup: moved cargo-theft Google News records to cargo_watch");
      }

      // Kinetic armed conflict without a protest cue → strikes topic.
      // Mirrors the kineticHit / protestCue logic in
      // artifacts/workbench/src/lib/incidentClassifier.ts:127-135 so
      // upstream (this migration) and downstream (the report classifier)
      // agree on what counts as armed conflict vs public order.
      const kinetic = await db.execute(sql`
        UPDATE incidents SET topic = 'strikes'
        WHERE topic IN ('flashpoint', 'protests')
          AND (title || ' ' || summary) ~* '(drone[- ]?strike|missile[- ]?strike|air[- ]?strike|airstrike|gun battle|gunbattle|\yied\y|bomb (attack|blast|kills|detonat)|suicide bomb|car bomb|gunmen (kill|attack)|militants? (kill|attack|target|ambush|raid|strike|fire)|insurgents? (kill|attack|target|ambush)|terror(ist)? attack|armed group (attack|kill|raid)|terrorists? killed|security forces? kill|wanted (commander|terrorist|ringleader)|quadcopter)'
          AND (title || ' ' || summary) !~* '(protest|demonstration|rally|march|sit[- ]?in|riot|crackdown|curfew|tear[- ]?gas|water cannon|baton charge|student union|opposition (call|rally|march)|\ypti\y|imran khan|section ?144|assembly ban|detention of (protesters|activists|students))'
      `);
      if (kinetic.rowCount && kinetic.rowCount > 0) {
        logger.info({ rows: kinetic.rowCount }, "flashpoint cleanup: moved kinetic armed-conflict records to strikes");
      }

      // Legacy operational-risk-zone seed rows: location watchlist
      // entries inserted as incidents. Belong in country_baselines, not
      // here. Delete.
      const baselineLeak = await db.execute(sql`
        DELETE FROM incidents
        WHERE analyst_notes LIKE 'legacy:db:operational_risk_zones%'
      `);
      if (baselineLeak.rowCount && baselineLeak.rowCount > 0) {
        logger.info({ rows: baselineLeak.rowCount }, "flashpoint cleanup: deleted operational-risk-zone watchlist rows");
      }

      // De-duplicate by source_url (one syndicated story should never
      // become 10+ incidents). Keep the lowest id per URL.
      const deduped = await db.execute(sql`
        DELETE FROM incidents a USING incidents b
        WHERE a.source_url = b.source_url
          AND a.source_url IS NOT NULL
          AND a.source_url <> ''
          AND a.id > b.id
      `);
      if (deduped.rowCount && deduped.rowCount > 0) {
        logger.info({ rows: deduped.rowCount }, "flashpoint cleanup: removed duplicate-by-source_url rows");
      }
    } catch (cleanupErr) {
      logger.error({ err: cleanupErr }, "flashpoint cleanup migration failed");
    }

    // 6) Seed missing regional flashpoint sources. Idempotent on `name`.
    try {
      for (const seed of FLASHPOINT_REGIONAL_SOURCES) {
        const [existing] = await db
          .select({ id: sourcesTable.id })
          .from(sourcesTable)
          .where(eq(sourcesTable.name, seed.name));
        if (existing) continue;
        await db.insert(sourcesTable).values({
          name: seed.name,
          topic: "flashpoint",
          sourceType: seed.sourceType,
          url: seed.url,
          status: "operational",
          reliability: seed.reliability,
          manualReviewRequired: false,
          notes: seed.notes,
        });
        logger.info({ name: seed.name }, "Seeded flashpoint regional source");
      }
      await repairFlashpointSeedUrls();
    } catch (srcErr) {
      logger.error({ err: srcErr }, "Flashpoint regional source seed failed");
    }

    try {
      await backfillRelevance();
    } catch (relErr) {
      logger.error({ err: relErr }, "Relevance backfill failed");
    }

    logger.info("runDataMigrations: finished");
  } catch (err) {
    logger.error({ err }, "Data migration failed (continuing startup)");
  }
}

/**
 * Evaluate every incident whose stored relevance version is null or stale
 * against the shared @workspace/relevance engine and persist the verdict.
 * Runs on boot (dev + prod); re-runs only the rows that need it, so it is a
 * no-op once the DB is current. Bumping RELEVANCE_RULE_VERSION re-cleans the
 * whole table on the next boot. The API default-filter then hides the rows
 * marked 'irrelevant' across every read surface.
 */
async function backfillRelevance(): Promise<void> {
  const rows = await db
    .select({
      id: incidentsTable.id,
      topic: incidentsTable.topic,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      source: incidentsTable.source,
      sourceUrl: incidentsTable.sourceUrl,
      location: incidentsTable.location,
    })
    .from(incidentsTable)
    .where(
      or(
        isNull(incidentsTable.relevanceVersion),
        ne(incidentsTable.relevanceVersion, RELEVANCE_RULE_VERSION),
      ),
    );

  if (rows.length === 0) {
    logger.info("backfillRelevance: nothing to evaluate (DB current)");
    return;
  }

  const now = new Date();
  const perTopic = new Map<string, { relevant: number; irrelevant: number }>();
  let updated = 0;

  // Sequential UPDATEs keep memory flat and the advisory-free path simple;
  // this only does real work when the rule version changes.
  for (const r of rows) {
    const v = evaluateIncidentRelevance(r.topic, {
      topic: r.topic,
      title: r.title,
      summary: r.summary ?? "",
      source: r.source ?? "",
      sourceUrl: r.sourceUrl ?? "",
      location: r.location ?? null,
    });
    await db
      .update(incidentsTable)
      .set({
        relevanceStatus: v.status,
        relevanceScore: v.score,
        relevanceReason: v.reason,
        relevanceVersion: v.version,
        relevanceEvaluatedAt: now,
      })
      .where(eq(incidentsTable.id, r.id));
    updated++;
    const bucket = perTopic.get(r.topic) ?? { relevant: 0, irrelevant: 0 };
    if (v.relevant) bucket.relevant++;
    else bucket.irrelevant++;
    perTopic.set(r.topic, bucket);
  }

  logger.info(
    { updated, version: RELEVANCE_RULE_VERSION, perTopic: Object.fromEntries(perTopic) },
    "backfillRelevance: evaluated rows",
  );
}
