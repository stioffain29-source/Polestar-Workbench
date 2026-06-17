import { db, incidentsTable, incidentCorroborationsTable } from "@workspace/db";
import { and, eq, gte, isNull, or, lt, desc, inArray } from "drizzle-orm";
import { recordSourceHealth } from "./sourceHealth";

// ReliefWeb (UN OCHA) corroboration pass.
//
// This does NOT ingest new incidents. It cross-checks the incidents the
// workbench already scraped (from Google News feeds) against ReliefWeb — UN
// OCHA's authoritative humanitarian data service. When a published ReliefWeb
// report covers the SAME country, timeframe and event as one of our incidents,
// it is attached as an independent OFFICIAL corroborating reference (a separate
// signal — it never overwrites the incident's `confidence`).
//
// ReliefWeb's API is free and public (no API key). As of 1 November 2025 it
// decommissioned v1 and the v2 API requires a PRE-APPROVED `appname` (requested
// via ReliefWeb's short form; they email one back). The appname is an
// identifier, not a secret — supply it via the RELIEFWEB_APPNAME env var. Until
// an approved appname is configured the upstream returns 403 and the pass is a
// no-op (it records a failing source on Source Health rather than crashing the
// ingest cycle). We treat every byte of the upstream response as UNTRUSTED input
// and validate each field's shape before use. Like every other ingest module,
// this NEVER closes the shared DB pool — only the CLI wrapper does.

const RELIEFWEB_ENDPOINT = "https://api.reliefweb.int/v2/reports";
// Default placeholder; ReliefWeb rejects unapproved appnames with 403. Override
// with an approved value via RELIEFWEB_APPNAME.
const APPNAME_PLACEHOLDER = "polestar-advisory-workbench";
const APPNAME = process.env.RELIEFWEB_APPNAME?.trim() || APPNAME_PLACEHOLDER;

// Human-readable explanation surfaced on Source Health / the Integrations panel
// when the appname is missing or still the placeholder.
export const RELIEFWEB_NOT_CONFIGURED_MESSAGE =
  "RELIEFWEB_APPNAME not set to an approved value — corroboration disabled. " +
  "ReliefWeb's v2 API returns 403 without a pre-approved appname (request one at " +
  "https://apidoc.reliefweb.int/parameters#appname).";

/**
 * True only when an approved ReliefWeb appname is configured. The default
 * placeholder is rejected by the upstream (403), so it counts as unconfigured.
 */
export function isReliefWebConfigured(): boolean {
  const v = process.env.RELIEFWEB_APPNAME?.trim();
  return !!v && v !== APPNAME_PLACEHOLDER;
}

// A realistic desktop-browser User-Agent (mirrors feedFetch). Public APIs
// sometimes throttle library-default agents.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 20000;
const BASE_BACKOFF_MS = 2500;

// --- Tuning (all conservative) ------------------------------------------------
// Topics the corroboration concentrates in — humanitarian-relevant. These are
// the topics ReliefWeb is registered against on Source Health, and the only
// incident topics we bother matching (cargo/shipping/market rows rarely have a
// UN sitrep, and querying for them just burns API calls).
const HUMANITARIAN_TOPICS = [
  "conflict",
  "flashpoint",
  "energy",
  "fuel",
  "fertiliser",
] as const;
// How many incidents to examine per run (bounded so a back-fill never runs away).
const MAX_INCIDENTS_PER_RUN = 120;
// Re-check incidents this recent every run (official sitreps lag the news, so a
// fresh incident may only gain a ReliefWeb match days later)...
const RECENT_RECHECK_DAYS = 21;
// ...but no more than once per this interval, so repeated cold starts stay cheap.
const RECHECK_INTERVAL_HOURS = 18;
// Cap distinct country queries per run so one diverse batch can't fan out into
// dozens of upstream requests.
const MAX_COUNTRIES_PER_RUN = 25;
// Date window (days) each side of the incident for a candidate report to count.
const DATE_WINDOW_DAYS = 10;
// Minimum shared significant tokens between the incident text and the report
// title for the event to be considered the same (country + date alone is NOT
// enough — that would corroborate unrelated same-country events).
const MIN_SHARED_TOKENS = 2;
// Accept a candidate only at or above this combined score.
const MATCH_THRESHOLD = 0.5;
// At most this many corroborating links per incident (best-scoring first).
const MAX_LINKS_PER_INCIDENT = 3;
// Reports requested per country query.
const REPORTS_PER_COUNTRY = 200;

export type ReliefWebCorroborationSummary = {
  provider: "reliefweb";
  mode: "commit" | "dry-run";
  incidentsConsidered: number;
  countriesQueried: number;
  reportsFetched: number;
  /** Corroboration links inserted this run. */
  linksInserted: number;
  /** Distinct incidents that gained at least one link this run. */
  incidentsCorroborated: number;
  fetchOk: boolean;
  errors: string[];
  logLines: string[];
};

// --- Untrusted-response types -------------------------------------------------
type ReliefWebReport = {
  id: string;
  title: string;
  url: string;
  agency: string | null;
  date: Date | null;
  countries: string[];
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "over", "after", "amid", "near",
  "have", "has", "that", "this", "their", "there", "they", "than", "then",
  "will", "would", "could", "should", "been", "being", "more", "most", "some",
  "such", "what", "when", "where", "which", "while", "about", "against",
  "report", "reports", "update", "updates", "situation", "humanitarian",
  "response", "appeal", "flash", "snapshot", "bulletin", "office", "news",
  "people", "affected", "amid", "says", "said", "new", "two", "three",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Significant lowercase tokens (length >= 4, not a stopword). */
function tokenize(text: string, dropCountry: string): Set<string> {
  const countryTokens = new Set(
    dropCountry
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue;
    if (STOPWORDS.has(raw)) continue;
    if (countryTokens.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/** Defensive ISO-ish date parse; returns null on anything unparseable. */
function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Coerce upstream report JSON into our trusted shape, dropping malformed rows. */
function normaliseReport(raw: unknown): ReliefWebReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  const fields = r.fields;
  if (typeof id !== "string" && typeof id !== "number") return null;
  if (!fields || typeof fields !== "object") return null;
  const f = fields as Record<string, unknown>;
  const title = typeof f.title === "string" ? f.title.trim() : "";
  if (!title) return null;

  // Prefer the human-readable alias; fall back to the canonical node URL.
  let url = typeof f.url_alias === "string" ? f.url_alias : "";
  if (!url && typeof f.url === "string") url = f.url;
  if (!url) url = `https://reliefweb.int/node/${id}`;
  if (!/^https?:\/\//i.test(url)) return null;

  // Source/agency: first named source's shortname or name.
  let agency: string | null = null;
  if (Array.isArray(f.source) && f.source.length > 0) {
    const s = f.source[0];
    if (s && typeof s === "object") {
      const so = s as Record<string, unknown>;
      const name =
        (typeof so.shortname === "string" && so.shortname) ||
        (typeof so.name === "string" && so.name) ||
        null;
      agency = name ? String(name).slice(0, 200) : null;
    }
  }

  // Date: created (publication) is the most reliable; original if present.
  let date: Date | null = null;
  if (f.date && typeof f.date === "object") {
    const d = f.date as Record<string, unknown>;
    date = parseDate(d.original) ?? parseDate(d.created);
  }

  // Countries this report covers (for a defensive country re-check).
  const countries: string[] = [];
  if (Array.isArray(f.country)) {
    for (const c of f.country) {
      if (c && typeof c === "object") {
        const name = (c as Record<string, unknown>).name;
        if (typeof name === "string" && name.trim()) {
          countries.push(name.trim().toLowerCase());
        }
      }
    }
  }

  return { id: String(id), title: title.slice(0, 500), url, agency, date, countries };
}

/**
 * Query ReliefWeb for reports covering `country` within [from, to]. Returns a
 * validated list. Retries transient failures only (timeout / 429 / 5xx). Throws
 * on a permanent failure so the caller can record the source as failing.
 */
async function fetchReports(
  country: string,
  from: Date,
  to: Date,
): Promise<ReliefWebReport[]> {
  const body = {
    appname: APPNAME,
    filter: {
      operator: "AND",
      conditions: [
        { field: "country", value: country },
        {
          field: "date.created",
          value: { from: from.toISOString(), to: to.toISOString() },
        },
      ],
    },
    fields: {
      include: [
        "title",
        "url",
        "url_alias",
        "date.created",
        "date.original",
        "source.name",
        "source.shortname",
        "country.name",
      ],
    },
    sort: ["date.created:desc"],
    limit: REPORTS_PER_COUNTRY,
  };
  const url = `${RELIEFWEB_ENDPOINT}?appname=${encodeURIComponent(APPNAME)}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "User-Agent": BROWSER_UA,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
          redirect: "follow",
        });
      } catch (err) {
        // Abort (our timeout) + network errors are transient → retry.
        throw { transient: true, message: ctrl.signal.aborted ? `timed out after ${FETCH_TIMEOUT_MS}ms` : err instanceof Error ? err.message : String(err) };
      }
      if (!res.ok) {
        const transient = res.status === 429 || res.status >= 500;
        throw { transient, message: `status ${res.status}` };
      }
      const json: unknown = await res.json();
      const data =
        json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).data)
          ? ((json as Record<string, unknown>).data as unknown[])
          : [];
      const out: ReliefWebReport[] = [];
      for (const item of data) {
        const norm = normaliseReport(item);
        if (norm) out.push(norm);
      }
      return out;
    } catch (err) {
      lastErr = err;
      const transient = !!(err && typeof err === "object" && (err as { transient?: boolean }).transient);
      if (transient && attempt < FETCH_ATTEMPTS - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
      } else {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const msg =
    lastErr && typeof lastErr === "object" && "message" in lastErr
      ? String((lastErr as { message: unknown }).message)
      : String(lastErr);
  throw new Error(msg);
}

/** Primary country name for an incident (drops compound "A; B" + Unknown). */
function primaryCountry(country: string): string | null {
  const c = (country.split(";")[0] ?? country).trim();
  if (!c || /^unknown$/i.test(c)) return null;
  return c;
}

type Candidate = { report: ReliefWebReport; score: number };

/** Score one report against one incident. Returns null below the threshold. */
function scoreMatch(
  incidentText: string,
  occurredAt: Date,
  country: string,
  report: ReliefWebReport,
): Candidate | null {
  // Defensive country re-check (we filtered upstream, but never trust it).
  if (report.countries.length > 0 && !report.countries.includes(country.toLowerCase())) {
    return null;
  }
  if (!report.date) return null;
  const diffDays = Math.abs(report.date.getTime() - occurredAt.getTime()) / 86400000;
  if (diffDays > DATE_WINDOW_DAYS) return null;
  const dateScore = 1 - diffDays / DATE_WINDOW_DAYS;

  const incTokens = tokenize(incidentText, country);
  const repTokens = tokenize(report.title, country);
  if (repTokens.size === 0) return null;
  let shared = 0;
  for (const t of repTokens) if (incTokens.has(t)) shared++;
  if (shared < MIN_SHARED_TOKENS) return null;
  const overlapScore = Math.min(1, shared / 3);

  const score = 0.5 * overlapScore + 0.5 * dateScore;
  if (score < MATCH_THRESHOLD) return null;
  return { report, score };
}

/**
 * Run the ReliefWeb corroboration pass. Selects a bounded batch of incidents
 * (recent rows due a re-check + never-checked older rows), queries ReliefWeb per
 * country, scores candidates conservatively, and inserts corroboration links.
 * Returns a structured summary. Does NOT close the shared DB pool.
 */
export async function runReliefWebCorroboration(
  opts: { commit?: boolean } = {},
): Promise<ReliefWebCorroborationSummary> {
  const commit = opts.commit ?? false;
  const logLines: string[] = [];
  const errors: string[] = [];
  const log = (s: string) => logLines.push(s);
  log(`ReliefWeb corroboration — mode=${commit ? "COMMIT" : "DRY-RUN"}`);

  // Short-circuit: without an approved appname the v2 API only returns 403, so
  // there is no point fetching. Register the integration as not_configured (a
  // distinct, non-alarming Source Health state) and return cleanly. Never let an
  // unconfigured optional integration read as "operational".
  if (!isReliefWebConfigured()) {
    log(RELIEFWEB_NOT_CONFIGURED_MESSAGE);
    if (commit) await registerHealth({ configured: false, feedOk: false, usableData: false });
    return summary(commit, 0, 0, 0, 0, 0, true, errors, logLines);
  }

  const now = new Date();
  const recentCutoff = new Date(now.getTime() - RECENT_RECHECK_DAYS * 86400000);
  const recheckCutoff = new Date(now.getTime() - RECHECK_INTERVAL_HOURS * 3600000);

  // Selection: recent incidents due a re-check (sitreps lag), PLUS never-checked
  // older rows for back-fill. Both restricted to humanitarian-relevant topics.
  // checkedAt is stamped after each examination so this converges over runs.
  const rows = await db
    .select({
      id: incidentsTable.id,
      topic: incidentsTable.topic,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
      country: incidentsTable.country,
      occurredAt: incidentsTable.occurredAt,
    })
    .from(incidentsTable)
    .where(
      and(
        inArray(incidentsTable.topic, HUMANITARIAN_TOPICS as unknown as string[]),
        or(
          // never checked (back-fill)
          isNull(incidentsTable.corroborationCheckedAt),
          // recent + due a re-check
          and(
            gte(incidentsTable.occurredAt, recentCutoff),
            lt(incidentsTable.corroborationCheckedAt, recheckCutoff),
          ),
        ),
      ),
    )
    // Newest first so recent rows (most analyst-relevant) win the batch cap.
    .orderBy(desc(incidentsTable.occurredAt))
    .limit(MAX_INCIDENTS_PER_RUN);

  log(`  selected ${rows.length} incident(s) to examine (cap ${MAX_INCIDENTS_PER_RUN})`);
  if (rows.length === 0) {
    // Nothing due for a re-check this run. The feed is reachable but produced no
    // new matches now, so do not (re)assert "operational" here — leave the row
    // as-is. usableData=false means registerHealth leaves an established row
    // untouched rather than fabricating health from an empty run.
    if (commit) await registerHealth({ configured: true, feedOk: true, usableData: false });
    return summary(commit, 0, 0, 0, 0, 0, true, errors, logLines);
  }

  // Group selected incidents by primary country and compute a query window that
  // spans each country's incidents (± DATE_WINDOW_DAYS), so one request per
  // country covers them all.
  type Group = { country: string; from: Date; to: Date; incidents: typeof rows };
  const groups = new Map<string, Group>();
  for (const inc of rows) {
    const country = primaryCountry(inc.country);
    if (!country) continue;
    const key = country.toLowerCase();
    const g = groups.get(key);
    if (g) {
      if (inc.occurredAt < g.from) g.from = inc.occurredAt;
      if (inc.occurredAt > g.to) g.to = inc.occurredAt;
      g.incidents.push(inc);
    } else {
      groups.set(key, { country, from: inc.occurredAt, to: inc.occurredAt, incidents: [inc] });
    }
  }

  // Most-incident countries first, capped, so a noisy single-country run is the
  // one that gets the queries rather than a long tail of one-off countries.
  const orderedGroups = Array.from(groups.values())
    .sort((a, b) => b.incidents.length - a.incidents.length)
    .slice(0, MAX_COUNTRIES_PER_RUN);

  let countriesQueried = 0;
  let reportsFetched = 0;
  let fetchOk = true;
  let anyFetchAttempted = false;

  const linkRows: {
    incidentId: number;
    provider: "reliefweb";
    externalId: string;
    reportTitle: string;
    sourceAgency: string | null;
    reportDate: Date | null;
    url: string;
    matchScore: number;
  }[] = [];
  const corroboratedIncidents = new Set<number>();

  for (const g of orderedGroups) {
    const from = new Date(g.from.getTime() - DATE_WINDOW_DAYS * 86400000);
    const to = new Date(g.to.getTime() + DATE_WINDOW_DAYS * 86400000);
    let reports: ReliefWebReport[] = [];
    anyFetchAttempted = true;
    try {
      reports = await fetchReports(g.country, from, to);
      countriesQueried++;
      reportsFetched += reports.length;
      log(`  ${g.country}: ${reports.length} report(s) for ${g.incidents.length} incident(s)`);
    } catch (err) {
      fetchOk = false;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${g.country}: ${msg}`);
      log(`  ${g.country}: FETCH ERROR ${msg}`);
      continue;
    }
    if (reports.length === 0) continue;

    for (const inc of g.incidents) {
      const text = `${inc.title} ${inc.summary}`;
      const candidates: Candidate[] = [];
      for (const rep of reports) {
        const c = scoreMatch(text, inc.occurredAt, g.country, rep);
        if (c) candidates.push(c);
      }
      candidates.sort((a, b) => b.score - a.score);
      const top = candidates.slice(0, MAX_LINKS_PER_INCIDENT);
      for (const c of top) {
        linkRows.push({
          incidentId: inc.id,
          provider: "reliefweb",
          externalId: c.report.id,
          reportTitle: c.report.title,
          sourceAgency: c.report.agency,
          reportDate: c.report.date,
          url: c.report.url,
          matchScore: Math.round(c.score * 1000) / 1000,
        });
        corroboratedIncidents.add(inc.id);
      }
    }
  }

  log(
    `  matched ${linkRows.length} link(s) across ${corroboratedIncidents.size} incident(s)`,
  );

  // ReliefWeb is operational unless we attempted fetches and EVERY one failed.
  const feedOk = !anyFetchAttempted || countriesQueried > 0;
  void fetchOk; // per-country failures are surfaced via `errors`, not the health flag.

  let linksInserted = 0;
  if (commit) {
    if (linkRows.length > 0) {
      // onConflictDoNothing keeps the pass idempotent (unique incident+provider+id).
      const inserted = await db
        .insert(incidentCorroborationsTable)
        .values(linkRows)
        .onConflictDoNothing()
        .returning({ id: incidentCorroborationsTable.id });
      linksInserted = inserted.length;
    }
    // Stamp EVERY examined incident as checked (matched or not) so the bounded
    // batch advances to other rows on the next run instead of re-querying these.
    await db
      .update(incidentsTable)
      .set({ corroborationCheckedAt: now })
      .where(
        inArray(
          incidentsTable.id,
          rows.map((r) => r.id),
        ),
      );
    await registerHealth({
      configured: true,
      feedOk,
      usableData: corroboratedIncidents.size > 0,
    });
    log(`  committed: ${linksInserted} new link(s); stamped ${rows.length} incident(s) as checked`);
  } else {
    log(`  DRY-RUN — no rows written.`);
  }

  return summary(
    commit,
    rows.length,
    countriesQueried,
    reportsFetched,
    linksInserted,
    corroboratedIncidents.size,
    feedOk,
    errors,
    logLines,
  );
}

/**
 * Register ReliefWeb on Source Health under each humanitarian topic it backs.
 *
 * Four-way mapping onto the source row:
 *  - !configured           → not_configured (cleared timestamps, never alarming).
 *  - configured & !feedOk   → failing path (escalates after the streak threshold).
 *  - configured & usableData → operational (it genuinely returned corroborations).
 *  - configured & feedOk but no matches yet → leave the row untouched: we do NOT
 *    fabricate "operational" for a reachable-but-empty integration. The richer
 *    "no_data" nuance is carried by the Integrations panel instead.
 */
async function registerHealth(opts: {
  configured: boolean;
  feedOk: boolean;
  usableData: boolean;
}): Promise<void> {
  const notes =
    "UN OCHA ReliefWeb — official corroboration of scraped incidents (country + timeframe + event match). Auto-monitored each ingest run.";
  for (const topic of HUMANITARIAN_TOPICS) {
    if (!opts.configured) {
      await recordSourceHealth(
        topic,
        [
          {
            name: "ReliefWeb (UN OCHA)",
            url: "https://reliefweb.int",
            ok: false,
            error: RELIEFWEB_NOT_CONFIGURED_MESSAGE,
          },
        ],
        { sourceType: "api", reliability: 5, notes, notConfigured: true },
      );
    } else if (!opts.feedOk) {
      await recordSourceHealth(
        topic,
        [
          {
            name: "ReliefWeb (UN OCHA)",
            url: "https://reliefweb.int",
            ok: false,
            error: "ReliefWeb corroboration query failed",
          },
        ],
        { sourceType: "api", reliability: 5, notes },
      );
    } else if (opts.usableData) {
      await recordSourceHealth(
        topic,
        [{ name: "ReliefWeb (UN OCHA)", url: "https://reliefweb.int", ok: true, error: null }],
        { sourceType: "api", reliability: 5, notes },
      );
    }
    // else: configured + reachable + no matches this run → intentionally leave
    // the existing row untouched.
  }
}

function summary(
  commit: boolean,
  incidentsConsidered: number,
  countriesQueried: number,
  reportsFetched: number,
  linksInserted: number,
  incidentsCorroborated: number,
  fetchOk: boolean,
  errors: string[],
  logLines: string[],
): ReliefWebCorroborationSummary {
  return {
    provider: "reliefweb",
    mode: commit ? "commit" : "dry-run",
    incidentsConsidered,
    countriesQueried,
    reportsFetched,
    linksInserted,
    incidentsCorroborated,
    fetchOk,
    errors,
    logLines,
  };
}
