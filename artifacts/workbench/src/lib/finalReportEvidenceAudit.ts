/**
 * Renderer-independent, fail-closed audit of the final text that is about to
 * be published. Topic adapters only translate their canonical records into
 * this small contract; the audit contains no commodity, headline or country
 * exceptions.
 */
import { deriveIncidentCountry } from "./shippingCountry";

export interface FinalReportEvidenceRecord {
  id?: string | number | null;
  title: string;
  summary?: string | null;
  country?: string | null;
  location?: string | null;
  occurredAt?: string | null;
  themes?: string[];
  supportedClaims?: string[];
  /** Optional; used for class C5 severity-vs-narrative parity when present. */
  severity?: string | null;
  marketComparison?: {
    indicator: string;
    currentDate?: string | null;
    referenceDate?: string | null;
    comparisonScope:
      | "reporting-period"
      | "lagged-reference"
      | "undated-reference"
      | "none";
    /** Fuel's canonical calculation only; omitted by every other adapter. */
    direction?: "rising" | "falling" | "broadly stable" | "unchanged" | null;
    currentValue?: number | null;
    referenceValue?: number | null;
    pctChange?: number | null;
    unit?: string | null;
  };
}

export interface FinalReportEvidenceAuditInput {
  topic: string;
  issueDate: string;
  window?: { start: string; end: string };
  /**
   * A client-facing Fuel assessment may state this computed, canonical
   * confidence tier. It is deliberately distinct from backend/model
   * confidence and is omitted by every other topic adapter.
   */
  canonicalEvidenceConfidence?: "low" | "moderate" | "high";
  evidence: FinalReportEvidenceRecord[];
  sections: Record<string, string | null | undefined>;
  validatedForwardIndicators: Array<string | FinalReportTypedReference>;
  typedReferences?: FinalReportTypedReference[];
}

export interface FinalReportTypedReference {
  id: string;
  type: "development" | "market-observation" | "forward-indicator" | "supported-claim";
  text: string;
  evidenceId?: string | number | null;
}

export type FinalReportEvidenceAuditCode =
  | "PERIOD_ALIGNMENT"
  | "UNSUPPORTED_CAUSAL_CLAIM"
  | "UNSUPPORTED_BOILERPLATE"
  | "VAGUE_CHANGE"
  | "WATCH_NEXT_UNGROUNDED"
  | "BACKEND_CONFIDENCE_LEAK"
  | "RAW_EVIDENCE_TITLE"
  | "PRIORITY_GEOGRAPHY_CONTRADICTION"
  | "RANKING_TIE"
  | "SEVERITY_PARITY";

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
// Fuel prose frequently names the product between "higher" and "costs".
// Keep that extra synthesis pattern Fuel-scoped so other report topics retain
// their existing, narrower boilerplate contract.
const FUEL_BOILERPLATE_RE =
  /\b(shortages?|crack spreads?|rationing|rerout(?:e|ed|ing)|route pressure|export pressure|exports? (?:fell|rose|halted|tightened)|availability (?:fell|declined|tightened|worsened)|supply (?:pressure|tightness|shortfall)|(?:fuel|energy|oil|jet fuel)?\s*cost pressure|higher (?:fuel |energy |oil |jet fuel )?costs?)\b/i;
const SPECULATIVE_RE =
  /\b(could|may|might|possible|potential|risk of|watch for|if\b|scenario|would)\b/i;
const BACKEND_RE =
  /\b(model confidence|backend confidence|evidence confidence|confidence score|validation status|unresolved fields?|classifier confidence|model uncertainty|low-confidence evidence|fixed risk picture|current condition set|condition set|records indicate|on file|(?:the )?dataset shows)\b|\bconfidence (?:is|stays|remains) (?:low|moderate|high)\b[^.!?]{0,90}\b(?:unresolved|validation|location|event status|routing outcome)\b/i;
/** Client-facing engine/file/table talk as a class — not a per-phrase product list. */
const DATASET_NARRATION_RE =
  /\b(?:also )?on file\b|\bin the file\b|\b(?:the )?(?:file|dataset) does not show\b|\bthe file does not\b|\b(?:the )?(?:table|chart) (?:above|below)\b|\bnamed locations\s*:|\blocations named in the records\b|\bthin in the records\b/i;
const EXCLUSIVE_VOLUME_RE =
  /\b(most affected|heaviest volume|leads on volume|volume leader)\b/i;
const VOLUME_TIE_LANGUAGE_RE =
  /\b(tied|tie|share[s]? the (?:heaviest volume|lead)|joint(?:ly)?|equally|no (?:single |clear )?volume leader)\b/i;
const MOST_SERIOUS_RE = /\bmost serious\b/i;
const SEV_RANK: Record<string, number> = {
  insignificant: 0,
  low: 1,
  moderate: 2,
  medium: 2,
  high: 3,
  extreme: 4,
};
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
  return (text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [])
    .flatMap((word) => word.split("-"))
    .filter((w) => !STOP.has(w));
}

function corpusOf(records: FinalReportEvidenceRecord[], forward: Array<string | FinalReportTypedReference>): string {
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
    ...forward.map((item) => typeof item === "string" ? item : item.text),
  ]
    .join(" ")
    .toLowerCase();
}

function referenceGrounds(item: string, reference: FinalReportTypedReference): boolean {
  const itemWords = [...new Set(words(item).filter((w) => w.length >= 4))];
  const refWords = new Set(words(reference.text));
  const overlap = itemWords.filter((word) => refWords.has(word)).length;
  if (reference.type === "forward-indicator") {
    // Forward-looking items are not factual retellings. They need a
    // meaningful pair of terms from one current reference, but should not be
    // rejected merely because they also contain a future qualifier and an
    // action verb.
    return overlap >= 2;
  }
  // A typed link must retain either the exact reference phrase or a substantial
  // share of one specific reference. Two unrelated words spread across the
  // complete corpus are deliberately insufficient.
  return item.toLowerCase().includes(reference.text.toLowerCase())
    || reference.text.toLowerCase().includes(item.toLowerCase())
    || (overlap >= 2 && overlap / Math.max(1, Math.min(itemWords.length, refWords.size)) >= 0.5);
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

function fuelWatchEntities(text: string): string[] {
  const entities = new Set<string>();
  // Keep country recognition aligned with shipping's country/demonym
  // gazetteer instead of maintaining a smaller Fuel-only alias list. Looking
  // at short word windows lets us retain every named country in a list such as
  // "Pakistan, India and Indonesia". `deriveIncidentCountry` deliberately
  // leaves bare "Korean" unresolved, so it cannot become both Koreas here.
  const tokens = text.match(/[A-Za-zÀ-ÿ]+/g) ?? [];
  for (let start = 0; start < tokens.length; start += 1) {
    for (let size = 1; size <= 3 && start + size <= tokens.length; size += 1) {
      const country = deriveIncidentCountry({
        title: tokens.slice(start, start + size).join(" "),
      });
      if (country) {
        entities.add(country.toLowerCase());
      }
    }
  }
  return [...entities];
}

function fuelRecordAnchorsEntity(
  entity: string,
  record: Pick<FinalReportEvidenceRecord, "title" | "summary" | "country" | "location">,
): boolean {
  const source = [record.title, record.summary ?? "", record.country ?? "", record.location ?? ""].join(" ");
  if (fuelWatchEntities(source).includes(entity)) return true;
  return false;
}

type FuelClaimFamily = "availability" | "cost" | "routing" | "exports" | "refinery" | "security" | "marine" | "aviation";

function fuelClaimFamilies(text: string): FuelClaimFamily[] {
  const families = new Set<FuelClaimFamily>();
  if (/\b(shortages?|scarcity|rationing|queues?|sales limits?|allocation|availability|supply (?:pressure|tightness|shortfall|disrupt))/i.test(text)) {
    families.add("availability");
  }
  if (/\b(costs?|prices?|pricing|benchmark|crude|brent|wti|freight|insurance)\b/i.test(text)) {
    families.add("cost");
  }
  if (/\b(rerout(?:e|ed|ing)|divert(?:ed|ing)?|route|transit|delay|corridor)\b/i.test(text)) {
    families.add("routing");
  }
  if (/\b(exports?|sales limits?|product flows?)\b/i.test(text)) {
    families.add("exports");
  }
  if (/\b(refiner(?:y|ies)|refining|product output|operations?)\b/i.test(text)) {
    families.add("refinery");
  }
  if (/\b(incident|attack|strike|disruption|security|threat|restriction|escalation|resolution|lead development)\b/i.test(text)) {
    families.add("security");
  }
  if (/\b(port|bunker(?:ing)?|ship(?:ping)? fuel|marine fuel|vessel|tanker)\b/i.test(text)) {
    families.add("marine");
  }
  if (/\b(jet fuel|aviation|airlines?)\b/i.test(text)) {
    families.add("aviation");
  }
  return [...families];
}

function fuelRecordText(record: FinalReportEvidenceRecord): string {
  return [
    record.title,
    record.summary ?? "",
    record.country ?? "",
    record.location ?? "",
    ...(record.themes ?? []),
    ...(record.supportedClaims ?? []),
  ].join(" ");
}

function fuelRecordSupportsFamily(record: FinalReportEvidenceRecord, family: FuelClaimFamily): boolean {
  return fuelClaimFamilies(fuelRecordText(record)).includes(family);
}

function fuelClaimContext(sentence: string, offset: number, length: number): string {
  const boundary = /[;:]|\b(?:but|while|whereas|although|however)\b/gi;
  let start = 0;
  let end = sentence.length;
  for (const match of sentence.matchAll(boundary)) {
    const index = match.index ?? 0;
    if (index < offset) start = index + match[0].length;
    if (index >= offset + length) {
      end = index;
      break;
    }
  }
  return sentence.slice(start, end);
}

function fuelClaimIsQualified(sentence: string, offset: number, length: number): boolean {
  const local = fuelClaimContext(sentence, offset, length);
  return SPECULATIVE_RE.test(local)
    || /\b(?:no|not|never|without|neither|nor|did not|does not|do not|is not|are not|was not|were not|has not|have not)\b/i.test(local);
}

function fuelHasUnqualifiedCausalClaim(sentence: string): boolean {
  const effects = new RegExp(EFFECT_RE.source, `${EFFECT_RE.flags.replace("g", "")}g`);
  for (const match of sentence.matchAll(effects)) {
    const offset = match.index ?? 0;
    const local = fuelClaimContext(sentence, offset, match[0].length);
    if (CAUSAL_RE.test(local) && !fuelClaimIsQualified(sentence, offset, match[0].length)) {
      return true;
    }
  }
  return false;
}

function fuelClaimGeographiesSupported(
  sentence: string,
  currentEvidence: FinalReportEvidenceRecord[],
  family: FuelClaimFamily,
): boolean {
  const entities = fuelWatchEntities(sentence);
  return entities.every((entity) =>
    currentEvidence.some((record) =>
      fuelRecordAnchorsEntity(entity, record) && fuelRecordSupportsFamily(record, family),
    ),
  );
}

function fuelBoilerplateGroundingDetail(
  sentence: string,
  currentEvidence: FinalReportEvidenceRecord[],
): string | null {
  const global = new RegExp(FUEL_BOILERPLATE_RE.source, `${FUEL_BOILERPLATE_RE.flags.replace("g", "")}g`);
  for (const match of sentence.matchAll(global)) {
    const claim = match[0];
    const offset = match.index ?? 0;
    if (fuelClaimIsQualified(sentence, offset, claim.length)) continue;
    const local = fuelClaimContext(sentence, offset, claim.length);
    const family = fuelClaimFamilies(claim)[0];
    if (!family) continue;
    const missing = fuelWatchEntities(local).filter((entity) =>
      !currentEvidence.some((record) =>
        fuelRecordAnchorsEntity(entity, record) && fuelRecordSupportsFamily(record, family),
      ),
    );
    if (missing.length) {
      const theme = /\bship fuel\b/i.test(local) && /\bshortages?\b/i.test(claim)
        ? "ship-fuel shortage"
        : family;
      return `no selected current source for the ${theme} theme in ${missing.map(fuelEntityLabel).join(", ")}`;
    }
  }
  return null;
}

function fuelMarketKey(record: FinalReportEvidenceRecord): "brent" | "wti" | "jet" | "crude" | null {
  const indicator = record.marketComparison?.indicator ?? "";
  if (/\bjet\b|\bkerosene\b/i.test(indicator)) return "jet";
  if (/\bbrent\b/i.test(indicator)) return "brent";
  if (/\bwti\b|west texas/i.test(indicator)) return "wti";
  if (/\bcrude\b|\boil\b/i.test(indicator)) return "crude";
  return null;
}

function fuelRequestedMarketKey(text: string): "brent" | "wti" | "jet" | "crude" | null {
  return /\bjet fuel\b|\baviation\b|\bairlines?\b/i.test(text) ? "jet"
    : /\bbrent\b/i.test(text) ? "brent"
    : /\bwti\b|west texas/i.test(text) ? "wti"
    : /\bcrude\b|\boil\b/i.test(text) ? "crude"
    : null;
}

function fuelSourceSupportsClaim(
  record: FinalReportEvidenceRecord,
  family: FuelClaimFamily,
  sentence: string,
): boolean {
  if (!fuelRecordSupportsFamily(record, family)) return false;
  if (family !== "cost") return true;
  const requested = fuelRequestedMarketKey(sentence);
  return !requested || fuelMarketKey({
    ...record,
    marketComparison: { indicator: fuelRecordText(record), comparisonScope: "none" },
  }) === requested;
}

function fuelMarketSupportsCostSynthesis(
  claim: string,
  sentence: string,
  market: FinalReportEvidenceRecord[],
  currentEvidence: FinalReportEvidenceRecord[],
): boolean {
  if (
    !/\b(higher|rising|increased|increasing)\s+(?:fuel\s+|energy\s+|oil\s+|jet\s+fuel\s+)?(?:costs?|prices?)\b|\b(?:fuel\s+|energy\s+|oil\s+|jet\s+fuel\s+)?cost pressure\b/i.test(
      claim,
    )
  ) {
    return false;
  }
  if (
    !/\b(?:fuel|oil|energy|brent|wti|jet)\b/i.test(sentence) ||
    /\b(?:next|future|following)\s+(?:operating\s+)?(?:week|month|quarter)\b/i.test(sentence)
  ) {
    return false;
  }
  if (!fuelClaimGeographiesSupported(sentence, currentEvidence, "cost")) {
    return false;
  }
  const rising = market.filter((record) => {
    const comparison = record.marketComparison;
    return currentEvidence.includes(record)
      && comparison?.comparisonScope === "reporting-period"
      && comparison.direction === "rising"
      && comparison.currentValue != null
      && comparison.referenceValue != null
      && comparison.pctChange != null
      && comparison.pctChange > 0;
  });
  const requested = fuelRequestedMarketKey(`${claim} ${sentence}`);
  if (requested) {
    return rising.some((record) => fuelMarketKey(record) === requested);
  }
  // "Fuel costs" without a named series is an analytical synthesis, not a
  // licence to select the convenient rising series from mixed markets. It is
  // grounded only where every available price basis points the same way.
  const directional = market.filter((record) =>
    currentEvidence.includes(record)
    && record.marketComparison?.comparisonScope === "reporting-period"
    && fuelMarketKey(record) !== null
    && record.marketComparison?.direction != null,
  );
  return directional.length > 0
    && directional.every((record) => rising.includes(record));
}

function fuelEntityLabel(entity: string): string {
  return entity.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fuelForwardGroundingFailure(
  item: string,
  currentEvidence: FinalReportEvidenceRecord[],
): string | null {
  const families = fuelClaimFamilies(item);
  if (!families.length) return "no identifiable supported theme";
  // The shared resolver intentionally does not assign "Korean" to either
  // state. A forward item must name North or South Korea before it can make a
  // country-specific claim.
  if (/\bkorean\b/i.test(item) && !/\b(?:north|south)\s+korean\b/i.test(item)) {
    return "Korean is ambiguous; name North or South Korea";
  }
  const entities = fuelWatchEntities(item);
  const unsupportedEntities = entities.filter((entity) =>
    !currentEvidence.some((record) =>
      fuelRecordAnchorsEntity(entity, record)
      && families.some((family) => fuelRecordSupportsFamily(record, family)),
    ),
  );
  if (unsupportedEntities.length) {
    return `no selected current ${families.join("/")} evidence for ${unsupportedEntities.map(fuelEntityLabel).join(", ")}`;
  }
  // Proper nouns not resolved by the shared country gazetteer (for example a
  // refinery city) must still be present in a current source. This closes the
  // "invented country/theme" hole without treating bare Korean as either
  // Korean state.
  const properTerms = [...item.matchAll(/\b[A-Z][a-z]{3,}\b/g)]
    .map((match) => match[0].toLowerCase())
    .filter((term) =>
      !["monitor", "any", "new", "changes", "follow", "port", "further"].includes(term)
      && !deriveIncidentCountry({ title: term }),
    );
  if (!properTerms.every((term) =>
    currentEvidence.some((record) => new RegExp(`\\b${escapeRe(term)}\\b`, "i").test(fuelRecordText(record))),
  )) {
    const absent = properTerms.filter((term) =>
      !currentEvidence.some((record) => new RegExp(`\\b${escapeRe(term)}\\b`, "i").test(fuelRecordText(record))),
    );
    return `no selected current evidence for ${absent.join(", ")}`;
  }
  if (!currentEvidence.some((record) =>
    families.some((family) => fuelRecordSupportsFamily(record, family)),
  )) {
    return `no selected current ${families.join("/")} evidence`;
  }
  return null;
}

function fuelUnsupportedBoilerplateClaim(
  sentence: string,
  market: FinalReportEvidenceRecord[],
  currentEvidence: FinalReportEvidenceRecord[],
): string | null {
  const global = new RegExp(FUEL_BOILERPLATE_RE.source, `${FUEL_BOILERPLATE_RE.flags.replace("g", "")}g`);
  for (const match of sentence.matchAll(global)) {
    const claim = match[0];
    const offset = match.index ?? 0;
    if (fuelClaimIsQualified(sentence, offset, claim.length)) continue;
    const localClaim = fuelClaimContext(sentence, offset, claim.length);
    const families = fuelClaimFamilies(claim);
    const sourceEvidence = currentEvidence.filter((record) => !record.marketComparison);
    const supportedBySource = families.some((family) =>
      fuelClaimGeographiesSupported(localClaim, sourceEvidence, family)
      && sourceEvidence.some((record) => fuelSourceSupportsClaim(record, family, sentence)),
    );
    if (!supportedBySource && !fuelMarketSupportsCostSynthesis(claim, localClaim, market, currentEvidence)) {
      return claim;
    }
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

function hasOnlyCanonicalFuelConfidenceAssessment(
  text: string,
  canonicalEvidenceConfidence: FinalReportEvidenceAuditInput["canonicalEvidenceConfidence"],
): boolean {
  if (!canonicalEvidenceConfidence) return false;
  const assessments = [...text.matchAll(/\bevidence confidence\s+(?:is|remains|stays)\s+(low|moderate|high)\b/gi)];
  return assessments.length > 0
    && assessments.every((match) => match[1].toLowerCase() === canonicalEvidenceConfidence);
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      new RegExp(`\\b${escapeRe(g)}\\b`, "i").test(sentence),
    ) ?? null
  );
}

/** Bind "most serious" to geography in that clause only — earlier volume-lead countries must not be scored. */
function geographyForMostSerious(sentence: string, records: FinalReportEvidenceRecord[]): string | null {
  const match = sentence.match(MOST_SERIOUS_RE);
  const after = match && match.index != null ? sentence.slice(match.index) : sentence;
  return geographyIn(after, records);
}

function recordMatchesGeography(record: FinalReportEvidenceRecord, geography: string): boolean {
  const geo = geography.trim();
  if (!geo) return false;
  const geoRe = new RegExp(`\\b${escapeRe(geo)}\\b`, "i");
  return [record.country, record.location].some((value) => {
    if (!value?.trim()) return false;
    return geoRe.test(value) || new RegExp(`\\b${escapeRe(value.trim())}\\b`, "i").test(geo);
  });
}

function evidenceForSeverityClaim(
  section: string,
  records: FinalReportEvidenceRecord[],
): FinalReportEvidenceRecord[] {
  const key = section.toLowerCase();
  const want =
    /civilunrest|unrest/.test(key) ? "unrest"
    : /activism/.test(key) ? "activism"
    : null;
  if (!want) return records;
  const scoped = records.filter((record) => record.themes?.includes(want));
  return scoped.length > 0 ? scoped : records;
}

/** Empty result means publishable. Every returned issue is a hard failure. */
export function auditFinalReportEvidence(
  input: FinalReportEvidenceAuditInput,
): FinalReportEvidenceAuditIssue[] {
  const issues: FinalReportEvidenceAuditIssue[] = [];
  const currentEvidence = input.window
    ? input.evidence.filter((record) => {
        if (record.marketComparison) return true;
        const date = record.occurredAt?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
        return Boolean(date && date >= input.window!.start && date <= input.window!.end);
      })
    : input.evidence;
  const evidenceCorpus = corpusOf(currentEvidence, []);
  const market = input.evidence.filter((r) => r.marketComparison);
  const typedReferences: FinalReportTypedReference[] = [
    ...(input.typedReferences ?? []).filter((reference) =>
      reference.evidenceId === undefined
      || currentEvidence.some((record) => record.id === reference.evidenceId)),
    ...input.validatedForwardIndicators.map((item, index) => typeof item === "string"
      ? { id: `forward-${index}`, type: "forward-indicator" as const, text: item }
      : item),
  ];

  for (const [section, raw] of Object.entries(input.sections)) {
    const text = (raw ?? "").trim();
    if (!text) continue;
    const sentences = text.split(SENTENCE_RE).filter(Boolean);

    if (/\bthe confirmed change\b/i.test(text)) {
      issues.push({ code: "VAGUE_CHANGE", section, message: 'Name the development instead of saying "the confirmed change".' });
    }
    const permittedFuelConfidence =
      input.topic === "fuel"
      && hasOnlyCanonicalFuelConfidenceAssessment(text, input.canonicalEvidenceConfidence);
    const backendWithoutCanonicalFuelConfidence = text.replace(
      /\bevidence confidence\s+(?:is|remains|stays)\s+(?:low|moderate|high)\b/gi,
      "",
    );
    if (
      (permittedFuelConfidence ? BACKEND_RE.test(backendWithoutCanonicalFuelConfidence) : BACKEND_RE.test(text))
      || DATASET_NARRATION_RE.test(text)
    ) {
      issues.push({ code: "BACKEND_CONFIDENCE_LEAK", section, message: "Internal model, file, table or evidence-confidence state reached client prose." });
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

      const causalClaimAsserted = input.topic === "fuel"
        ? fuelHasUnqualifiedCausalClaim(sentence)
        : EFFECT_RE.test(sentence) && CAUSAL_RE.test(sentence) && !SPECULATIVE_RE.test(sentence);
      if (causalClaimAsserted) {
        const claimRefs = [
          ...currentEvidence.flatMap((record, index) => (record.supportedClaims ?? []).map((claim, claimIndex) => ({
            id: `claim-${record.id ?? index}-${claimIndex}`,
            type: "supported-claim" as const,
            text: claim,
            evidenceId: record.id,
          }))),
          ...typedReferences.filter((reference) => reference.type === "supported-claim"),
        ];
        if (!claimRefs.some((reference) => referenceGrounds(sentence, reference))) {
          issues.push({ code: "UNSUPPORTED_CAUSAL_CLAIM", section, message: `Causal operating consequence is not supported by canonical evidence: "${sentence.trim().slice(0, 150)}"` });
        }
      }
      const unsupportedBoilerplate = input.topic === "fuel"
        ? fuelUnsupportedBoilerplateClaim(sentence, market, currentEvidence)
        : unsupportedMatchedClaim(BOILERPLATE_RE, sentence, evidenceCorpus);
      const boilerplateRe = input.topic === "fuel" ? FUEL_BOILERPLATE_RE : BOILERPLATE_RE;
      if (
        section.toLowerCase() !== "watchnext" &&
        boilerplateRe.test(sentence) &&
        unsupportedBoilerplate !== null
      ) {
        const fuelDetail = input.topic === "fuel"
          ? fuelBoilerplateGroundingDetail(sentence, currentEvidence)
          : null;
        const detail = fuelDetail ? ` (${fuelDetail})` : "";
        issues.push({ code: "UNSUPPORTED_BOILERPLATE", section, message: `Generic market/fuel consequence is not traceable to specific evidence${detail}: "${sentence.trim().slice(0, 150)}"` });
      }
    }

    if (section.toLowerCase() === "watchnext") {
      for (const item of text.split(/\n+|(?<=[.;!?])\s+/).filter((s) => words(s).length)) {
        const fuelFailure = input.topic === "fuel"
          ? fuelForwardGroundingFailure(item, currentEvidence)
          : null;
        const explicitlyValidated = input.topic === "fuel"
          ? fuelFailure === null
          : typedReferences.some((reference) => referenceGrounds(item, reference));
        if (!explicitlyValidated) {
          const detail = fuelFailure ? ` (${fuelFailure})` : "";
          issues.push({ code: "WATCH_NEXT_UNGROUNDED", section, message: `Watch item introduces a country or theme absent from evidence and validated indicators${detail}: "${item.trim().slice(0, 150)}"` });
        }
      }
    }
  }

  const countryCounts = new Map<string, number>();
  for (const record of currentEvidence) {
    if (record.marketComparison) continue;
    const country = record.country?.trim();
    if (!country) continue;
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
  }
  const maxCountryCount = Math.max(0, ...countryCounts.values());
  const tiedCountries = [...countryCounts.entries()]
    .filter(([, count]) => count === maxCountryCount && maxCountryCount > 0)
    .map(([country]) => country);
  if (tiedCountries.length > 1) {
    for (const [section, raw] of Object.entries(input.sections)) {
      const text = (raw ?? "").trim();
      if (!text) continue;
      for (const sentence of text.split(SENTENCE_RE).filter(Boolean)) {
        if (!EXCLUSIVE_VOLUME_RE.test(sentence) || VOLUME_TIE_LANGUAGE_RE.test(sentence)) continue;
        const named = tiedCountries.filter((country) =>
          new RegExp(`\\b${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sentence),
        );
        if (named.length === 1) {
          issues.push({
            code: "RANKING_TIE",
            section,
            message: `Exclusive volume ranking names ${named[0]} while ${tiedCountries.join(" and ")} share the top count.`,
          });
        }
      }
    }
  }

  const rankedEvidence = currentEvidence.filter((record) => SEV_RANK[String(record.severity ?? "").toLowerCase()] != null);
  if (rankedEvidence.length > 0) {
    for (const [section, raw] of Object.entries(input.sections)) {
      const text = (raw ?? "").trim();
      if (!text) continue;
      const scoped = evidenceForSeverityClaim(section, rankedEvidence);
      const maxSev = Math.max(
        0,
        ...scoped.map((record) => SEV_RANK[String(record.severity ?? "").toLowerCase()] ?? 0),
      );
      for (const sentence of text.split(SENTENCE_RE).filter(Boolean)) {
        if (!MOST_SERIOUS_RE.test(sentence)) continue;
        const geography = geographyForMostSerious(sentence, scoped);
        if (!geography) continue;
        const localMax = Math.max(
          0,
          ...scoped
            .filter((record) => recordMatchesGeography(record, geography))
            .map((record) => SEV_RANK[String(record.severity ?? "").toLowerCase()] ?? 0),
        );
        if (localMax > 0 && localMax < maxSev) {
          issues.push({
            code: "SEVERITY_PARITY",
            section,
            message: `"Most serious" names ${geography} below the canonical maximum severity.`,
          });
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