import {
  evaluateIncidentRelevance,
  isNonIncidentEntertainment,
  isSportsFixtureNoise,
  RELEVANCE_RULE_VERSION,
} from "@workspace/relevance";
import { PROMOTE_MARKER_PREFIX } from "./markers";
import { TAPA_PROMOTE_MARKER_PREFIX } from "./tapaPromote";
import { SOCIAL_PROMOTE_MARKER_PREFIX } from "./socialPromote";

/**
 * Daily tracker quality refresh — coverage map and pure checks.
 *
 * Everything here is a pure function over plain rows. No database, no fetch, no
 * browser-only import, so the api-server runner, the scheduler and the tests
 * all reach the same verdict from the same code. The checks REUSE the product's
 * existing relevance/sports policies rather than re-implementing them: a second
 * classifier would drift away from the rules every other surface enforces.
 */

/**
 * A tracker's result for one run. These are deliberately distinct: a quiet feed
 * ("no_new_records") is a successful check, whereas a dead source, a switched
 * off provider, a tracker with no collector at all, an unreached target and an
 * unfinished scan are all failures of a different kind. Collapsing them into a
 * single boolean is how a broken tracker reads as "fine".
 */
export type DailyQualityOutcome =
  | "checked"
  | "no_new_records"
  | "source_failed"
  | "provider_disabled"
  | "no_collector"
  | "skipped"
  | "incomplete"
  | "error";

export type DailyQualityTargetKind =
  | "incidents"
  | "strikes"
  | "market"
  | "maritime"
  | "report";

export type DailyQualityCheckName =
  | "sports_noise"
  | "relevance"
  | "geography"
  | "event_date"
  | "duplicate"
  | "freshness";

export interface DailyQualityCoverageEntry {
  key: string;
  label: string;
  kind: DailyQualityTargetKind;
  /** Incident topics that constitute this tracker. Empty for non-incident stores. */
  topics: string[];
  /**
   * The scheduled collector that refreshes this tracker's evidence, or null
   * when the product has none. A null collector is DISCLOSED as `no_collector`
   * rather than reported as a successful refresh.
   */
  collector: string | null;
  /**
   * Whether a missing country on this tracker's records is a finding.
   *
   * `required` — country/regional surfaces place these records, so an
   *   unattributed row is a real gap worth an analyst's time.
   * `region-feed` — the tracker reads multi-country feeds whose records
   *   legitimately carry country 'Unknown' and render as "—". Flagging those
   *   would bury the real findings under hundreds of known-accepted rows.
   * `n/a` — not an incident store.
   *
   * Stated explicitly on every entry: a new tracker must decide, rather than
   * inherit a silent pass.
   */
  countryAttribution: "required" | "region-feed" | "n/a";
  /**
   * Topics this tracker READS but does not own. Crime Watch reads the APAC
   * local feed the way its monitor does, but those rows belong to that feed:
   * failing Crime Watch's rule means "not crime evidence", never "invalid",
   * so a borrowed row is judged but never excluded on topic grounds.
   */
  borrowedTopics?: string[];
  /**
   * Relevance policy the tracker's candidates are judged under, when it is
   * not the row's stored topic. Keeps the recheck identical to the product
   * surface, which filters borrowed rows through its OWN rule.
   */
  policyTopic?: string;
  /** Shown verbatim in Source Health when the tracker cannot report a clean pass. */
  note?: string;
}

/**
 * One explicit mapping of every covered tracker. A tracker absent from this
 * list is absent from the daily run, which is why the run reports the list
 * itself: missing coverage must be visible, never an implicit pass.
 *
 * Prices, vessels and facility context are included as their own non-incident
 * kinds. They are freshness-checked, never swept as ordinary incidents — a
 * price series has no relevance verdict and no event date to contradict.
 */
export const DAILY_QUALITY_COVERAGE: readonly DailyQualityCoverageEntry[] = [
  {
    key: "flashpoint",
    label: "Flashpoint & Civil Unrest",
    kind: "incidents",
    // Civil Unrest reads the live flashpoint bucket; `protests` is the legacy
    // alias the relevance and validity layers already treat as equivalent.
    topics: ["flashpoint", "protests"],
    collector: "runIngestOnce",
    countryAttribution: "required",
  },
  {
    key: "conflict",
    label: "Conflict Watch",
    kind: "incidents",
    topics: ["conflict"],
    collector: "runIngestOnce",
    countryAttribution: "required",
  },
  {
    key: "shipping",
    label: "Shipping Watch",
    kind: "incidents",
    topics: ["shipping"],
    collector: "runIngestOnce",
    countryAttribution: "region-feed",
  },
  {
    key: "energy",
    label: "Energy Watch",
    kind: "incidents",
    topics: ["energy"],
    collector: "runIngestOnce",
    countryAttribution: "region-feed",
  },
  {
    key: "fuel",
    label: "Fuel Watch",
    kind: "incidents",
    topics: ["fuel"],
    collector: "runIngestOnce",
    countryAttribution: "region-feed",
  },
  {
    key: "fertiliser",
    label: "Fertiliser Watch",
    kind: "incidents",
    topics: ["fertiliser"],
    collector: "runIngestOnce",
    countryAttribution: "region-feed",
  },
  {
    key: "cargo_watch",
    label: "Cargo Watch",
    kind: "incidents",
    topics: ["cargo_watch"],
    collector: "runIngestOnce",
    countryAttribution: "required",
  },
  {
    key: "data_centres",
    label: "Data Centres",
    kind: "incidents",
    topics: ["data_centres"],
    collector: "runIngestOnce",
    countryAttribution: "region-feed",
  },
  {
    key: "crime",
    label: "Crime Watch",
    kind: "incidents",
    // EXACTLY what the Crime Watch monitor reads: rows stored under `crime`,
    // plus the APAC local feed it also pulls in. Crime has no feed of its own,
    // so the borrowed rows are judged under the crime rule (policyTopic) the
    // way the monitor filters them — not under their own feed's rule, which
    // would both mislabel unrelated local-feed checks as Crime coverage and
    // miss rows that are invalid specifically for Crime Watch.
    topics: ["crime", "apac_local"],
    borrowedTopics: ["apac_local"],
    policyTopic: "crime",
    collector: null,
    countryAttribution: "required",
    note:
      "No dedicated crime collector exists. Crime evidence arrives only as a category on the " +
      "country-local feeds, so crime coverage is whatever those feeds happen to carry and cannot " +
      "be reported as an independently refreshed tracker.",
  },
  {
    key: "local_feeds",
    label: "Country Local Feeds",
    kind: "incidents",
    // Supporting store, not a tracker of its own: the Indonesia and APAC local
    // feeds behind the country briefs (and read by Crime Watch). Listed so the
    // rows are swept under THEIR OWN feed rules; Crime Watch's pass judges the
    // same APAC rows under the crime rule without owning them.
    topics: ["indonesia_local", "apac_local"],
    collector: "runIngestOnce",
    countryAttribution: "region-feed",
    note:
      "Multi-country local feeds supporting the country briefs. Records legitimately carry an " +
      "unresolved country and are checked under their own feed rules.",
  },
  {
    key: "strikes",
    label: "Missile Strike Tracker",
    kind: "strikes",
    topics: [],
    collector: "runStrikesOnce",
    countryAttribution: "n/a",
  },
  {
    key: "fuel_prices",
    label: "Fuel & Market Prices",
    kind: "market",
    topics: [],
    collector: "runMarketPricesOnce",
    countryAttribution: "n/a",
    note: "Price series are freshness-checked only. They carry no relevance verdict or event date.",
  },
  {
    key: "maritime_movement",
    label: "Maritime Movement (AIS)",
    kind: "maritime",
    topics: [],
    collector: "runMovementOnce",
    countryAttribution: "n/a",
    note: "Vessel positions are context, not incidents. Checked for provider availability and freshness only.",
  },
  {
    key: "maritime_security",
    label: "Maritime Security Events",
    kind: "maritime",
    topics: [],
    collector: "runIccPiracyOnce",
    countryAttribution: "n/a",
  },
  {
    key: "apac_weekly",
    label: "APAC Weekly Regional Report",
    kind: "report",
    topics: [],
    collector: null,
    countryAttribution: "n/a",
    note: "Revalidated against its own region and reporting period; never rewritten.",
  },
  {
    key: "middle_east_weekly",
    label: "Middle East Weekly Regional Report",
    kind: "report",
    topics: [],
    collector: null,
    countryAttribution: "n/a",
    note: "Revalidated against its own region and reporting period; never rewritten.",
  },
  {
    key: "country_briefs",
    label: "Country & City Briefs",
    kind: "report",
    topics: [],
    collector: null,
    countryAttribution: "n/a",
    note: "Evidence revalidated against each brief's own window; saved prose is flagged, never edited.",
  },
];

/** Every incident topic the daily sweep covers, deduplicated. */
export function coveredIncidentTopics(): string[] {
  const seen = new Set<string>();
  for (const entry of DAILY_QUALITY_COVERAGE) {
    if (entry.kind !== "incidents") continue;
    for (const topic of entry.topics) seen.add(topic);
  }
  return [...seen];
}

export function coverageEntry(key: string): DailyQualityCoverageEntry | undefined {
  return DAILY_QUALITY_COVERAGE.find((entry) => entry.key === key);
}

/**
 * Whether a missing country on this topic's records is a finding. A topic that
 * is not in the coverage map falls back to `required`, so an unmapped tracker
 * produces visible findings rather than a silent pass.
 */
export function countryAttributionForTopic(topic: string): "required" | "region-feed" {
  // The OWNING tracker decides, never one that merely borrows the topic:
  // Crime Watch reads apac_local but that feed's rows are legitimately
  // multi-country, so its own entry must set the expectation.
  const entry = DAILY_QUALITY_COVERAGE.find(
    (e) =>
      e.kind === "incidents" &&
      e.topics.includes(topic) &&
      !(e.borrowedTopics ?? []).includes(topic),
  );
  return entry?.countryAttribution === "region-feed" ? "region-feed" : "required";
}

/** The minimal row shape the checks need. Mirrors the incidents table columns. */
export interface DailyQualityCandidate {
  id: number;
  topic: string;
  title: string;
  displayTitle?: string | null;
  summary: string;
  country: string;
  location?: string | null;
  category?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  occurredAt: Date;
  incidentDate?: Date | null;
  relevanceStatus?: string | null;
  eventClusterKey?: string | null;
  analystNotes?: string | null;
}

export interface DailyQualityVerdict {
  /**
   * `exclude` is a definite non-event and is applied. `review` is an uncertain
   * case: it is recorded with its evidence and left for an analyst. Nothing
   * here ever invents a replacement date, country or severity.
   */
  kind: "keep" | "exclude" | "review";
  checkName: DailyQualityCheckName;
  reason: string;
  ruleVersion: string;
  beforeStatus: string | null;
  afterStatus: string | null;
}

/**
 * Rows admitted by a structured provider carry their own coding. GDELT and TAPA
 * promotions, and social promotions, are deliberately NOT re-scored by the text
 * rules, which know nothing about those lanes — re-scoring them would destroy
 * the promote semantics. This mirrors the existing relevance backfill exactly.
 */
export function hasProvenanceAdmission(analystNotes: string | null | undefined): boolean {
  if (!analystNotes) return false;
  return (
    analystNotes.startsWith(PROMOTE_MARKER_PREFIX) ||
    analystNotes.startsWith(TAPA_PROMOTE_MARKER_PREFIX) ||
    analystNotes.startsWith(SOCIAL_PROMOTE_MARKER_PREFIX)
  );
}

function keep(reason: string, before: string | null): DailyQualityVerdict {
  return {
    kind: "keep",
    checkName: "relevance",
    reason,
    ruleVersion: RELEVANCE_RULE_VERSION,
    beforeStatus: before,
    afterStatus: before,
  };
}

/** Tolerance for a publication timestamp that legitimately runs slightly ahead. */
const FUTURE_SKEW_MS = 36 * 60 * 60 * 1000;

/**
 * Decide one record. Ordering matters: provenance admission wins over the text
 * rules, definite non-events are removed before the softer checks, and an
 * already-excluded row is never resurrected — this pass can only REMOVE or
 * FLAG, never add a record back or up-rate it.
 */
/** How a tracker judges a candidate that it reads but may not own. */
export interface DailyQualityCheckOptions {
  /** Relevance policy to judge under. Defaults to the row's stored topic. */
  policyTopic?: string;
  /**
   * The row is borrowed from another feed. Failing this tracker's rule then
   * means "not this tracker's evidence", which the monitor already handles by
   * not showing it — excluding it would strip the row from the surfaces that
   * DO own it (the country briefs read the same local-feed rows).
   */
  borrowed?: boolean;
}

export function checkIncidentQuality(
  row: DailyQualityCandidate,
  now: Date = new Date(),
  options: DailyQualityCheckOptions = {},
): DailyQualityVerdict {
  const before = row.relevanceStatus ?? null;

  if (hasProvenanceAdmission(row.analystNotes)) {
    return keep("Structured provider admission preserved; text rules do not apply.", before);
  }

  // A row already excluded stays excluded. The daily pass is not an appeal.
  if (before === "irrelevant") {
    return keep("Already excluded; daily refresh never re-admits a record.", before);
  }

  // The relevance authority must see EXACTLY what the persisted gate saw: the
  // RAW title. Judging a translated display_title against rules tuned for the
  // original silently drops genuine local-language records — a Bahasa flood or
  // theft report that the ingest gate admitted reads as unmatched once it is
  // rendered in English.
  const rawTitle = row.title;
  // The noise gates read the SAME text the ingest gate reads, and nothing more.
  // Scanning the translated title instead looks like extra safety and is not:
  // the sports regex matches a bare sport name, so an English rendering of a
  // Bahasa headline turns "korupsi lapangan sepak bola" into "football field
  // corruption" and a wildfire beside a pitch into "soccer field" — both then
  // drop as fixture coverage. Parity with the ingest gate keeps this pass
  // exactly as strict as the product's own rules, never stricter.
  const haystack = `${rawTitle} ${row.summary}`;

  // Definite non-events first. These apply even to a record already carrying
  // the CURRENT rule version, which an ordinary version-gated backfill skips —
  // that gap is exactly how stored sports results survive in tracker data.
  if (isSportsFixtureNoise(haystack)) {
    return {
      kind: "exclude",
      checkName: "sports_noise",
      reason: "Sports fixture result or preview, not a security incident.",
      ruleVersion: RELEVANCE_RULE_VERSION,
      beforeStatus: before,
      afterStatus: "irrelevant",
    };
  }
  if (isNonIncidentEntertainment(rawTitle)) {
    return {
      kind: "exclude",
      checkName: "sports_noise",
      reason: "Entertainment or listings item, not a security incident.",
      ruleVersion: RELEVANCE_RULE_VERSION,
      beforeStatus: before,
      afterStatus: "irrelevant",
    };
  }

  // A record whose SOURCE text did not read as sport but whose rendered
  // English does. This is genuinely uncertain, so it is flagged, never
  // dropped: the translation turns "korupsi lapangan sepak bola" into
  // "football field corruption" and a fire beside a pitch into "soccer field",
  // and the fixture regex matches a bare sport name. Real fixture reports and
  // real corruption cases both land here, which is precisely why an analyst
  // decides rather than this pass.
  const shownTitle = row.displayTitle?.trim() ?? "";
  if (shownTitle && shownTitle !== rawTitle && isSportsFixtureNoise(`${shownTitle} ${row.summary}`)) {
    return {
      kind: "review",
      checkName: "sports_noise",
      reason:
        "Rendered English title reads as sports coverage although the source text did not. " +
        "Confirm before excluding: translated crime, corruption and fire reports that merely " +
        "name a pitch or use a sporting metaphor look identical to this check.",
      ruleVersion: RELEVANCE_RULE_VERSION,
      beforeStatus: before,
      afterStatus: before,
    };
  }

  // Wrong-topic / wrong-geography, judged by the product's own domain rules.
  const policyTopic = options.policyTopic ?? row.topic;
  const verdict = evaluateIncidentRelevance(policyTopic, {
    topic: policyTopic,
    title: rawTitle,
    summary: row.summary,
    source: row.source ?? null,
    sourceUrl: row.sourceUrl ?? null,
    location: row.location ?? null,
    category: row.category ?? null,
    country: row.country,
    occurredAt: row.occurredAt,
    incidentDate: row.incidentDate ?? null,
  });
  if (!verdict.relevant) {
    // A borrowed row that fails this tracker's rule is simply not this
    // tracker's evidence. Its own feed owns it and judges it there.
    if (options.borrowed) {
      return keep(
        `Not ${policyTopic} evidence; the record belongs to its own feed and is judged there.`,
        before,
      );
    }
    return {
      kind: "exclude",
      checkName: "relevance",
      reason: verdict.reason,
      ruleVersion: verdict.version,
      beforeStatus: before,
      afterStatus: "irrelevant",
    };
  }

  // Everything below is UNCERTAIN: recorded for review, never auto-corrected.
  const country = row.country?.trim() ?? "";
  if (
    (!country || country === "Unknown") &&
    countryAttributionForTopic(row.topic) === "required"
  ) {
    return {
      kind: "review",
      checkName: "geography",
      reason: "No country attributed. Regional and country surfaces cannot place this record.",
      ruleVersion: verdict.version,
      beforeStatus: before,
      afterStatus: before,
    };
  }

  if (row.incidentDate && row.incidentDate.getTime() > row.occurredAt.getTime() + FUTURE_SKEW_MS) {
    return {
      kind: "review",
      checkName: "event_date",
      reason: "Event date is later than the publication date; one of the two dates is wrong.",
      ruleVersion: verdict.version,
      beforeStatus: before,
      afterStatus: before,
    };
  }
  if (row.occurredAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    return {
      kind: "review",
      checkName: "event_date",
      reason: "Publication date is in the future; the record cannot be dated reliably.",
      ruleVersion: verdict.version,
      beforeStatus: before,
      afterStatus: before,
    };
  }

  return keep(verdict.reason, before);
}

export interface DailyQualityDuplicateFinding {
  incidentId: number;
  reason: string;
  duplicateOf: number;
}

/**
 * Duplicate-event review, using the product's existing clustering authority
 * (`event_cluster_key`) rather than a new similarity guess. The earliest record
 * in a cluster is retained as the canonical event and the later ones are FLAGGED
 * — never deleted, because each carries a corroborating source that the single
 * event must keep. Rows without a cluster key are not guessed at.
 */
export function findDuplicateEventFindings(
  rows: readonly DailyQualityCandidate[],
): DailyQualityDuplicateFinding[] {
  const byKey = new Map<string, DailyQualityCandidate[]>();
  for (const row of rows) {
    const key = row.eventClusterKey?.trim();
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }
  const findings: DailyQualityDuplicateFinding[] = [];
  for (const [, bucket] of byKey) {
    if (bucket.length < 2) continue;
    const ordered = [...bucket].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id - b.id,
    );
    const canonical = ordered[0]!;
    for (const duplicate of ordered.slice(1)) {
      findings.push({
        incidentId: duplicate.id,
        duplicateOf: canonical.id,
        reason: `Same event as incident ${canonical.id} (shared event cluster). Corroborating source retained.`,
      });
    }
  }
  return findings;
}

/**
 * Next due time from the last SUCCESSFUL completion. A failed or skipped run
 * must not push this forward, or a persistently broken routine would look
 * permanently up to date.
 */
export const DAILY_QUALITY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function nextDailyQualityDueAt(
  lastSuccessAt: Date | null | undefined,
  intervalMs: number = DAILY_QUALITY_INTERVAL_MS,
): Date {
  if (!lastSuccessAt) return new Date(0);
  return new Date(lastSuccessAt.getTime() + intervalMs);
}

export function isDailyQualityDue(
  lastSuccessAt: Date | null | undefined,
  now: Date = new Date(),
  intervalMs: number = DAILY_QUALITY_INTERVAL_MS,
): boolean {
  return now.getTime() >= nextDailyQualityDueAt(lastSuccessAt, intervalMs).getTime();
}
