/**
 * Renderer-independent, fail-closed audit of the final text that is about to
 * be published. Topic adapters only translate their canonical records into
 * this small contract; the audit contains no commodity, headline or country
 * exceptions.
 */
export interface FinalReportEvidenceRecord {
  id?: string | number | null;
  title: string;
  summary?: string | null;
  country?: string | null;
  location?: string | null;
  occurredAt?: string | null;
  themes?: string[];
  supportedClaims?: string[];
  marketComparison?: {
    indicator: string;
    currentDate?: string | null;
    referenceDate?: string | null;
    comparisonScope:
      | "reporting-period"
      | "lagged-reference"
      | "undated-reference"
      | "none";
  };
}

export interface FinalReportEvidenceAuditInput {
  topic: string;
  issueDate: string;
  window?: { start: string; end: string };
  evidence: FinalReportEvidenceRecord[];
  sections: Record<string, string | null | undefined>;
  validatedForwardIndicators: string[];
}

export type FinalReportEvidenceAuditCode =
  | "PERIOD_ALIGNMENT"
  | "UNSUPPORTED_CAUSAL_CLAIM"
  | "UNSUPPORTED_BOILERPLATE"
  | "VAGUE_CHANGE"
  | "WATCH_NEXT_UNGROUNDED"
  | "BACKEND_CONFIDENCE_LEAK"
  | "RAW_EVIDENCE_TITLE"
  | "PRIORITY_GEOGRAPHY_CONTRADICTION";

export interface FinalReportEvidenceAuditIssue {
  code: FinalReportEvidenceAuditCode;
  section: string;
  message: string;
}

export class FinalReportEvidenceAuditError extends Error {
  constructor(public readonly issues: FinalReportEvidenceAuditIssue[]) {
    super(
      `Final report evidence audit failed: ${issues
        .map((i) => `[${i.code}] ${i.section}: ${i.message}`)
        .join(" | ")}`,
    );
    this.name = "FinalReportEvidenceAuditError";
  }
}

const SENTENCE_RE = /(?<=[.!?])\s+|\n+/;
const CURRENT_PERIOD_RE =
  /\b(this|the current|current reporting|reporting)\s+(week|period|window)\b|\bweekly\b|\bon the week\b|\bweek[- ]on[- ]week\b|\bover the (week|period|window)\b/i;
const MARKET_MOVE_RE =
  /\b(price|prices|pricing|benchmark|index|market|crude|fuel|freight|rate|rates)\b[^.!?]{0,90}\b(rose|risen|rising|fell|fallen|falling|up|down|higher|lower|gained|declined|eased|firmed|surged|dropped|changed|movement|move)\b|\b(rose|rising|fell|falling|higher|lower|gained|declined|eased|firmed|surged|dropped)\b[^.!?]{0,70}\b(price|prices|benchmark|index|market|rate|rates)\b/i;
const EFFECT_RE =
  /\b(rerout(?:e|ed|ing)|divert(?:ed|ing|s)?|shortages?|scarcity|rationing|higher costs?|costs? (?:rose|increased|climbed)|availability (?:fell|declined|tightened|worsened)|unavailable|supply (?:halted|tightened|disrupted))\b/i;
const CAUSAL_RE =
  /\b(caused?|led to|resulted in|drove|driven by|forced?|triggered?|due to|because of|as a result)\b/i;
const BOILERPLATE_RE =
  /\b(shortages?|crack spreads?|rationing|rerout(?:e|ed|ing)|route pressure|export pressure|exports? (?:fell|rose|halted|tightened)|availability (?:fell|declined|tightened|worsened)|supply (?:pressure|tightness|shortfall)|cost pressure|higher costs?)\b/i;
const SPECULATIVE_RE =
  /\b(could|may|might|potential|risk of|watch for|if\b|scenario|would)\b/i;
const BACKEND_RE =
  /\b(model confidence|backend confidence|evidence confidence|confidence score|validation status|unresolved fields?|classifier confidence|model uncertainty|low-confidence evidence)\b|\bconfidence (?:is|stays|remains) (?:low|moderate|high)\b[^.!?]{0,90}\b(?:unresolved|validation|location|event status|routing outcome)\b/i;
const PERIOD_DISCLAIMER_RE =
  /\b(?:not|rather than|cannot|does not|isn't|is not)\b[^.!?]{0,100}\b(?:evidence|indicat(?:e|ion)|direction|movement|move)\b[^.!?]{0,50}\b(?:within|for|in) (?:this|the) reporting period\b|\bcontext rather than (?:a )?reporting-period direction\b/i;
const PRIORITY_RE =
  /\b(primary|main|leading|dominant|principal|clearest|biggest|top)\b[^.!?]{0,45}\b(priority|pressure point|exposure|development|concern)\b|\b(priority|pressure)\b[^.!?]{0,35}\b(?:is|remains|sits in|centres? on|concentrated in)\b/i;
const EXPLANATION_RE = /\b(while|whereas|alongside|by contrast|shift(?:ed|ing)?|now|however|secondary)\b/i;
const BAD_TITLE_RE =
  /(?:\s[-–—|]\s*(?:reuters|bloomberg|ap|afp|bbc|cnn|news|times|post|journal)\s*$)|^\s*(?:RT\s+)?@[\w.]{2,}\s*[:：]|\s[-–—|:]\s*$|[!?]{3,}|\.{3,}\s*$/i;

const STOP = new Set(
  "about after again against also among around been before being below between both could current during each from further have having into monitor more most other over report same should some such than that their them then there these they this those through under very watch week what when where which while will with would next".split(
    " ",
  ),
);

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
    (w) => !STOP.has(w),
  );
}

function corpusOf(records: FinalReportEvidenceRecord[], forward: string[]): string {
  return [
    ...records.flatMap((r) => [
      r.title,
      r.summary ?? "",
      r.country ?? "",
      r.location ?? "",
      ...(r.themes ?? []),
      ...(r.supportedClaims ?? []),
      r.marketComparison?.indicator ?? "",
    ]),
    ...forward,
  ]
    .join(" ")
    .toLowerCase();
}

function hasGrounding(text: string, corpus: string, minimum = 1): boolean {
  const distinctive = [...new Set(words(text))].filter((w) => w.length >= 4);
  return distinctive.filter((w) => corpus.includes(w)).length >= minimum;
}

function unsupportedMatchedClaim(re: RegExp, text: string, corpus: string): string | null {
  const global = new RegExp(re.source, `${re.flags.replace("g", "")}g`);
  for (const match of text.matchAll(global)) {
    const phrase = match[0].toLowerCase();
    const roots = words(phrase).map((w) => w.replace(/(?:ing|ed|es|s)$/, ""));
    if (!roots.some((root) => root.length >= 4 && corpus.includes(root))) return phrase;
  }
  return null;
}

function titleFragmentAppears(text: string, title: string): boolean {
  const clean = title.trim();
  if (clean.length < 12) return false;
  if (text.toLowerCase().includes(clean.toLowerCase())) return true;
  const titleWords = words(clean);
  return titleWords.length >= 4 && titleWords.every((w) => text.toLowerCase().includes(w));
}

function geographyIn(sentence: string, records: FinalReportEvidenceRecord[]): string | null {
  const geographies = [
    ...new Set(
      records
        .flatMap((r) => [r.country, r.location])
        .filter((v): v is string => Boolean(v?.trim()))
        .sort((a, b) => b.length - a.length),
    ),
  ];
  return (
    geographies.find((g) =>
      new RegExp(`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sentence),
    ) ?? null
  );
}

/** Empty result means publishable. Every returned issue is a hard failure. */
export function auditFinalReportEvidence(
  input: FinalReportEvidenceAuditInput,
): FinalReportEvidenceAuditIssue[] {
  const issues: FinalReportEvidenceAuditIssue[] = [];
  const evidenceCorpus = corpusOf(input.evidence, []);
  const allGrounding = corpusOf(input.evidence, input.validatedForwardIndicators);
  const market = input.evidence.filter((r) => r.marketComparison);

  for (const [section, raw] of Object.entries(input.sections)) {
    const text = (raw ?? "").trim();
    if (!text) continue;
    const sentences = text.split(SENTENCE_RE).filter(Boolean);

    if (/\bthe confirmed change\b/i.test(text)) {
      issues.push({ code: "VAGUE_CHANGE", section, message: 'Name the development instead of saying "the confirmed change".' });
    }
    if (BACKEND_RE.test(text)) {
      issues.push({ code: "BACKEND_CONFIDENCE_LEAK", section, message: "Internal model, validation or evidence-confidence state reached client prose." });
    }
    for (const record of input.evidence) {
      if (BAD_TITLE_RE.test(record.title) && titleFragmentAppears(text, record.title)) {
        issues.push({ code: "RAW_EVIDENCE_TITLE", section, message: `Malformed or publisher-fragment evidence title was rendered verbatim (record ${record.id ?? "unknown"}).` });
      }
    }

    for (const sentence of sentences) {
      if (
        CURRENT_PERIOD_RE.test(sentence) &&
        MARKET_MOVE_RE.test(sentence) &&
        !PERIOD_DISCLAIMER_RE.test(sentence)
      ) {
        const mentioned = market.filter((r) => {
          const indicator = r.marketComparison?.indicator ?? "";
          return indicator && new RegExp(`\\b${indicator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sentence);
        });
        const candidates = mentioned.length ? mentioned : market;
        if (
          candidates.length === 0 ||
          candidates.every((r) => r.marketComparison?.comparisonScope !== "reporting-period")
        ) {
          issues.push({ code: "PERIOD_ALIGNMENT", section, message: `Current-period market movement is asserted without a reporting-period comparison: "${sentence.trim().slice(0, 150)}"` });
        }
      }

      if (EFFECT_RE.test(sentence) && CAUSAL_RE.test(sentence) && !SPECULATIVE_RE.test(sentence)) {
        const unsupported = unsupportedMatchedClaim(EFFECT_RE, sentence, evidenceCorpus);
        if (unsupported) {
          issues.push({ code: "UNSUPPORTED_CAUSAL_CLAIM", section, message: `Causal operating consequence is not supported by canonical evidence: "${sentence.trim().slice(0, 150)}"` });
        }
      }
      if (
        section.toLowerCase() !== "watchnext" &&
        BOILERPLATE_RE.test(sentence) &&
        !SPECULATIVE_RE.test(sentence) &&
        unsupportedMatchedClaim(BOILERPLATE_RE, sentence, evidenceCorpus) !== null
      ) {
        issues.push({ code: "UNSUPPORTED_BOILERPLATE", section, message: `Generic market/fuel consequence is not traceable to specific evidence: "${sentence.trim().slice(0, 150)}"` });
      }
    }

    if (section.toLowerCase() === "watchnext") {
      for (const item of text.split(/\n+|(?<=[.;!?])\s+/).filter((s) => words(s).length)) {
        const explicitlyValidated = input.validatedForwardIndicators.some(
          (indicator) =>
            indicator.trim().length > 0 &&
            (item.toLowerCase().includes(indicator.toLowerCase()) ||
              indicator.toLowerCase().includes(item.toLowerCase())),
        );
        if (!explicitlyValidated && !hasGrounding(item, allGrounding, 2)) {
          issues.push({ code: "WATCH_NEXT_UNGROUNDED", section, message: `Watch item introduces a country or theme absent from evidence and validated indicators: "${item.trim().slice(0, 150)}"` });
        }
      }
    }
  }

  const prioritySections = ["executiveSummary", "whatMatters", "regionalHighlights", "polestarView"];
  const priorities: { section: string; geography: string; sentence: string }[] = [];
  for (const section of prioritySections) {
    const text = input.sections[section] ?? "";
    for (const sentence of text.split(SENTENCE_RE)) {
      if (!PRIORITY_RE.test(sentence)) continue;
      const geography = geographyIn(sentence, input.evidence);
      if (geography) priorities.push({ section, geography, sentence });
    }
  }
  const distinct = new Set(priorities.map((p) => p.geography.toLowerCase()));
  if (distinct.size > 1 && !priorities.some((p) => EXPLANATION_RE.test(p.sentence))) {
    issues.push({
      code: "PRIORITY_GEOGRAPHY_CONTRADICTION",
      section: "cross-section",
      message: `Priority geography changes without explanation: ${priorities.map((p) => `${p.section}=${p.geography}`).join(", ")}.`,
    });
  }
  return issues;
}

export function assertFinalReportEvidence(input: FinalReportEvidenceAuditInput): void {
  const issues = auditFinalReportEvidence(input);
  if (issues.length) throw new FinalReportEvidenceAuditError(issues);
}