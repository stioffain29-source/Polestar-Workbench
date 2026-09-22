// Fuel Watch consistency gate.
//
// Fail-closed validation run over the FINAL EFFECTIVE narrative text (analyst
// edit -> AI -> deterministic, exactly what the preview and PDF render)
// against the canonical FuelReportFacts. A non-empty failure list blocks BOTH
// the on-screen preview body and the PDF export (mirrors the Cargo Watch
// gate), with specific validation errors — never a polished-but-contradictory
// report.
//
// Checks (spec):
//   1. MARKET_DIRECTION  — trend wording about Brent/WTI/jet/crude must agree
//      with the calculated direction for that indicator.
//   2. PRIMARY_PRESSURE  — leader-claim phrasing must name the canonical
//      primary pressure point; banned entirely when pressure is distributed.
//   3. COUNT_TRACEABLE   — any "N records/incidents/events" claim must equal a
//      facts number (total, a country count, a severity count, distinct dates).
//   4. SEVERITY_TERMS    — an asserted overall severity must match the
//      computed overall severity; only the five tiers are valid severity words.
//   5. CURRENT_CONDITION — asserting a live shortage/rationing/closure class
//      requires that class in facts.currentConditionSignals; otherwise it may
//      appear only as a watch indicator.
//
// All matching is deliberately conservative (sentence-scoped, anchored word
// lists) so the gate catches real contradictions without false-blocking
// ordinary analyst prose.

import type { FuelReportFacts } from "./fuelReportFacts";
import type { FuelJudgement } from "./fuelCanonicalFacts";
import {
  auditFinalReportEvidence,
  assertFinalReportEvidence,
  type FinalReportEvidenceAuditIssue,
  type FinalReportTypedReference,
} from "./finalReportEvidenceAudit";

export interface FuelConsistencyIssue {
  code:
    | "MARKET_DIRECTION"
    | "PRIMARY_PRESSURE"
    | "COUNT_TRACEABLE"
    | "SEVERITY_TERMS"
    | "CURRENT_CONDITION"
    | "JUDGEMENT_CONSISTENCY";
  section: string;
  message: string;
  level: "ERROR";
}

export class FuelReportConsistencyError extends Error {
  issues: FuelConsistencyIssue[];
  constructor(issues: FuelConsistencyIssue[]) {
    super(
      `Fuel Watch consistency gate failed: ${issues
        .map((i) => `[${i.code}] ${i.section}: ${i.message}`)
        .join(" | ")}`,
    );
    this.name = "FuelReportConsistencyError";
    this.issues = issues;
  }
}

/** The effective (rendered) narrative texts. Null/empty sections are skipped. */
export interface FuelEffectiveSections {
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  polestarView?: string | null;
  marketRead?: string | null;
  operationalRead?: string | null;
  regionalHighlights?: string | null;
  implications?: string | null;
  watchNext?: string | null;
  provenance?: FuelSectionsProvenance;
  analystEditReviewRequired?: boolean;
}

function fuelForwardReferences(
  facts: FuelReportFacts,
  indicators: string[],
  provenance?: FuelSectionsProvenance,
  renderedWatchNext?: string | null,
): FinalReportTypedReference[] {
  const renderedItems = (renderedWatchNext ?? "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const count = Math.max(
    indicators.length,
    renderedItems.length,
    provenance?.watchNext?.length ?? 0,
  );
  return Array.from({ length: count }, (_, index) => {
    const indicator = indicators[index] ?? renderedItems[index] ?? "";
    return ({
    id: `fuel-forward-${index}`,
    type: "forward-indicator" as const,
    // Retain only the evidence explicitly attached to this generated watch
    // item. Do not manufacture support from the lead incident.
    text: (() => {
      const support = provenance?.watchNext?.[index]?.supportingIncidentIds ?? [];
      const anchors = facts.incidents
        .filter((incident) => support.includes(String(incident.id)))
        .flatMap((incident) => [
          incident.title,
          incident.summary ?? "",
          incident.country ?? "",
          incident.location ?? "",
        ]);
      return [
        provenance?.watchNext?.[index]?.verifiedText
          ?? renderedItems[index]
          ?? indicator,
        ...anchors,
      ].filter(Boolean).join(" ");
    })(),
    evidenceId: (() => {
      const support = provenance?.watchNext?.[index]?.supportingIncidentIds ?? [];
      return facts.incidents.find((incident) => support.includes(String(incident.id)))?.id;
    })(),
    });
  });
}

/** Thin Fuel adapter for the shared, topic-independent final evidence audit. */
export function validateFuelFinalEvidenceAudit(
  facts: FuelReportFacts,
  sections: FuelEffectiveSections,
  validatedForwardIndicators: string[],
): FinalReportEvidenceAuditIssue[] {
  const proseSections = Object.fromEntries(
    Object.entries(sections).filter(([, value]) => typeof value === "string"),
  ) as Record<string, string | null | undefined>;
  return auditFinalReportEvidence({
    topic: "fuel",
    issueDate: facts.issueDate,
    window: facts.reportWindow,
    canonicalEvidenceConfidence: facts.evidenceConfidence,
    evidence: [
      ...facts.incidents.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        country: r.country,
        location: r.location,
        occurredAt: r.occurredAt,
        supportedClaims: r.supportedClaims,
      })),
      ...facts.market.indicators
        .filter((m) => m.current !== null)
        .map((m) => ({
          id: `market-${m.key}`,
          title: m.label,
          occurredAt: m.currentDate,
          marketComparison: {
            indicator: m.label,
            currentDate: m.currentDate,
            referenceDate: m.referenceDate,
            comparisonScope: m.comparisonScope,
            direction: m.direction,
            currentValue: m.currentValue,
            referenceValue: m.referenceValue,
            pctChange: m.pctChange,
            unit: m.unit,
          },
        })),
    ],
    sections: proseSections,
    validatedForwardIndicators: fuelForwardReferences(
      facts,
      validatedForwardIndicators,
      sections.provenance,
      sections.watchNext,
    ),
    typedReferences: [
      ...facts.incidents.map((r) => ({
        id: r.evidenceFamilyId ?? `incident-${r.id ?? r.occurredAt}`,
        type: "development" as const,
        text: [r.title, r.summary, r.country, r.location].filter(Boolean).join(" "),
        evidenceId: r.id,
      })),
      ...facts.market.indicators.filter((m) => m.current !== null).map((m) => ({
        id: `market-${m.key}`,
        type: "market-observation" as const,
        text: `${m.label} ${m.direction ?? "unavailable"} ${m.currentValue ?? "unavailable"} ${m.unit ?? ""} versus ${m.referenceValue ?? "unavailable"} (${m.pctChange ?? "unavailable"}%) ${m.currentDate ?? "undated"} ${m.comparisonScope}`,
      })),
    ],
  });
}

export function assertFuelFinalEvidenceAudit(
  facts: FuelReportFacts,
  sections: FuelEffectiveSections,
  validatedForwardIndicators: string[],
): void {
  const proseSections = Object.fromEntries(
    Object.entries(sections).filter(([, value]) => typeof value === "string"),
  ) as Record<string, string | null | undefined>;
  assertFinalReportEvidence({
    topic: "fuel",
    issueDate: facts.issueDate,
    window: facts.reportWindow,
    canonicalEvidenceConfidence: facts.evidenceConfidence,
    evidence: [
      ...facts.incidents.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        country: r.country,
        location: r.location,
        occurredAt: r.occurredAt,
        supportedClaims: r.supportedClaims,
      })),
      ...facts.market.indicators.filter((m) => m.current !== null).map((m) => ({
        id: `market-${m.key}`,
        title: m.label,
        occurredAt: m.currentDate,
        marketComparison: {
          indicator: m.label,
          currentDate: m.currentDate,
          referenceDate: m.referenceDate,
          comparisonScope: m.comparisonScope,
            direction: m.direction,
            currentValue: m.currentValue,
            referenceValue: m.referenceValue,
            pctChange: m.pctChange,
            unit: m.unit,
        },
      })),
    ],
    sections: proseSections,
    validatedForwardIndicators: fuelForwardReferences(
      facts,
      validatedForwardIndicators,
      sections.provenance,
      sections.watchNext,
    ),
    typedReferences: [
      ...facts.incidents.map((r) => ({
        id: r.evidenceFamilyId ?? `incident-${r.id ?? r.occurredAt}`,
        type: "development" as const,
        text: [r.title, r.summary, r.country, r.location].filter(Boolean).join(" "),
        evidenceId: r.id,
      })),
      ...facts.market.indicators.filter((m) => m.current !== null).map((m) => ({
        id: `market-${m.key}`,
        type: "market-observation" as const,
        text: `${m.label} ${m.direction ?? "unavailable"} ${m.currentValue ?? "unavailable"} ${m.unit ?? ""} versus ${m.referenceValue ?? "unavailable"} (${m.pctChange ?? "unavailable"}%) ${m.currentDate ?? "undated"} ${m.comparisonScope}`,
      })),
    ],
  });
}

// Sections that speak in the present tense about this window. Watch Next is
// exempt from the current-condition check by design (potential developments
// belong there).
const CURRENT_SECTIONS = new Set([
  "executiveSummary",
  "situation",
  "whatHappened",
  "whatMatters",
  "marketRead",
  "operationalRead",
  "regionalHighlights",
  "polestarView",
]);

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

// Direction wording sets. Kept tight: only words that unambiguously assert a
// direction for a price/market series.
const RISING_RE =
  /\b(rise|rising|rose|risen|climbing|climbed|surging|surged|rallying|rallied|jumped|spiking|spiked|firming|firmed|gained|advancing|advanced|up sharply|moved higher|pushed higher|higher on the week)\b/i;
const FALLING_RE =
  /\b(fall|falling|fell|declining|declined|easing|eased|retreating|retreated|slumped|sliding|slid|dropped|dropping|pulled back|pullback|moved lower|pushed lower|lower on the week|softened|softening)\b/i;

// A sentence must carry price/market-movement context before its direction
// wording is validated against the calculated series direction. "costs"
// counts: "jet fuel costs eased" is a series claim even without the word
// "price".
const PRICE_CONTEXT_RE =
  /\b(price|prices|pricing|costs?|\$|usd|bbl|barrel|gallon|per[- ]litre|market|trading|traded|close|closed|benchmark|on the week|this week|over th(?:e|is) (?:week|window|period))\b/i;

const INDICATOR_TOKENS: { key: "brent" | "wti" | "jet" | "crude"; re: RegExp }[] = [
  { key: "brent", re: /\bbrent\b/i },
  { key: "wti", re: /\bwti\b|west\s*texas/i },
  { key: "jet", re: /\bjet\s*fuel\b|\bkerosene\b/i },
  { key: "crude", re: /\bcrude\b|\boil price/i },
];

const CLAIM_QUALIFIER_RE =
  /\b(could|may|might|would|if\b|unless\b|conditional|contingen(?:cy|t)|potential|risk of|watch(?:ing)? for|monitor|previously|historically|last (?:week|month|year)|before the reporting period|was once)\b/i;

function localClauseBounds(text: string, at: number): { start: number; end: number } {
  const breaks = /\b(?:while|but|whereas|although|however)\b|[;:—]/gi;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(breaks)) {
    const index = match.index ?? 0;
    if (index < at) start = index + match[0].length;
    else if (index > at) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function localClause(text: string, at: number): string {
  const { start, end } = localClauseBounds(text, at);
  return text.slice(start, end);
}

function indicatorClause(sentence: string, indicator: RegExp): string {
  const match = sentence.match(indicator);
  return match?.index == null ? sentence : localClause(sentence, match.index);
}

function hasAssertedDirection(sentence: string, direction: RegExp): boolean {
  const global = new RegExp(direction.source, `${direction.flags.replace("g", "")}g`);
  for (const match of sentence.matchAll(global)) {
    const at = match.index ?? 0;
    const clauseStart = Math.max(
        sentence.lastIndexOf(".", at),
        sentence.lastIndexOf(";", at),
        sentence.lastIndexOf(":", at),
        sentence.lastIndexOf("—", at),
      ) + 1;
    const before = sentence.slice(clauseStart, at);
    const after = sentence.slice(at + match[0].length, at + match[0].length + 30);
    if (
      !/\b(?:not|no|never|without)\b/i.test(before.slice(-24)) &&
      !CLAIM_QUALIFIER_RE.test(before) &&
      !/^\s*(?:if|unless)\b/i.test(after)
    ) {
      return true;
    }
  }
  return false;
}

function directionConflict(
  sentence: string,
  calculated: NonNullable<FuelReportFacts["market"]["crudeDirection"]>,
): string | null {
  const saysRising = hasAssertedDirection(sentence, RISING_RE);
  const saysFalling = hasAssertedDirection(sentence, FALLING_RE);
  if (calculated === "rising" && saysFalling && !saysRising)
    return "describes it as falling but the calculated direction is rising";
  if (calculated === "falling" && saysRising && !saysFalling)
    return "describes it as rising but the calculated direction is falling";
  if (
    (calculated === "broadly stable" || calculated === "unchanged") &&
    (saysRising !== saysFalling)
  )
    return `describes a clear ${saysRising ? "rise" : "fall"} but the calculated move is within the neutral band (${calculated})`;
  return null;
}

function dirByKeyFromFacts(
  facts: FuelReportFacts,
): Record<string, NonNullable<FuelReportFacts["market"]["crudeDirection"]> | null> {
  return {
    brent: facts.market.indicators.find((m) => m.key === "brent")?.direction ?? null,
    wti: facts.market.indicators.find((m) => m.key === "wti")?.direction ?? null,
    jet: facts.market.indicators.find((m) => m.key === "jet")?.direction ?? null,
    crude: facts.market.crudeDirection,
  };
}

// Leader-claim phrasing: "X is the clearest/primary/main/leading pressure
// point", "pressure is concentrated in X", etc.
const LEADER_CLAIM_RE =
  /\b(clearest|primary|main|leading|dominant|principal|biggest|foremost)\b[^.!?]{0,60}\bpressure point\b(?!s)|\bpressure\b[^.!?]{0,40}\bconcentrated in\b/i;

const COUNT_CLAIM_RE =
  /\b(\d{1,4})\s+(?:qualifying\s+|fuel[- ]related\s+|distinct\s+|confirmed\s+)?(incidents?|records?|events?|reports?|dates?|days?)\b/gi;

const VOLUME_PROSE_RE =
  /\b(?:incidents?|records?)\s+(?:were\s+)?(?:logged|recorded|carried)\b|\b(?:reporting|qualifying)\s+(?:record|incident)\b|\b(?:led by|leads with)\s+[“"]/i;

const OVERALL_SEVERITY_RE =
  /\boverall severity\b[^.!?]{0,40}\b(insignificant|low|moderate|high|extreme)\b|\b(insignificant|low|moderate|high|extreme)\b[^.!?]{0,25}\boverall severity\b|\brated\s+(insignificant|low|moderate|high|extreme)\s+overall\b/i;

// Live current-condition assertions, mapped to the facts signal class they
// require. Modality and negation are checked at the matched claim below.
const CONDITION_CLAIMS: { key: string; re: RegExp; what: string }[] = [
  {
    key: "shortage",
    re: /\b(shortages?\s+(?:are|is|remain|persist)|rationing\s+(?:is|remains)\s+in\s+(?:effect|place)|fuel\s+is\s+(?:unavailable|running out))\b/i,
    what: "an active fuel shortage/rationing condition",
  },
  {
    key: "chokepoint",
    re: /\b(hormuz|bab[- ]el[- ]mandeb|suez|strait)\b[^.!?]{0,60}\b(is|are|remains?)\s+(closed|blocked|shut|suspended)\b/i,
    what: "a live chokepoint closure",
  },
  {
    key: "refinery-disruption",
    re: /\brefiner(y|ies)\b[^.!?]{0,60}\b(is|are|remains?)\s+(offline|shut|halted|down)\b/i,
    what: "a live refinery outage",
  },
];

function pctNumbersIn(text: string): number[] {
  return pctMatchesIn(text).map((match) => match.value);
}

function pctMatchesIn(text: string): Array<{ value: number; index: number }> {
  const out: Array<{ value: number; index: number }> = [];
  const re = /(-?\d+(?:\.\d+)?)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ value: parseFloat(m[1]), index: m.index });
  return out;
}

/** Wording that presents a figure as a movement in a price series. */
const BENCHMARK_MOVE_RE =
  /\b(up|down|higher|lower|rise|rises|rising|rose|risen|fall|falls|falling|fell|fallen|gain(?:ed|s)?|lost|losses|climb(?:ed|s)?|slipp?ed|slid|jump(?:ed|s)?|surg(?:ed|es)|drop(?:ped|s)?|declin\w*|increas\w*|decreas\w*|chang\w*|mov(?:e|ed|es|ement)|weaker|stronger|on the week|week[-\s]on[-\s]week|versus|against the prior|compared with)\b/i;

/** Subjects that are quantities or terms, not a benchmark price series. */
const NON_PRICE_SUBJECT_RE =
  /\b(flows?|volumes?|shipments?|loadings?|cargo(?:es)?|exports?|imports?|deliver(?:y|ies)|throughput|runs?|utilisation|utilization|capacity|output|production|supply|demand|consumption|inventor(?:y|ies)|stocks?|tariffs?|dut(?:y|ies)|levy|levies|share|margins?|discounts?|premiums?|freight rates?)\b/i;

/** Run the gate. Empty array = clean. */
export function validateFuelReportConsistency(
  facts: FuelReportFacts,
  sections: FuelEffectiveSections,
): FuelConsistencyIssue[] {
  const issues: Array<Omit<FuelConsistencyIssue, "level">> = [];

  const knownPcts = facts.market.indicators
    .map((m) => m.pctChange)
    .filter((v): v is number => v !== null);
  if (facts.market.avgCrudePctChange !== null)
    knownPcts.push(facts.market.avgCrudePctChange);

  const dirByKey = dirByKeyFromFacts(facts);

  for (const [section, raw] of Object.entries(sections)) {
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (!text) continue;

    const sentences = text.split(SENTENCE_SPLIT_RE);

    // 1. Market direction wording. Only sentences that talk about the PRICE/
    // MARKET movement of the indicator are checked — "crude demand softened"
    // is a demand statement, not a direction claim about the price series.
    for (const sentence of sentences) {
      if (!PRICE_CONTEXT_RE.test(sentence)) continue;
      for (const tok of INDICATOR_TOKENS) {
        if (!tok.re.test(sentence)) continue;
        const calc = dirByKey[tok.key];
        if (!calc) continue;
        const conflict = directionConflict(indicatorClause(sentence, tok.re), calc);
        if (conflict) {
          issues.push({
            code: "MARKET_DIRECTION",
            section,
            message: `Sentence about ${tok.key.toUpperCase()} ${conflict}: "${sentence.trim().slice(0, 140)}"`,
          });
        }
      }
    }

    // 2. Primary pressure point.
    for (const sentence of sentences) {
      if (!LEADER_CLAIM_RE.test(sentence)) continue;
      if (facts.pressure.distributed) {
        // Only a claim that crowns a COUNTRY contradicts a distributed
        // picture — thematic leads ("the Gulf chokepoint is the clearest
        // pressure point") are not country rankings and stay allowed.
        const named = facts.countries.find((c) =>
          new RegExp(`\\b${escapeRe(c.name)}\\b`, "i").test(sentence),
        );
        if (named) {
          issues.push({
            code: "PRIMARY_PRESSURE",
            section,
            message: `Names ${named.name} as the leading pressure point but the calculated pressure picture is distributed (no unique leader): "${sentence.trim().slice(0, 140)}"`,
          });
        }
        continue;
      }
      const primary = facts.pressure.primary?.country;
      if (primary && !new RegExp(`\\b${escapeRe(primary)}\\b`, "i").test(sentence)) {
        // The sentence claims a leader — it must be the canonical one. Only
        // flag when it names a DIFFERENT known country as the leader.
        const other = facts.countries.find(
          (c) =>
            c.name.toLowerCase() !== primary.toLowerCase() &&
            new RegExp(`\\b${escapeRe(c.name)}\\b`, "i").test(sentence),
        );
        if (other) {
          issues.push({
            code: "PRIMARY_PRESSURE",
            section,
            message: `Names ${other.name} as the leading pressure point; the calculated primary pressure point is ${primary}.`,
          });
        }
      }
    }

    // 3. Count / source-volume language is banned in analytical prose.
    if (VOLUME_PROSE_RE.test(text)) {
      issues.push({
        code: "COUNT_TRACEABLE",
        section,
        message: `Analytical prose must not carry source-volume language: "${text.match(VOLUME_PROSE_RE)?.[0] ?? text.slice(0, 80)}"`,
      });
    }
    let cm: RegExpExecArray | null;
    COUNT_CLAIM_RE.lastIndex = 0;
    while ((cm = COUNT_CLAIM_RE.exec(text))) {
      issues.push({
        code: "COUNT_TRACEABLE",
        section,
        message: `Analytical prose must not carry incident/record totals: "${cm[0]}"`,
      });
    }

    // 4. Overall severity assertion.
    const sevM = text.match(OVERALL_SEVERITY_RE);
    if (sevM && facts.overallSeverity) {
      const asserted = (sevM[1] ?? sevM[2] ?? sevM[3] ?? "").toLowerCase();
      if (asserted && asserted !== facts.overallSeverity) {
        issues.push({
          code: "SEVERITY_TERMS",
          section,
          message: `Asserts overall severity "${asserted}" but the computed overall severity is "${facts.overallSeverity}".`,
        });
      }
    }

    // 5. Unsupported current-condition claims.
    if (CURRENT_SECTIONS.has(section)) {
      for (const sentence of sentences) {
        for (const claim of CONDITION_CLAIMS) {
          if (
            claim.re.test(sentence) &&
            !claimIsQualified(sentence, claim.re) &&
            !isNegated(sentence, claim.re) &&
            !facts.currentConditionSignals.includes(claim.key)
          ) {
            issues.push({
              code: "CURRENT_CONDITION",
              section,
              message: `Asserts ${claim.what} but no window record supports it: "${sentence.trim().slice(0, 140)}"`,
            });
          }
        }
      }
    }

    // Percentages. Only a figure presented as a MOVEMENT IN A BENCHMARK PRICE
    // SERIES is traced to the calculated price feed, because a benchmark move
    // is the only kind of percentage the feed can confirm. A percentage the
    // reporting carries about something else — a cargo volume, a tariff, a
    // refinery run rate, a margin — is evidence rather than a market claim, so
    // it is left to the evidence checks. The subject is read from the words
    // BEFORE the figure, so a non-price noun later in the clause cannot excuse
    // a fabricated price move ("Brent fell 8% because supply increased").
    for (const sentence of sentences) {
      if (!INDICATOR_TOKENS.some((t) => t.re.test(sentence))) continue;
      for (const { value: pct, index } of pctMatchesIn(sentence)) {
        const { start, end } = localClauseBounds(sentence, index);
        const clause = sentence.slice(start, end);
        const subject = sentence.slice(start, index);
        const claimsBenchmarkMove =
          INDICATOR_TOKENS.some((t) => t.re.test(clause)) &&
          BENCHMARK_MOVE_RE.test(clause) &&
          !NON_PRICE_SUBJECT_RE.test(subject);
        if (!claimsBenchmarkMove) continue;
        const traced = knownPcts.some((k) => Math.abs(k - pct) <= 0.15);
        if (!traced && knownPcts.length > 0) {
          issues.push({
            code: "COUNT_TRACEABLE",
            section,
            message: `Market percentage ${pct}% does not match any calculated indicator change (${knownPcts.map((k) => k.toFixed(1) + "%").join(", ")}).`,
          });
        }
      }
    }
  }

  return issues.map((issue) => ({ ...issue, level: "ERROR" }));
}

const LOWER_COST_RE =
  /\b(?:lower|falling|reduced|easing|eased)\s+(?:fuel\s+|energy\s+|oil\s+)?(?:costs?|prices?)\b|\b(?:fuel\s+|energy\s+|oil\s+)?(?:costs?|prices?)\s+(?:are|remain|have become)\s+(?:lower|falling|reduced|easing)\b/i;
const RELIABLE_SUPPLY_RE =
  /\b(?:fuel\s+|road\s+)?(?:supply|availability|distribution|deliver(?:y|ies))\s+(?:is|are|remains?)\s+(?:reliable|uninterrupted|secure|fully available)\b|\b(?:reliable|uninterrupted|secure|fully available)\s+(?:road\s+)?(?:fuel\s+)?(?:supply|availability|distribution|deliver(?:y|ies))\b|\bno\s+(?:material\s+)?(?:fuel\s+|road\s+)?(?:supply|availability|distribution|delivery)\s+(?:risk|disruption)\b/i;

function isNegated(sentence: string, match: RegExp): boolean {
  const found = sentence.match(match);
  if (!found || found.index == null) return false;
  return /\b(?:not|no|never|without)\b/i.test(
    sentence.slice(Math.max(0, found.index - 24), found.index),
  );
}

function claimIsQualified(sentence: string, match: RegExp): boolean {
  const found = sentence.match(match);
  if (!found || found.index == null) return false;
  const at = found.index;
  const clauseStart = Math.max(
    sentence.lastIndexOf(".", at),
    sentence.lastIndexOf(";", at),
    sentence.lastIndexOf(":", at),
    sentence.lastIndexOf("—", at),
  ) + 1;
  const before = sentence.slice(clauseStart, at);
  const after = sentence.slice(at + found[0].length, at + found[0].length + 30);
  return CLAIM_QUALIFIER_RE.test(before)
    || /^\s*(?:if|unless)\b/i.test(after)
    || /^\s*(?:\w+\s+){0,4}(?:if|unless)\b/i.test(after);
}

function hasUnknownGeography(sentence: string, facts: FuelReportFacts): boolean {
  const qualifier = sentence.match(
    /\b(?:in|across|within|for)\s+(?:the\s+)?([A-Z][A-Za-z-]*(?:\s+[A-Z][A-Za-z-]*)?)/,
  )?.[1];
  return Boolean(
    qualifier &&
    !facts.countries.some((country) =>
      country.name.toLowerCase() === qualifier.toLowerCase(),
    ),
  );
}

function relevantMarketIndicators(
  facts: FuelReportFacts,
  sentence: string,
) {
  return facts.market.indicators.filter((indicator) => {
    const marker =
      indicator.key === "brent" ? /\bbrent\b/i
      : indicator.key === "wti" ? /\bwti\b|west\s*texas/i
      : /\bjet\s*fuel\b|\bkerosene\b/i;
    return marker.test(sentence);
  });
}

function hasCurrentRisingFuelCostEvidence(
  facts: FuelReportFacts,
  sentence: string,
): boolean {
  if (hasUnknownGeography(sentence, facts)) return false;
  return relevantMarketIndicators(facts, sentence).some((indicator) =>
    indicator.comparisonScope === "reporting-period" &&
    indicator.direction === "rising" &&
    indicator.currentValue != null &&
    indicator.referenceValue != null &&
    indicator.pctChange != null &&
    indicator.pctChange > 0,
  );
}

function countryForClaim(sentence: string, facts: FuelReportFacts): string | null {
  return facts.countries.find((country) =>
    new RegExp(`\\b${escapeRe(country.name)}\\b`, "i").test(sentence),
  )?.name ?? null;
}

function sameFuelProduct(claim: string, evidence: string): boolean {
  if (/\bdiesel\b/i.test(claim)) return /\bdiesel\b/i.test(evidence);
  if (/\bpetrol\b|\bgasoline\b/i.test(claim)) {
    return /\bpetrol\b|\bgasoline\b/i.test(evidence);
  }
  if (/\broad\s+fuel\b|\bfuel\s+(?:supply|availability|distribution)\b/i.test(claim)) {
    return /\b(road\s+fuel|diesel|petrol|gasoline|forecourt)\b/i.test(evidence);
  }
  return false;
}

function hasCurrentRoadSupplyRiskEvidence(
  facts: FuelReportFacts,
  sentence: string,
): boolean {
  const country = countryForClaim(sentence, facts);
  if (!country || hasUnknownGeography(sentence, facts)) return false;
  return facts.incidents.some((incident) => {
    if (incident.country?.toLowerCase() !== country.toLowerCase()) return false;
    const evidence = `${incident.title} ${incident.summary ?? ""}`;
    return /\b(shortage|ration(?:ing)?|fuel\s+(?:is\s+)?unavailable)\b/i.test(evidence)
      && sameFuelProduct(sentence, evidence);
  });
}

function judgementContradiction(
  judgement: FuelJudgement,
  sentence: string,
  facts: FuelReportFacts | undefined,
): string | null {
  // Unknown semantic support must remain non-blocking.
  if (!facts) return null;
  if (
    hasCurrentRisingFuelCostEvidence(facts, sentence) &&
    LOWER_COST_RE.test(sentence) &&
    !isNegated(sentence, LOWER_COST_RE) &&
    !claimIsQualified(sentence, LOWER_COST_RE)
  ) {
    return "asserts lower fuel costs despite current rising market evidence";
  }
  if (
    judgement.exposure.sector === "road fuel distribution" &&
    hasCurrentRoadSupplyRiskEvidence(facts, sentence) &&
    RELIABLE_SUPPLY_RE.test(sentence) &&
    !isNegated(sentence, RELIABLE_SUPPLY_RE) &&
    !claimIsQualified(sentence, RELIABLE_SUPPLY_RE)
  ) {
    return "asserts reliable road-fuel supply despite current disruption evidence";
  }
  return null;
}

/**
 * Detect only explicit reversals of the structured Fuel assessment. This
 * deliberately does not inspect `mainRisk`: it is a source-derived incident
 * title, not wording that final analysis must repeat. Omitted source facts,
 * labels and derived indicators are never a consistency failure.
 */
export function validateFuelJudgementConsistency(
  judgement: FuelJudgement,
  sections: FuelEffectiveSections,
  facts?: FuelReportFacts,
): FuelConsistencyIssue[] {
  const requirements: Array<Exclude<
    keyof FuelEffectiveSections,
    "provenance" | "analystEditReviewRequired"
  >> = [
    "executiveSummary",
    "whatMatters",
    "polestarView",
    "implications",
    "watchNext",
  ];
  const issues: Array<Omit<FuelConsistencyIssue, "level">> = [];
  for (const section of requirements) {
    const body = (sections[section] ?? "").trim();
    if (!body) continue;
    for (const sentence of body.split(SENTENCE_SPLIT_RE)) {
      const contradiction = judgementContradiction(judgement, sentence, facts);
      if (!contradiction) continue;
      issues.push({
        code: "JUDGEMENT_CONSISTENCY",
        section,
        message: `Final assessment ${contradiction}: "${sentence.trim().slice(0, 140)}"`,
      });
    }
  }
  return issues.map((issue) => ({ ...issue, level: "ERROR" }));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Effective-section resolution for the gate. Uses the SAME resolvers the
// preview JSX and PDF builder use on the SAME
// inputs, so the text the gate validates is byte-identical to the text that
// renders — including analyst overrides (spec: validate the FINAL text).
// ---------------------------------------------------------------------------

import type {
  FuelSectionsProvenance,
  TopicAiProse,
} from "./topicProseResolution";
import { resolveFuelAnalyticalText } from "./topicProseResolution";
import type { FuelWatchReportData } from "./fuelWatchReport";

export interface FuelGateReportFields {
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  polestarView?: string | null;
  fuelMarketRead?: string | null;
  fuelOperationalRead?: string | null;
  fuelRegionalHighlights?: string | null;
  implications?: string | null;
  watchNext?: string | null;
}

/**
 * A narrowly-scoped correction for one known generated Fuel cache variant.
 * This is intentionally exact-text-only: it neither rewrites newly generated
 * prose nor touches an analyst edit. Applying it in the common final resolver
 * keeps editor prefill, preview and PDF on identical corrected text without a
 * production cache write.
 */
function repairLegacyFuelGeneratedText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(
      "Evidence confidence is moderate, so the trend is clear even where the duration and depth of disruption are not yet settled.",
      "The duration and depth of disruption are not yet settled.",
    )
    .replace(
      "from India, Pakistan and Indonesia",
      "",
    )
    .replace(
      "in Pakistan, India and Indonesia",
      "",
    );
}

// Previous deterministic Fuel reports persisted this exact template into the
// implications field. Once stored, normal editor precedence made it outrank a
// corrected canonical builder forever. Treat only that generated signature as
// stale canonical text; genuinely divergent analyst wording remains verbatim.
const LEGACY_REPEATED_FUEL_IMPLICATION_RE =
  /^(?:Prioritise .+; reassess if (?:a |an |the )?confirmed change in .+|Reprice .+ against current delivered-cost and availability assumptions)\.$/i;

const FUEL_SECTION_MIN_WORDS = {
  implications: 60,
  polestarView: 60,
  watchNext: 40,
} as const;

function meetsFuelSectionMinimum(
  field: keyof typeof FUEL_SECTION_MIN_WORDS,
  value: string | null | undefined,
): boolean {
  return (value ?? "").trim().split(/\s+/).filter(Boolean).length >= FUEL_SECTION_MIN_WORDS[field];
}

export function resolveFuelEffectiveSections(opts: {
  report: FuelGateReportFields;
  aiProse: TopicAiProse | null | undefined;
  fuelData: FuelWatchReportData;
}): FuelEffectiveSections {
  const { report, aiProse, fuelData } = opts;
  // The deterministic tier is the canonical-facts prose — the exact text the
  // report renders when no analyst edit and no AI narrative exist. This keeps
  // the fail-closed gate's guarantee: every tier below an analyst edit is
  // either model prose grounded on the canonical FIXED FACTS or the canonical
  // projection itself, and the gate validates whichever tier wins.
  const canonical = fuelData.narrativeData.canonicalSections;
  // A generated payload that carries a Fuel basis must match the exact
  // canonical evidence snapshot being rendered. Legacy callers without a
  // basis remain compatible, but an explicitly stale payload is never allowed
  // to outrank current deterministic prose. Deliberate analyst edits retain
  // their existing precedence and are still validated below.
  const generatedBasisFingerprint =
    aiProse?.datasetFingerprint ?? aiProse?.generationBasisFingerprint ?? null;
  const generatedFuelIsCurrent =
    !aiProse ||
    aiProse.isAnalystEdited === true ||
    (!aiProse.stale &&
      (!generatedBasisFingerprint ||
        generatedBasisFingerprint === fuelData.generationBasisFingerprint));
  const generated = generatedFuelIsCurrent ? aiProse : null;
  const currentEvidenceIds = new Set(
    fuelData.canonicalFacts.currentConditions.map((incident) => incident.id),
  );
  // Preserve the final text verbatim. Contradictory generated or analyst prose
  // must be reported by validation, never silently replaced by a fallback.
  const resolveText = (
    editor: string | null | undefined,
    ai: string | null | undefined,
    deterministic: string,
  ): string => {
    const e = (editor ?? "").trim();
    const rawGenerated = generatedFuelIsCurrent ? (ai ?? "").trim() : "";
    // A report field may have been pre-filled from the AI cache. It remains
    // generated text when it is byte-identical to that cache value, so apply
    // the same exact repair before it becomes an accidental higher-precedence
    // override. Any divergent editor value remains untouched.
    const repairedGenerated = generated?.isAnalystEdited
      ? rawGenerated
      : repairLegacyFuelGeneratedText(rawGenerated).trim();
    if (e && (!rawGenerated || e !== rawGenerated)) return e;
    return repairedGenerated || deterministic;
  };
  const resolveAnalytical = (
    field: "whatHappened" | "watchNext",
    editor: string | null | undefined,
    generatedText: string | null | undefined,
    deterministic: string,
  ): string => {
    const resolved = resolveText(editor, generatedText, deterministic);
    // Direct analyst edits are intentionally preserved verbatim. Only
    // generated items with explicit provenance are filtered.
    const editorText = (editor ?? "").trim();
    if (editorText && (!generatedText || editorText !== generatedText)) return resolved;
    if (generated?.isAnalystEdited === true) return resolved;
    if (!generated?.provenance?.[field]) return resolved;
    return resolveFuelAnalyticalText(
      resolved,
      generated.provenance[field],
      currentEvidenceIds,
      field === "whatHappened" ? "\n\n" : "\n",
    ) || deterministic;
  };
  const resolveSituation = (
    editor: string | null | undefined,
    ai: string | null | undefined,
    deterministic: string,
  ): string => {
    const e = (editor ?? "").trim();
    const a = (ai ?? "").trim();
    if (generated?.isAnalystEdited === true) return e || a || deterministic;
    if (e && (!a || e !== a)) return e;
    return deterministic;
  };
  const resolveCanonicalAnalysis = (
    field: "whatMatters" | "polestarView" | "implications" | "watchNext",
    editor: string | null | undefined,
    ai: string | null | undefined,
    deterministic: string,
  ): string => {
    const e = (editor ?? "").trim();
    const a = (ai ?? "").trim();
    if (field === "whatMatters") {
      if (generated?.isAnalystEdited === true) return e || a || deterministic;
      if (e && (!a || e !== a)) return e;
      return deterministic;
    }
    if (generated?.isAnalystEdited === true) {
      if (meetsFuelSectionMinimum(field, e)) return e;
      if (meetsFuelSectionMinimum(field, a)) return a;
      return deterministic;
    }
    if (field === "implications" && LEGACY_REPEATED_FUEL_IMPLICATION_RE.test(e)) {
      return deterministic;
    }
    if (e && (!a || e !== a) && meetsFuelSectionMinimum(field, e)) return e;
    return deterministic;
  };
  const reportHasOverride = [
    report.executiveSummary,
    report.situation,
    report.whatHappened,
    report.whatMatters,
    report.implications,
    report.polestarView,
    report.watchNext,
  ].some((value) => Boolean(value?.trim()));
  const basisMoved =
    aiProse?.stale === true ||
    (generatedBasisFingerprint !== null &&
      generatedBasisFingerprint !== fuelData.generationBasisFingerprint);
  const analystEditReviewRequired = Boolean(
    basisMoved && (aiProse?.isAnalystEdited === true || reportHasOverride),
  );
  return {
    executiveSummary: resolveText(report.executiveSummary, generated?.executiveSummary, canonical.executiveSummary),
    situation: resolveSituation(report.situation, generated?.situation, canonical.situation),
    whatHappened: resolveAnalytical("whatHappened", report.whatHappened, generated?.whatHappened, canonical.whatHappened),
    whatMatters: resolveCanonicalAnalysis("whatMatters", report.whatMatters, generated?.whatMatters, canonical.whatMatters),
    polestarView: resolveCanonicalAnalysis("polestarView", report.polestarView, generated?.polestarView, canonical.polestarView),
    marketRead: canonical.marketRead,
    operationalRead: canonical.operationalRead,
    regionalHighlights: canonical.regionalHighlights,
    implications: resolveCanonicalAnalysis("implications", report.implications, generated?.implications, canonical.implications),
    watchNext: resolveCanonicalAnalysis("watchNext", report.watchNext, generated?.watchNext, canonical.watchNext),
    provenance: generated?.provenance ?? canonical.provenance,
    analystEditReviewRequired,
  };
}

/** Validate and throw — the PDF-export entry point (mirrors cargo). */
export function assertFuelReportConsistent(
  facts: FuelReportFacts,
  sections: FuelEffectiveSections,
): void {
  const issues = validateFuelReportConsistency(facts, sections);
  if (issues.length) throw new FuelReportConsistencyError(issues);
}
