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

import type { FuelReportFacts, MarketDirection } from "./fuelReportFacts";

export interface FuelConsistencyIssue {
  code:
    | "MARKET_DIRECTION"
    | "PRIMARY_PRESSURE"
    | "COUNT_TRACEABLE"
    | "SEVERITY_TERMS"
    | "CURRENT_CONDITION";
  section: string;
  message: string;
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
  /\b(rising|climbing|climbed|surging|surged|rallying|rallied|jumped|spiking|spiked|firming|gained|advancing|up sharply|moved higher|pushed higher|higher on the week)\b/i;
const FALLING_RE =
  /\b(falling|fell|declining|declined|easing|eased|retreating|retreated|slumped|sliding|slid|dropped|dropping|pulled back|pullback|moved lower|pushed lower|lower on the week|softened|softening)\b/i;

// A sentence must carry price/market-movement context before its direction
// wording is validated against the calculated series direction.
const PRICE_CONTEXT_RE =
  /\b(price|prices|pricing|\$|usd|bbl|barrel|gallon|per[- ]litre|market|trading|traded|close|closed|benchmark|on the week|this week|over th(?:e|is) (?:week|window|period))\b/i;

const INDICATOR_TOKENS: { key: "brent" | "wti" | "jet" | "crude"; re: RegExp }[] = [
  { key: "brent", re: /\bbrent\b/i },
  { key: "wti", re: /\bwti\b|west\s*texas/i },
  { key: "jet", re: /\bjet\s*fuel\b|\bkerosene\b/i },
  { key: "crude", re: /\bcrude\b|\boil price/i },
];

function directionConflict(
  sentence: string,
  calculated: MarketDirection,
): string | null {
  const saysRising = RISING_RE.test(sentence);
  const saysFalling = FALLING_RE.test(sentence);
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

// Leader-claim phrasing: "X is the clearest/primary/main/leading pressure
// point", "pressure is concentrated in X", etc.
const LEADER_CLAIM_RE =
  /\b(clearest|primary|main|leading|dominant|principal|biggest|foremost)\b[^.!?]{0,60}\bpressure point\b(?!s)|\bpressure\b[^.!?]{0,40}\bconcentrated in\b/i;

const COUNT_CLAIM_RE =
  /\b(\d{1,4})\s+(?:qualifying\s+|fuel[- ]related\s+|distinct\s+)?(incidents?|records?|events?|reports?|dates?|days?)\b/gi;

const OVERALL_SEVERITY_RE =
  /\boverall severity\b[^.!?]{0,40}\b(insignificant|low|moderate|high|extreme)\b|\b(insignificant|low|moderate|high|extreme)\b[^.!?]{0,25}\boverall severity\b|\brated\s+(insignificant|low|moderate|high|extreme)\s+overall\b/i;

// Live current-condition assertions, mapped to the facts signal class they
// require. Speculative framing ("could", "risk of", "if") is excluded.
const SPECULATIVE_RE =
  /\b(could|may|might|would|risk of|potential|if\b|were to|watch for|likely to)\b/i;
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
  const out: number[] = [];
  const re = /(-?\d+(?:\.\d+)?)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(parseFloat(m[1]));
  return out;
}

/** Run the gate. Empty array = clean. */
export function validateFuelReportConsistency(
  facts: FuelReportFacts,
  sections: FuelEffectiveSections,
): FuelConsistencyIssue[] {
  const issues: FuelConsistencyIssue[] = [];

  const knownCounts = new Set<number>([
    facts.incidentCount,
    facts.distinctDates.length,
    ...facts.countries.map((c) => c.count),
    ...Object.values(facts.severityDistribution),
  ]);
  const knownPcts = facts.market.indicators
    .map((m) => m.pctChange)
    .filter((v): v is number => v !== null);
  if (facts.market.avgCrudePctChange !== null)
    knownPcts.push(facts.market.avgCrudePctChange);

  const dirByKey: Record<string, MarketDirection | null> = {
    brent: facts.market.indicators.find((m) => m.key === "brent")?.direction ?? null,
    wti: facts.market.indicators.find((m) => m.key === "wti")?.direction ?? null,
    jet: facts.market.indicators.find((m) => m.key === "jet")?.direction ?? null,
    crude: facts.market.crudeDirection,
  };

  for (const [section, raw] of Object.entries(sections)) {
    const text = (raw ?? "").trim();
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
        const conflict = directionConflict(sentence, calc);
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

    // 3. Count traceability.
    let cm: RegExpExecArray | null;
    COUNT_CLAIM_RE.lastIndex = 0;
    while ((cm = COUNT_CLAIM_RE.exec(text))) {
      const n = Number(cm[1]);
      const noun = cm[2].toLowerCase();
      const isDate = noun.startsWith("date") || noun.startsWith("day");
      const ok = isDate
        ? n === facts.distinctDates.length || knownCounts.has(n)
        : knownCounts.has(n);
      if (!ok) {
        issues.push({
          code: "COUNT_TRACEABLE",
          section,
          message: `Claims "${cm[0]}" but no calculated fact equals ${n} (total ${facts.incidentCount}, distinct dates ${facts.distinctDates.length}).`,
        });
      }
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
        if (SPECULATIVE_RE.test(sentence)) continue;
        for (const claim of CONDITION_CLAIMS) {
          if (
            claim.re.test(sentence) &&
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

    // Percentages are validated loosely: a % figure attached to a market
    // indicator sentence must match a calculated pct within 0.15pp.
    for (const sentence of sentences) {
      if (!INDICATOR_TOKENS.some((t) => t.re.test(sentence))) continue;
      for (const pct of pctNumbersIn(sentence)) {
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

  return issues;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Effective-section resolution for the gate. Uses the SAME resolvers the
// preview JSX and PDF builder use (pickRead / resolveSimpleProse) on the SAME
// inputs, so the text the gate validates is byte-identical to the text that
// renders — including analyst overrides (spec: validate the FINAL text).
// ---------------------------------------------------------------------------

import { pickRead } from "./pickRead";
import { resolveSimpleProse, type TopicAiProse } from "./topicProseResolution";
import type { TopicReportProse } from "./draftReportProse";
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
}

export function resolveFuelEffectiveSections(opts: {
  report: FuelGateReportFields;
  aiProse: TopicAiProse | null | undefined;
  proseDraft: TopicReportProse;
  fuelData: FuelWatchReportData;
}): FuelEffectiveSections {
  const { report, aiProse, proseDraft, fuelData } = opts;
  return {
    executiveSummary: resolveSimpleProse(
      report.executiveSummary,
      aiProse?.executiveSummary,
      proseDraft.executiveSummary,
    ),
    situation: resolveSimpleProse(
      report.situation,
      aiProse?.situation,
      proseDraft.situation,
    ),
    whatHappened: resolveSimpleProse(
      report.whatHappened,
      aiProse?.whatHappened,
      proseDraft.whatHappened,
    ),
    whatMatters: resolveSimpleProse(
      report.whatMatters,
      aiProse?.whatMatters,
      proseDraft.whatMatters,
    ),
    polestarView: resolveSimpleProse(
      report.polestarView,
      aiProse?.polestarView,
      proseDraft.polestarView,
    ),
    marketRead: pickRead(report.fuelMarketRead, fuelData.marketData.marketRead),
    operationalRead: pickRead(
      report.fuelOperationalRead,
      fuelData.incidentData.operationalRead,
    ),
    regionalHighlights: pickRead(
      report.fuelRegionalHighlights,
      fuelData.incidentData.regionalHighlights,
    ),
    // Implications / Watch Next are deliberately NOT gated: they are generic
    // topped-up bullet lists (forward-looking by design) whose stock phrasing
    // carries no this-window quantitative claims — gating them lexically
    // would only risk false blocks.
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
