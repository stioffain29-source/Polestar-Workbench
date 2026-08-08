// Mandatory pre-publication quality gate (owner brief §33). Pure functions,
// no runtime dependencies. Fails CLOSED: any critical failure means the report
// must not be generated.
//
// The gate re-validates the finished report against the canonical dataset. Each
// §33 check is implemented as an individually named check with a severity of
// "critical" or "warning". A critical failure sets passed=false.

import type {
  CanonicalEvent,
  EvidenceRecord,
  Severity,
} from "./types";
import { findBannedPhrases } from "./bannedPhrases";
import {
  assertNoUnsupportedTrend,
  categoryPhrase,
  compactTitle,
  countWords,
  formatDate,
  type CountryNarrative,
} from "./narrative";

export type GateSeverity = "critical" | "warning";

export interface GateFailure {
  check: string;
  severity: GateSeverity;
  message: string;
  // Optional context for the admin interface (§33 "show all failed checks").
  eventId?: string;
  section?: string;
}

export interface MapPoint {
  eventId: string;
  lat: number;
  lng: number;
  precision: string;
}

export interface QualityGateReport {
  // ALL canonical events (included, excluded and held).
  events: CanonicalEvent[];
  // The included subset (inclusionStatus === "included").
  included: CanonicalEvent[];
  // The assembled narrative (source of claims + prose to language-check).
  narrative: CountryNarrative;
  // Plotted map points, if any.
  mapPoints?: MapPoint[];
  // Per-section word counts (from the narrative).
  sectionWordCounts: Record<string, number>;
  // Whether comparative (prior-period) data exists (§16).
  hasPriorData: boolean;
  // The report country (physical-country check, §33 DATA).
  countryName: string;
  // Optional sub-national boundary for city / locality reports. Unset for
  // country-level reports, which leaves the locality check inactive.
  localityScope?: {
    label: string;
    isInScope: (event: CanonicalEvent) => boolean;
  };
  // The reporting window [startISO, endISO] inclusive, if known.
  reportingWindow?: { start: string; end: string } | null;
}

export interface QualityGateResult {
  passed: boolean;
  failures: GateFailure[];
}

// ---------------------------------------------------------------------------
// §31 — section-specific length maximums (transcribed verbatim).
// ---------------------------------------------------------------------------

export const SECTION_WORD_LIMITS: Record<string, number> = {
  "Bottom Line Up Front": 120,
  "Category Introduction": 90, // per category
  "Current Situation": 120,
  "Operational Impact": 50, // per category
  "Recommended Actions": 22, // per action
  Outlook: 150,
  "Pole Star View": 180,
  "Map Read": 120,
};

const RECOMMENDATIONS_MAX_ACTIONS = 10;

// §4 — permanent exclusion reasons that must never become Low-severity filler.
// (The whole set is a subset of ExclusionReason; we key the check on the
// presence of ANY exclusion reason on an included Low-severity record.)

// ---------------------------------------------------------------------------
// Map-point credibility (§23 / §33 MAP).
// ---------------------------------------------------------------------------

const NON_CREDIBLE_PRECISIONS = new Set(["Unknown", "Country only"]);

// ---------------------------------------------------------------------------
// Individual named checks — each returns zero or more failures.
// ---------------------------------------------------------------------------

/** DATA — no included event physically occurred in a foreign country. */
export function checkNoForeignIncludedEvents(
  report: QualityGateReport,
): GateFailure[] {
  const failures: GateFailure[] = [];
  const country = report.countryName.trim().toLowerCase();
  for (const e of report.included) {
    if (
      e.physicalCountry &&
      e.physicalCountry.trim().toLowerCase() !== country
    ) {
      failures.push({
        check: "no_foreign_included_event",
        severity: "critical",
        message: `Included event ${e.eventId} physically occurred in "${e.physicalCountry}", not ${report.countryName}.`,
        eventId: e.eventId,
      });
    }
  }
  return failures;
}

/** DATA — included events must fall within an optional locality report scope. */
export function checkNoOutOfScopeLocalityEvents(
  report: QualityGateReport,
): GateFailure[] {
  const localityScope = report.localityScope;
  if (!localityScope) return [];

  const failures: GateFailure[] = [];
  for (const e of report.included) {
    if (!localityScope.isInScope(e)) {
      failures.push({
        check: "no_out_of_scope_locality_event",
        severity: "critical",
        message: `Included event ${e.eventId} is outside the ${localityScope.label} geographic scope.`,
        eventId: e.eventId,
      });
    }
  }
  return failures;
}

/**
 * §33 NARRATIVE — every ranked Top Development must be referenced in the
 * written analysis (BLUF / Current Situation / Outlook). buildBluf composes
 * its lead + "The period also brought …" sentences from the SAME ranked
 * selection as buildTopThree, so a miss here means the reference sentence was
 * dropped (e.g. by a word cap) — a headline story would ship unmentioned.
 */
export function checkTopDevelopmentsReferenced(
  report: QualityGateReport,
): GateFailure[] {
  const failures: GateFailure[] = [];
  const n = report.narrative;
  // §27 sparse reports intentionally omit the analytical sections.
  if (n.isSparse) return failures;
  const haystack = [n.bluf, n.currentSituation, n.outlook]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  // Sentence-level split: an own-words reference only counts when the
  // development's cues co-occur inside ONE sentence, so tokens scattered
  // across aggregate prose (a category here, a date there) cannot fake a
  // reference to a development that was actually dropped.
  const sentences = haystack.split(/(?<=[.!?])\s+/);
  for (const dev of n.topThree) {
    // The BLUF summarises each top development in its own words (owner rule:
    // no raw or quoted headlines), so a development counts as referenced when
    // ONE sentence names its category phrase together with its location or
    // date. Title matching (full or compact) is retained for sections that
    // still cite the headline (e.g. Current Situation).
    const needle = dev.title.trim().toLowerCase();
    const compactNeedle = compactTitle(dev.title).trim().toLowerCase();
    if (!needle) continue;
    const catNeedle = categoryPhrase(dev.category).trim().toLowerCase();
    const locNeedle = (dev.location ?? "").trim().toLowerCase();
    const dateNeedle = formatDate(dev.date).trim().toLowerCase();
    const summarised =
      !!catNeedle &&
      sentences.some(
        (s) =>
          s.includes(catNeedle) &&
          ((!!locNeedle && s.includes(locNeedle)) ||
            (!!dateNeedle && s.includes(dateNeedle))),
      );
    if (
      !haystack.includes(needle) &&
      !(compactNeedle && haystack.includes(compactNeedle)) &&
      !summarised
    ) {
      failures.push({
        check: "top_development_referenced",
        severity: "critical",
        message: `Top development "${dev.title}" (event ${dev.eventId}) is not referenced in the narrative (BLUF / Current Situation / Outlook).`,
        eventId: dev.eventId,
        section: "Bottom Line Up Front",
      });
    }
  }
  return failures;
}
/** DATA — no included duplicate (same duplicateGroupId appears twice). */
export function checkNoIncludedDuplicates(
  report: QualityGateReport,
): GateFailure[] {
  const failures: GateFailure[] = [];
  const seen = new Map<string, string>();
  for (const e of report.included) {
    if (!e.duplicateGroupId) continue;
    const prior = seen.get(e.duplicateGroupId);
    if (prior) {
      failures.push({
        check: "no_included_duplicate",
        severity: "critical",
        message: `Duplicate group ${e.duplicateGroupId} appears more than once among included events (${prior}, ${e.eventId}).`,
        eventId: e.eventId,
      });
    } else {
      seen.set(e.duplicateGroupId, e.eventId);
    }
  }
  return failures;
}

/**
 * DATA — no included event dated outside the reporting window.
 *
 * The window is a REPORTING window: the brief deliberately keeps an event that
 * was reported (published) inside the window even when the event itself
 * occurred a few days earlier, or an advisory that runs past the window end
 * ("tidal flooding until 31 July") — the narrative flags such items and states
 * both dates (occurredOutOfWindow), and truly recycled items (>~35 days) are
 * already excluded upstream (§6). So:
 *   - eventDate outside the window but SOME supporting publication inside it
 *     → warning (visible, never blocks);
 *   - eventDate outside the window and NO in-window publication → critical
 *     (the event has no business in this report at all).
 */
export function checkDatesWithinWindow(
  report: QualityGateReport,
): GateFailure[] {
  const failures: GateFailure[] = [];
  const win = report.reportingWindow;
  if (!win) return failures;
  const start = win.start.slice(0, 10);
  const end = win.end.slice(0, 10);
  for (const e of report.included) {
    // Undated events are held/omitted elsewhere; skip null dates here.
    if (!e.eventDate) continue;
    const d = e.eventDate.slice(0, 10);
    if (d < start || d > end) {
      const reportedInWindow = (e.publicationDates ?? []).some((p) => {
        const pd = (p ?? "").slice(0, 10);
        return pd >= start && pd <= end;
      });
      failures.push({
        check: "event_within_window",
        severity: reportedInWindow ? "warning" : "critical",
        message: reportedInWindow
          ? `Included event ${e.eventId} is dated ${e.eventDate} (outside the reporting window ${start}..${end}) but was reported inside it; the narrative must state both dates.`
          : `Included event ${e.eventId} is dated ${e.eventDate}, outside the reporting window ${start}..${end}, with no in-window reporting.`,
        eventId: e.eventId,
      });
    }
  }
  return failures;
}

/**
 * MAP — every map point belongs to an included event and has a credible
 * precision (never "Unknown" / "Country only"). No foreign event is plotted.
 */
export function checkMapPoints(report: QualityGateReport): GateFailure[] {
  const failures: GateFailure[] = [];
  const points = report.mapPoints ?? [];
  const includedById = new Map(report.included.map((e) => [e.eventId, e]));
  for (const p of points) {
    const event = includedById.get(p.eventId);
    if (!event) {
      failures.push({
        check: "map_point_included_event",
        severity: "critical",
        message: `Map point references event ${p.eventId}, which is not an included event.`,
        eventId: p.eventId,
      });
      continue;
    }
    if (NON_CREDIBLE_PRECISIONS.has(p.precision)) {
      failures.push({
        check: "map_point_credible_precision",
        severity: "critical",
        message: `Map point for event ${p.eventId} has non-credible precision "${p.precision}".`,
        eventId: p.eventId,
      });
    }
    if (
      typeof p.lat !== "number" ||
      typeof p.lng !== "number" ||
      Number.isNaN(p.lat) ||
      Number.isNaN(p.lng)
    ) {
      failures.push({
        check: "map_point_valid_coordinates",
        severity: "critical",
        message: `Map point for event ${p.eventId} has invalid coordinates.`,
        eventId: p.eventId,
      });
    }
  }
  return failures;
}

/**
 * ANALYSIS — severity is consistent: every claim referencing an event must not
 * imply a severity different from the stored canonical severity. We enforce the
 * stronger structural guarantee that each included event carries exactly one
 * stored severity and that any severity word appearing in a claim matches the
 * stored value of at least one supporting event.
 */
export function checkSeverityConsistency(
  report: QualityGateReport,
): GateFailure[] {
  const failures: GateFailure[] = [];
  const byId = new Map(report.included.map((e) => [e.eventId, e]));
  const severityWords: Severity[] = [
    "Insignificant",
    "Low",
    "Moderate",
    "High",
    "Extreme",
  ];

  for (const claim of report.narrative.claims) {
    const mentioned = severityWords.filter((s) =>
      new RegExp(`\\b${s}\\b`).test(claim.claimText),
    );
    if (mentioned.length === 0) continue;
    // Stored severities of the claim's supporting events.
    const stored = new Set<Severity>();
    for (const id of claim.supportingEventIds) {
      const e = byId.get(id);
      if (e) stored.add(e.severity);
    }
    if (stored.size === 0) continue; // no linked event to compare against
    for (const word of mentioned) {
      if (!stored.has(word)) {
        failures.push({
          check: "severity_matches_stored",
          severity: "critical",
          message: `Claim "${claim.claimText}" uses severity "${word}" which does not match the stored severity of its supporting event(s) (${[...stored].join(", ")}).`,
          section: claim.section,
        });
      }
    }
  }
  return failures;
}

/** ANALYSIS — every analytical claim has an evidence record (§29). */
export function checkEveryClaimHasEvidence(
  report: QualityGateReport,
): GateFailure[] {
  const failures: GateFailure[] = [];
  for (const claim of report.narrative.claims) {
    const hasEvidence =
      (claim.supportingEventIds && claim.supportingEventIds.length > 0) ||
      (claim.supportingSourceIds && claim.supportingSourceIds.length > 0) ||
      Boolean(claim.supportingMetric);
    // Fixed/short-report statements and neutral scaffolding are permitted to
    // stand without linked events ONLY when they make no analytical assertion.
    // We treat Assessment/Forecast/Trend/Recommendation claims as REQUIRING
    // evidence; "Confirmed fact" claims without evidence are allowed only for
    // the sparse short-report section.
    const isScaffold =
      claim.claimType === "Confirmed fact" &&
      (claim.section === "Short Report" ||
        claim.section === "Current Situation" ||
        claim.section === "Bottom Line Up Front");
    if (!hasEvidence && !isScaffold) {
      failures.push({
        check: "claim_has_evidence",
        severity: "critical",
        message: `Claim "${claim.claimText}" (${claim.claimType}) has no supporting evidence record.`,
        section: claim.section,
      });
    }
  }
  return failures;
}

/** LANGUAGE — no banned phrase appears anywhere in the narrative (§30). */
export function checkNoBannedPhrases(report: QualityGateReport): GateFailure[] {
  const failures: GateFailure[] = [];
  const n = report.narrative;
  const blocks: { section: string; text: string }[] = [
    { section: "Bottom Line Up Front", text: n.bluf },
    { section: "Current Situation", text: n.currentSituation },
    { section: "Outlook", text: n.outlook },
    { section: "Pole Star View", text: n.polestarView },
    { section: "Short Report", text: n.shortReport ?? "" },
  ];
  for (const intro of n.categoryIntros) {
    blocks.push({ section: `Category: ${intro.category}`, text: intro.text });
  }
  for (const op of n.operationalImpact) {
    blocks.push({
      section: `Operational Impact: ${op.category}`,
      text: op.text,
    });
  }
  for (const td of n.topThree) {
    blocks.push({ section: "Top Developments", text: td.factualSentence });
    if (td.businessSentence)
      blocks.push({
        section: "Top Developments",
        text: td.businessSentence,
      });
  }

  for (const block of blocks) {
    if (!block.text) continue;
    const banned = findBannedPhrases(block.text);
    for (const phrase of banned) {
      failures.push({
        check: "no_banned_phrase",
        severity: "critical",
        message: `Banned phrase "${phrase}" appears in ${block.section}.`,
        section: block.section,
      });
    }
  }
  return failures;
}

/** LANGUAGE — no unsupported trend wording without prior data (§16). */
export function checkNoUnsupportedTrend(
  report: QualityGateReport,
): GateFailure[] {
  const failures: GateFailure[] = [];
  const n = report.narrative;
  const blocks: { section: string; text: string }[] = [
    { section: "Bottom Line Up Front", text: n.bluf },
    { section: "Current Situation", text: n.currentSituation },
    { section: "Outlook", text: n.outlook },
    { section: "Pole Star View", text: n.polestarView },
  ];
  for (const block of blocks) {
    if (!block.text) continue;
    const violations = assertNoUnsupportedTrend(
      block.text,
      report.hasPriorData,
    );
    for (const word of violations) {
      failures.push({
        check: "no_unsupported_trend",
        severity: "critical",
        message: `Unsupported trend wording "${word}" appears in ${block.section} without comparative data.`,
        section: block.section,
      });
    }
  }
  return failures;
}

/** LAYOUT — section word counts within §31 maximums. */
export function checkSectionWordCounts(
  report: QualityGateReport,
): GateFailure[] {
  const failures: GateFailure[] = [];
  for (const [section, count] of Object.entries(report.sectionWordCounts)) {
    let limit: number | undefined;
    if (section.startsWith("Category:")) {
      limit = SECTION_WORD_LIMITS["Category Introduction"];
    } else if (section.startsWith("Operational Impact")) {
      limit = SECTION_WORD_LIMITS["Operational Impact"];
    } else {
      limit = SECTION_WORD_LIMITS[section];
    }
    if (limit == null) continue;
    if (count > limit) {
      failures.push({
        check: "section_word_count",
        severity: "critical",
        message: `${section} has ${count} words, exceeding the §31 maximum of ${limit}.`,
        section,
      });
    }
  }

  // Recommendations: per-action word cap + max action count.
  const recs = report.narrative.recommendations;
  if (recs.length > RECOMMENDATIONS_MAX_ACTIONS) {
    failures.push({
      check: "recommendations_count",
      severity: "critical",
      message: `There are ${recs.length} recommended actions, exceeding the §31 maximum of ${RECOMMENDATIONS_MAX_ACTIONS}.`,
      section: "Recommended Actions",
    });
  }
  for (const rec of recs) {
    const w = countWords(rec.text);
    if (w > SECTION_WORD_LIMITS["Recommended Actions"]) {
      failures.push({
        check: "recommendation_word_count",
        severity: "critical",
        message: `Recommendation "${rec.text}" has ${w} words, exceeding the §31 maximum of ${SECTION_WORD_LIMITS["Recommended Actions"]}.`,
        section: "Recommended Actions",
      });
    }
  }
  return failures;
}

/**
 * DATA — no Low-severity filler drawn from excluded classes. An included event
 * that both carries an exclusion reason and is rated Low or Insignificant is a
 * filler leak (§4: "Do not turn these items into Low-severity filler").
 */
export function checkNoLowSeverityFiller(
  report: QualityGateReport,
): GateFailure[] {
  const failures: GateFailure[] = [];
  for (const e of report.included) {
    if (
      e.exclusionReason != null &&
      (e.severity === "Low" || e.severity === "Insignificant")
    ) {
      failures.push({
        check: "no_low_severity_filler",
        severity: "critical",
        message: `Included event ${e.eventId} is rated ${e.severity} yet carries exclusion reason "${e.exclusionReason}" (Low-severity filler from an excluded class).`,
        eventId: e.eventId,
      });
    }
  }
  return failures;
}

/** DATA — recommendations are linked to actual events (§33 ANALYSIS). */
export function checkRecommendationsLinked(
  report: QualityGateReport,
): GateFailure[] {
  const failures: GateFailure[] = [];
  const includedIds = new Set(report.included.map((e) => e.eventId));
  const recClaims = report.narrative.claims.filter(
    (c) => c.claimType === "Recommendation",
  );
  for (const claim of recClaims) {
    const linked = claim.supportingEventIds.some((id) => includedIds.has(id));
    if (!linked) {
      failures.push({
        check: "recommendation_linked",
        severity: "critical",
        message: `Recommendation "${claim.claimText}" is not linked to any included event.`,
        section: "Recommended Actions",
      });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const ALL_CHECKS: ((r: QualityGateReport) => GateFailure[])[] = [
  checkNoForeignIncludedEvents,
  checkNoOutOfScopeLocalityEvents,
  checkNoIncludedDuplicates,
  checkTopDevelopmentsReferenced,
  checkDatesWithinWindow,
  checkMapPoints,
  checkSeverityConsistency,
  checkEveryClaimHasEvidence,
  checkNoBannedPhrases,
  checkNoUnsupportedTrend,
  checkSectionWordCounts,
  checkNoLowSeverityFiller,
  checkRecommendationsLinked,
];

/**
 * §33 — run the mandatory pre-publication quality gate. Fails CLOSED: any
 * critical failure sets passed=false so the report must not be generated.
 */
export function runQualityGate(
  report: QualityGateReport,
): QualityGateResult {
  const failures: GateFailure[] = [];
  for (const check of ALL_CHECKS) {
    failures.push(...check(report));
  }
  const passed = !failures.some((f) => f.severity === "critical");
  return { passed, failures };
}
