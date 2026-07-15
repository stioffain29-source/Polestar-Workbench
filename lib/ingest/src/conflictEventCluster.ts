// Same-event clustering for Conflict Watch incidents.
//
// WHY: Conflict news is heavily syndicated and reworded. Two headlines routinely
// report ONE real-world event yet are lexically disjoint — "Five labourers from
// Punjab shot dead in Washuk" vs "Five Punjabi workers shot dead in Mashkail
// town of Washuk district" (synonym rewrite), a killing reported under two
// different districts, an attack and its manhunt/arrest follow-up, or a string
// of running cumulative casualty tallies of one named operation. The
// deterministic token-overlap collapse passes (conflictSameEventCollapse /
// conflictOperationCollapse) cannot reach these without merging genuinely
// distinct events, so the monitor still shows duplicate cards.
//
// HOW: a server-side LLM adjudication pass at ingest, mirroring titleTranslate.
// A deterministic pre-gate the LLM cannot override bounds collateral — only
// pairs that are (a) same topic=conflict, (b) same attributed country, (c) within
// a tight time window, and (d) share at least one significant token become
// candidate pairs. The LLM answers same_event yes/no per candidate pair (temp 0,
// strict JSON, "no" when unsure). Rows joined by a "yes" edge form a cluster
// (connected components); every row in a cluster is stamped with a shared
// `conflict_evt:<min id>` key. The monitor and report then dedupe by that key.
//
// STRICT no-fabrication: this pass NEVER edits an incident's facts, severity,
// country or coordinates — it only GROUPS existing rows and stamps a key. It is
// idempotent: only NULL-key rows are ever written, and an already-settled
// cluster is never rewritten (a new row that matches an existing cluster adopts
// that cluster's key). No-ops gracefully when the LLM is unavailable, leaving the
// deterministic collapse passes as the sole (fallback) dedupe.

import { sql, and, gte, eq, isNull } from "drizzle-orm";
import { db, incidentsTable } from "@workspace/db";
import { isLlmAvailable, openAiFastModel, readOpenAiConfig } from "./openaiConfig";

// ---------------------------------------------------------------------------
// Row shape + judge contract (kept minimal + injectable so the pure clustering
// logic is unit-testable with a mocked judge and dry-runnable against a saved
// prod snapshot with the real LLM).
// ---------------------------------------------------------------------------
export interface ClusterRow {
  id: number;
  country: string;
  occurredAt: string | Date;
  title: string;
  displayTitle?: string | null;
  severity?: string | null;
  eventClusterKey?: string | null;
}

/** Verdict: are these two headlines the SAME real-world event? */
export type SameEventJudge = (a: ClusterRow, b: ClusterRow) => Promise<boolean>;

export interface ClusterOptions {
  /** Max hours between two incidents' occurredAt for them to be a candidate. */
  gateHours?: number;
  /** Hard cap on candidate pairs adjudicated in one run (cost bound). */
  maxPairs?: number;
  /** Concurrent judge calls. */
  concurrency?: number;
  /** Per-row cap on forward time-nearest neighbours to pair (see candidatePairs). */
  maxNeighbours?: number;
}

export interface ClusterResult {
  /** id -> cluster key, ONLY for rows whose key was NULL and now gets stamped. */
  assignments: Map<number, string>;
  /** Connected components of size >= 2 (arrays of row ids). */
  clusters: number[][];
  pairsConsidered: number;
  edges: number;
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------
function toMs(v: string | Date): number {
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

// Non-distinctive vocabulary. A shared token only makes a pair worth asking the
// LLM about when it is DISTINCTIVE (a place, actor or count) — generic conflict
// vocabulary ("killed", "militants", "forces") and country/nationality names
// connect nearly every same-country pair and would explode the candidate set.
// Deliberately does NOT stop specific place/actor names (washuk, manipur,
// interpol, balochistan) or counts, so groups that connect only on one such
// token (D: "interpol"; E: "balochistan"; B-Tamenglong: "manipur") survive.
const TOKEN_STOP = new Set<string>([
  "after", "amid", "over", "into", "from", "with", "that", "this", "than",
  "then", "they", "them", "have", "been", "were", "will", "says", "said",
  "your", "their", "there", "here", "when", "what", "which", "while", "near",
  "town", "city", "district", "area", "province", "state", "region", "village",
  "news", "report", "reports", "reported", "latest", "update", "video",
  "people", "persons", "person", "another", "against",
  // Country / nationality names (present in nearly every row of a country).
  "india", "indian", "pakistan", "pakistani", "myanmar", "burmese",
  "afghanistan", "afghan", "bangladesh", "nepal", "china", "chinese",
  "thailand", "thai", "philippines", "filipino", "indonesia", "indonesian",
  // Generic armed-conflict vocabulary.
  "killed", "kill", "kills", "killing", "killings", "dead", "death", "deaths",
  "died", "shot", "attack", "attacks", "attacked", "blast", "blasts", "bomb",
  "bombing", "bombs", "explosion", "gunmen", "gunman", "militant", "militants",
  "terrorist", "terrorists", "insurgent", "insurgents", "rebel", "rebels",
  "force", "forces", "army", "troops", "troop", "soldier", "soldiers",
  "police", "policemen", "cops", "security", "personnel", "operation",
  "operations", "encounter", "clash", "clashes", "firing", "injured",
  "wounded", "arrested", "arrest", "arrests", "detained", "held", "raid",
  "raids", "group", "groups", "suspected", "alleged", "bodies", "body",
  "militia", "militias", "fighters", "fighter", "attackers", "gunfight",
  "shootout", "officers", "officer", "official", "officials",
]);

/** English-preferred headline. displayTitle is the clean English rewrite when
 *  present; treat an empty/whitespace displayTitle as absent (English rows leave
 *  it null, but a snapshot may carry "") and fall back to the original title. */
function preferredHeadline(row: ClusterRow): string {
  const dt = row.displayTitle?.trim();
  return dt || row.title || "";
}

/** Significant tokens (>=4-letter words + numbers) from the English-preferred
 *  headline, used only to gate which pairs are worth asking the LLM about. */
export function significantTokens(row: ClusterRow): Set<string> {
  const text = preferredHeadline(row).toLowerCase();
  const out = new Set<string>();
  for (const raw of text.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    if (/^\d{2,4}$/.test(raw)) {
      out.add(raw); // numbers (counts) are a strong same-event signal
      continue;
    }
    if (raw.length >= 4 && !TOKEN_STOP.has(raw)) out.add(raw);
  }
  return out;
}

function shareSignificantToken(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (big.has(t)) return true;
  return false;
}

/** Candidate pairs (index i<j) that pass the deterministic pre-gate: same
 *  country, within gateHours, share >=1 significant token, and NOT both already
 *  keyed (a pair of two settled rows needs no re-adjudication).
 *
 *  maxNeighbours caps how many forward (later-in-time) qualifying neighbours each
 *  row is paired with. A dense same-place block (e.g. dozens of Balochistan rows
 *  in a week) is otherwise O(n²) and floods the LLM with mostly-"no" pairs. Same
 *  events are time-ADJACENT (a syndication burst, or the consecutive tallies of
 *  one operation), so capping to the nearest few forward neighbours preserves
 *  every real chain under single-linkage while cutting the candidate set ~2-3x.
 *  0/undefined = uncapped. */
export function candidatePairs(
  rows: ClusterRow[],
  gateHours: number,
  maxNeighbours = 0,
): [number, number][] {
  const gateMs = gateHours * 3600000;
  const toks = rows.map(significantTokens);
  const ms = rows.map((r) => toMs(r.occurredAt));
  // Bucket by country so we only compare within-country.
  const byCountry = new Map<string, number[]>();
  rows.forEach((r, idx) => {
    const key = (r.country ?? "").trim().toLowerCase();
    if (!key || key === "unknown") return; // never cluster across/without country
    const list = byCountry.get(key);
    if (list) list.push(idx);
    else byCountry.set(key, [idx]);
  });
  const pairs: [number, number][] = [];
  for (const idxs of byCountry.values()) {
    idxs.sort((a, b) => ms[a]! - ms[b]!);
    for (let a = 0; a < idxs.length; a++) {
      const i = idxs[a]!;
      let kept = 0;
      for (let b = a + 1; b < idxs.length; b++) {
        if (maxNeighbours > 0 && kept >= maxNeighbours) break;
        const j = idxs[b]!;
        if (ms[j]! - ms[i]! > gateMs) break; // sorted → no later j qualifies
        if (rows[i]!.eventClusterKey && rows[j]!.eventClusterKey) continue;
        if (!shareSignificantToken(toks[i]!, toks[j]!)) continue;
        pairs.push([i, j]);
        kept++;
      }
    }
  }
  return pairs;
}

// Union-find.
class DSU {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/** Cluster rows via the injected same-event judge. Deterministic pre-gate +
 *  LLM edges + connected components. Returns key assignments for NULL-key rows
 *  only (idempotent, never rewrites a settled cluster): multi-row clusters share
 *  one key; every remaining singleton is settled with a self-key so the
 *  both-keyed pre-gate skip converges steady-state cost to new rows only. */
export async function clusterRows(
  rows: ClusterRow[],
  judge: SameEventJudge,
  opts: ClusterOptions = {},
): Promise<ClusterResult> {
  // 30h: covers the widest consecutive gap in a real running-tally chain
  // (25.5h between successive Balochistan operation counts) while trimming the
  // candidate set far below a naive 72h window over a dense place-block.
  const gateHours = opts.gateHours ?? 30;
  const maxPairs = Math.max(1, opts.maxPairs ?? 2000);
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  // 6 forward neighbours keeps every real chain (validated: groups A-E all still
  // connect) while cutting a dense 14d place-block from ~3500 pairs to ~1600.
  const maxNeighbours = opts.maxNeighbours ?? 6;

  let pairs = candidatePairs(rows, gateHours, maxNeighbours);
  const pairsConsidered = Math.min(pairs.length, maxPairs);
  if (pairs.length > maxPairs) pairs = pairs.slice(0, maxPairs);

  const dsu = new DSU(rows.length);
  let edges = 0;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < pairs.length) {
      const [i, j] = pairs[next++]!;
      const same = await judge(rows[i]!, rows[j]!);
      if (same) {
        dsu.union(i, j);
        edges++;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pairs.length) }, worker),
  );

  // Gather components.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const r = dsu.find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }

  const assignments = new Map<number, string>();
  const clusters: number[][] = [];
  for (const members of groups.values()) {
    if (members.length < 2) {
      // Singleton: settle it with a self-key (conflict_evt:<id>) so future runs
      // skip re-adjudicating it against other already-settled rows (the
      // both-keyed pre-gate skip). This is what makes steady-state cost converge
      // to new-rows-only instead of re-paying for the whole window every run. It
      // is display-inert (a unique key is its own group in collapseByEventClusterKey)
      // and never blocks a later merge: a same-event copy arrives NULL-keyed, so
      // the pre-gate still pairs it against this settled row.
      const m = members[0]!;
      if (!rows[m]!.eventClusterKey) {
        assignments.set(rows[m]!.id, `conflict_evt:${rows[m]!.id}`);
      }
      continue;
    }
    const ids = members.map((m) => rows[m]!.id);
    clusters.push([...ids].sort((a, b) => a - b));
    // Prefer an existing key already on any member (keeps settled clusters
    // stable); otherwise mint conflict_evt:<min id>.
    const existing = members
      .map((m) => rows[m]!.eventClusterKey)
      .filter((k): k is string => !!k)
      .sort();
    const key = existing[0] ?? `conflict_evt:${Math.min(...ids)}`;
    for (const m of members) {
      if (!rows[m]!.eventClusterKey) assignments.set(rows[m]!.id, key);
    }
  }
  return { assignments, clusters, pairsConsidered, edges };
}

// ---------------------------------------------------------------------------
// LLM judge (mirrors titleTranslate: bounded fetch client, JSON response,
// per-request abort, retry with backoff, graceful no-op when unavailable).
// ---------------------------------------------------------------------------
const MODEL = openAiFastModel();
const REQUEST_TIMEOUT_MS = 20000;
// gpt-5-mini is a REASONING model: max_completion_tokens covers reasoning FIRST,
// then the (tiny) visible answer. Keep >=8192 or the answer comes back empty.
const MAX_COMPLETION_TOKENS = 8192;

const SYSTEM_PROMPT = `You are a deduplication editor for an English-language security-intelligence incident feed covering armed conflict in South and Southeast Asia. You will be given TWO news headlines, each with its report date, about incidents in the SAME country. Decide whether the two headlines report THE SAME specific real-world event.

Answer "yes" when they describe the same underlying incident, including when:
- one is a reworded, translated or syndicated copy of the other;
- they name the same killing, attack or blast but differ in wording, victim description or the district named (e.g. "labourers" vs "workers", or a town vs the wider district that contains it);
- one reports an attack and the other the immediate follow-up OF THE SAME incident (the same manhunt or search, the same arrest, the same Interpol notice against the same person);
- both are running cumulative casualty tallies of the SAME named ongoing military operation or crackdown, in the same area over the same days.

Answer "no" when they are separate incidents, even if similar in type, actor or region — for example two different killings on the same day in different places, an older case revived, or a general policy, analysis or advocacy story rather than one specific event. If you are not confident they are the same specific event, answer "no".

Return STRICT JSON: {"same_event": "yes" | "no"}. Output nothing else.`;

function headlineOf(r: ClusterRow): string {
  return preferredHeadline(r).trim();
}
function dateOf(r: ClusterRow): string {
  const d = r.occurredAt instanceof Date ? r.occurredAt : new Date(r.occurredAt);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "unknown";
}

type JudgeOutcome =
  | { ok: true; same: boolean }
  | { ok: false; error: string; retryAfterMs?: number };

async function judgeOnce(a: ClusterRow, b: ClusterRow): Promise<JudgeOutcome> {
  const cfg = readOpenAiConfig();
  if (!cfg) return { ok: false, error: "llm-unavailable" };
  const { baseUrl: base, apiKey: key } = cfg;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        // NOTE: no reasoning_effort override. The nuanced same-event calls
        // (running casualty tallies of one operation across days; one victim
        // reported under two adjacent districts) need the model's default
        // reasoning — "minimal"/"low" measurably drop recall on exactly these.
        // Volume/cost is bounded by the candidate pre-gate + neighbour cap, not
        // by degrading the judgment.
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `A (${dateOf(a)}): ${headlineOf(a)}\nB (${dateOf(b)}): ${headlineOf(b)}`,
          },
        ],
      }),
      signal: ac.signal,
    });
    if (res.status === 429 || res.status >= 500) {
      const ra = res.headers.get("retry-after");
      let retryAfterMs: number | undefined;
      if (ra) {
        const secs = Number(ra);
        if (Number.isFinite(secs)) retryAfterMs = secs * 1000;
        else {
          const when = Date.parse(ra);
          if (Number.isFinite(when)) retryAfterMs = Math.max(0, when - Date.now());
        }
      }
      return { ok: false, error: `http-${res.status}`, retryAfterMs };
    }
    if (!res.ok) return { ok: false, error: `http-${res.status}` };
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: "empty-content" };
    let parsed: { same_event?: unknown };
    try {
      parsed = JSON.parse(content) as { same_event?: unknown };
    } catch {
      return { ok: false, error: "bad-json" };
    }
    const v = typeof parsed.same_event === "string" ? parsed.same_event.trim().toLowerCase() : "";
    if (v !== "yes" && v !== "no") return { ok: false, error: "bad-verdict" };
    return { ok: true, same: v === "yes" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: ac.signal.aborted ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

const RETRYABLE = new Set(["timeout", "bad-json", "empty-content", "bad-verdict"]);

/** Same-event judge backed by the OpenAI integration. Returns false (not the
 *  same event) on any unrecoverable error — the fail-safe direction is to LEAVE
 *  rows separate rather than risk a wrong merge. */
export const judgeSamePair: SameEventJudge = async (a, b) => {
  let last: JudgeOutcome = { ok: false, error: "not-attempted" };
  for (let attempt = 0; attempt <= 3; attempt++) {
    last = await judgeOnce(a, b);
    if (last.ok) return last.same;
    const retryable = RETRYABLE.has(last.error) || last.error.startsWith("http-");
    if (!retryable || attempt === 3) return false;
    const hint = !last.ok ? last.retryAfterMs : undefined;
    const backoff = hint ?? 1000 * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, Math.min(backoff, 15000) + Math.random() * 500));
  }
  return false;
};

// ---------------------------------------------------------------------------
// Orchestrator: read recent conflict rows, cluster, stamp keys. Mirrors
// runTitleTranslation's shape (commit flag, log lines, graceful skip).
// ---------------------------------------------------------------------------
export interface ConflictClusterSummary {
  candidates: number;
  pairsConsidered: number;
  edges: number;
  clustersFormed: number;
  stamped: number;
  skipped: boolean;
  logLines: string[];
}

export async function runConflictClustering(
  opts: {
    commit?: boolean;
    windowDays?: number;
    gateHours?: number;
    maxPairs?: number;
    concurrency?: number;
  } = {},
): Promise<ConflictClusterSummary> {
  const commit = opts.commit ?? false;
  const windowDays = Math.max(1, opts.windowDays ?? 14);
  const logLines: string[] = [];

  if (!isLlmAvailable()) {
    logLines.push(
      "conflict-cluster: LLM unavailable (set AI_INTEGRATIONS_OPENAI_* or OPENAI_API_KEY) — skipped",
    );
    return {
      candidates: 0, pairsConsidered: 0, edges: 0, clustersFormed: 0,
      stamped: 0, skipped: true, logLines,
    };
  }

  const since = new Date(Date.now() - windowDays * 86400000);
  const rows = (await db
    .select({
      id: incidentsTable.id,
      country: incidentsTable.country,
      occurredAt: incidentsTable.occurredAt,
      title: incidentsTable.title,
      displayTitle: incidentsTable.displayTitle,
      severity: incidentsTable.severity,
      eventClusterKey: incidentsTable.eventClusterKey,
    })
    .from(incidentsTable)
    .where(
      and(eq(incidentsTable.topic, "conflict"), gte(incidentsTable.occurredAt, since)),
    )
    .orderBy(sql`${incidentsTable.occurredAt} DESC`)) as ClusterRow[];

  logLines.push(
    `conflict-cluster: ${rows.length} conflict row(s) in last ${windowDays}d`,
  );

  const result = await clusterRows(rows, judgeSamePair, {
    gateHours: opts.gateHours,
    maxPairs: opts.maxPairs,
    concurrency: opts.concurrency,
  });

  let stamped = 0;
  if (commit) {
    for (const [id, key] of result.assignments) {
      await db
        .update(incidentsTable)
        .set({ eventClusterKey: key })
        .where(and(eq(incidentsTable.id, id), isNull(incidentsTable.eventClusterKey)));
      stamped++;
    }
  }

  logLines.push(
    `conflict-cluster: ${commit ? "committed" : "dry-run"} — pairs ${result.pairsConsidered}, edges ${result.edges}, clusters ${result.clusters.length}, ${commit ? "stamped" : "would stamp"} ${commit ? stamped : result.assignments.size}`,
  );

  return {
    candidates: rows.length,
    pairsConsidered: result.pairsConsidered,
    edges: result.edges,
    clustersFormed: result.clusters.length,
    stamped: commit ? stamped : result.assignments.size,
    skipped: false,
    logLines,
  };
}
