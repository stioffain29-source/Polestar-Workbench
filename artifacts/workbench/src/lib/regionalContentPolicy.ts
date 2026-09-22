import type {
  RegionalCanonicalReport,
  RegionalCoverageCheck,
  RegionalDevelopment,
} from "./regionalWeekly";

export const MIDDLE_EAST_COLLECTION_DOMAINS = [
  "security", "political", "regulatory", "operational", "energy",
  "weather", "cyber", "maritime", "aviation",
] as const;

export const REGIONAL_OUTLOOK_MIN_WORDS = 120;
export const REGIONAL_OUTLOOK_MAX_WORDS = 160;
export const REGIONAL_MAX_SINGLE_COUNTRY_SENTENCES = 2;

/** The Regional Outlook answers what changed and where exposure sits; it is not a roundup. */
export const REGIONAL_SUMMARY_MIN_WORDS = 100;
export const REGIONAL_SUMMARY_MAX_WORDS = 130;
export const REGIONAL_MAX_RISK_SINGLE_COUNTRY_SENTENCES = 3;

/** The map explains the operating picture; the report may carry more developments. */
export const REGIONAL_MAX_MAP_POINTS = 5;

/** A forward search across the next seven days, not a holiday calendar. */
export const REGIONAL_WATCH_MIN_ITEMS = 3;
export const REGIONAL_WATCH_MAX_ITEMS = 5;

function regionalSentences(value: string): string[] {
  return value.split(/(?<=[.!?])\s+/u).map((sentence) => sentence.trim()).filter(Boolean);
}

function regionalWords(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

/** One authority for the rule, so the writer can be told exactly what fails. */
export function regionalSingleCountrySentences(outlook: string, countries: string[]): string[] {
  const selected = [...new Set(countries.map((country) => country.toLowerCase()))];
  return regionalSentences(outlook)
    .filter((sentence) =>
      selected.filter((country) => sentence.toLowerCase().includes(country)).length === 1);
}

/**
 * Polestar speaks to the client. Describing the source material ("the supplied
 * facts do not establish...") reads as the writer narrating its own inputs.
 */
const PIPELINE_VOICE =
  /\b(?:the\s+)?(?:supplied|provided|given)\s+(?:facts?|material|information|data|evidence|reporting)\b|\bthe supplied\b|\b(?:source|fact|evidence|data)\s+packets?\b|\bthe packets?\b|\bpackets?\s+(?:does|do|did|cannot|can't|fails?|failed)\b|\bsource material\b|\bdata pipeline\b|\bconfirmed facts\b|\bevidence set\b/gi;

export function regionalPipelineVoicePhrases(value: string): string[] {
  return [...new Set((value.match(PIPELINE_VOICE) ?? []).map((phrase) => phrase.toLowerCase()))];
}

/** Energy vocabulary, used to measure how much of a section is energy prose. */
const ENERGY_PROSE =
  /\b(?:oil|gas|lng|crude|refiner\w*|pipelines?|petrochemical\w*|fuel|diesel|petrol|gasoline|electricity|power (?:plant|grid|station|supply)|energy)\b/i;

/** Holidays carry real operating consequences, so they stay in the watch. */
const OBSERVANCE =
  /\b(?:national day|independence day|revolution day|liberation day|republic day|founding day|unification day|public holiday|bank holiday|religious holiday|sukkot|rosh hashanah|yom kippur|passover|hanukkah|eid(?:\s+al[-\s]\w+)?|ramadan|ashura|mawlid|christmas|new year|lunar new year|diwali|vesak|feast of)\b/i;

export function regionalObservanceWatchItems<T extends { trigger: string }>(items: T[]): T[] {
  return items.filter((item) => OBSERVANCE.test(item.trigger));
}

/**
 * Forward items are collected, not written, so a thin watch cannot be repaired by
 * re-asking the writer. The build checks this before paying for any analysis.
 */
export function validateRegionalForwardWatch(
  topic: RegionalCanonicalReport["topic"],
  items: Array<{ trigger: string }>,
): string[] {
  const errors: string[] = [];
  // Middle East runs its own eleven-domain forward search; APAC draws on the
  // scheduled-event store, which is genuinely sparse in a quiet week.
  if (topic === "middle_east_weekly" &&
    (items.length < REGIONAL_WATCH_MIN_ITEMS || items.length > REGIONAL_WATCH_MAX_ITEMS)) {
    errors.push(`7 Day Watch requires ${REGIONAL_WATCH_MIN_ITEMS} to ${REGIONAL_WATCH_MAX_ITEMS} forward items from the separate forward search.`);
  }
  return errors;
}

/**
 * Public holidays are legitimate operational information — closures, reduced
 * cover and payment cut-offs all follow from them. A genuinely holiday-led
 * week is therefore published with the calendar it actually has, and says so,
 * rather than failing the whole report.
 */
export function regionalWatchObservanceNote(items: Array<{ trigger: string }>): string | null {
  if (items.length === 0) return null;
  const observances = regionalObservanceWatchItems(items);
  if (observances.length <= Math.floor(items.length / 2)) return null;
  return observances.length === items.length
    ? "The week ahead is led by public holidays and observances. No other significant scheduled events were identified."
    : "Public holidays and observances account for most of the week ahead. No further significant scheduled events were identified.";
}

export function regionalOutlookNamedCountries(
  outlook: string,
  events: Array<{ country: string; location?: string | null }>,
): string[] {
  const text = outlook.toLowerCase();
  return [...new Set(events
    .filter((event) => text.includes(event.country.toLowerCase()) ||
      (!!event.location && event.location.length >= 4 && text.includes(event.location.toLowerCase())))
    .map((event) => event.country))];
}

export function regionalCheckCompleted(check: RegionalCoverageCheck | undefined): boolean {
  return !!check && check.status === "checked" && check.sourceNames.length > 0 && check.errors.length === 0;
}

/**
 * Map selection rubric. Severity is deliberately the smallest term: the map
 * carries the five developments that best explain how the region is operating,
 * not the five worst headlines. Where two developments describe the same
 * operating issue in the same market, only the stronger one is plotted.
 */
const MAP_SIGNALS: Array<{ weight: number; re: RegExp }> = [
  { weight: 2, re: /\b(?:clos(?:ed|ure|ing)|suspend|halt|cancel|delay|disrupt|shortage|outage|restrict|evacuat|reroute|divert|curtail|blockad|strike|shut|ground(?:ed|ing)|export|import|supply)\w*/i },
  { weight: 2, re: /\b(?:airport|airspace|flight|aviation|port|harbour|shipping|vessel|tanker|cargo|container|rail|road|highway|border|crossing|corridor|logistics|transport)\w*/i },
  { weight: 2, re: /\b(?:oil|gas|lng|refiner|pipeline|crude|fuel|petrochemical|electricity|power\s+(?:plant|grid|station)|energy)\w*/i },
  { weight: 2, re: /\b(?:attack|strike|missile|drone|bomb|shell|clash|militant|armed|gunmen|kidnap|abduct|explos|cyber|ransomware|breach|outage)\w*/i },
  { weight: 2, re: /\b(?:hormuz|red sea|bab el[-\s]?mandeb|bab al[-\s]?mandab|suez|gulf|cross[-\s]border|regional|international|neighbouring)\w*/i },
  { weight: 1, re: /\b(?:deadline|decision|vote|ruling|takes? effect|effective|expire|resume|reopen|announce|sanction|tariff|licence|license|permit|visa|regulation)\w*/i },
];
const MAP_SEVERITY_WEIGHT: Record<string, number> = {
  Extreme: 1.5, High: 1, Moderate: 0.5, Low: 0, Insignificant: 0,
};

export interface RegionalMapCandidate {
  country: string;
  category: string;
  severity: string;
  title: string;
  whatChanged: string;
  operationalImpact?: string;
  operationalSignificance?: string;
  outlook7Days?: string;
  whatToWatch?: string;
}

function mapCandidateText(candidate: RegionalMapCandidate): string {
  return [
    candidate.title, candidate.whatChanged, candidate.operationalImpact,
    candidate.operationalSignificance, candidate.outlook7Days, candidate.whatToWatch,
  ].filter(Boolean).join(" ");
}

function mapDomain(candidate: RegionalMapCandidate): string {
  return /Security|Conflict|Terrorism/.test(candidate.category) ? "Security" : candidate.category;
}

function mapCandidateScore(candidate: RegionalMapCandidate): number {
  const text = mapCandidateText(candidate);
  return MAP_SIGNALS.reduce((total, signal) => total + (signal.re.test(text) ? signal.weight : 0), 0)
    + (MAP_SEVERITY_WEIGHT[candidate.severity] ?? 0);
}

const MAP_SIGNAL_TERMS = MAP_SIGNALS.map((signal) => new RegExp(signal.re.source, "gi"));

/**
 * The specific words that made a development score, not the broad signal group:
 * a port strike and an airport weather closure both read as transport, but they
 * are two different operating issues and both belong on the map.
 */
function mapSignalStems(candidate: RegionalMapCandidate): Set<string> {
  const text = mapCandidateText(candidate);
  const stems = new Set<string>();
  for (const term of MAP_SIGNAL_TERMS) {
    for (const match of text.matchAll(term)) stems.add(match[0].toLowerCase().slice(0, 4));
  }
  return stems;
}

/** True when both describe the same operating issue in the same market. */
function sameOperatingIssue(a: RegionalMapCandidate, b: RegionalMapCandidate): boolean {
  if (a.country !== b.country || mapDomain(a) !== mapDomain(b)) return false;
  const first = mapSignalStems(a);
  return [...mapSignalStems(b)].some((stem) => first.has(stem));
}

export function selectRegionalMapDevelopments<T extends RegionalMapCandidate>(
  developments: T[],
  max: number = REGIONAL_MAX_MAP_POINTS,
): T[] {
  if (developments.length <= 0) return [];
  const remaining = developments.map((development, index) => ({
    development, index, score: mapCandidateScore(development),
  }));
  const chosen: Array<{ development: T; index: number }> = [];
  while (chosen.length < max && remaining.length > 0) {
    let best = -1;
    let bestScore = -Infinity;
    for (let position = 0; position < remaining.length; position++) {
      const candidate = remaining[position];
      if (chosen.some((picked) => sameOperatingIssue(picked.development, candidate.development))) continue;
      // Breadth of the operating picture beats another entry from the same
      // market or the same domain, whatever its severity.
      const adjusted = candidate.score
        - 2 * chosen.filter((picked) => mapDomain(picked.development) === mapDomain(candidate.development)).length
        - 1.5 * chosen.filter((picked) => picked.development.country === candidate.development.country).length;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        best = position;
      }
    }
    if (best < 0) break;
    chosen.push(remaining.splice(best, 1)[0]);
  }
  // Plot in report order so map numbering follows the Key Developments list.
  return chosen.sort((a, b) => a.index - b.index).map((picked) => picked.development);
}

/** Concentration is an instruction to search again, not permission to add filler. */
export function regionalEnergyConcentrated(
  events: Array<Pick<RegionalDevelopment, "title" | "category"> & {
    confirmedFacts?: string[];
    whatChanged?: string;
  }>,
): boolean {
  if (events.length === 0) return false;
  const energy = events.filter((event) => event.category === "Energy" ||
    /\b(?:refiner(?:y|ies)|pumping stations?|oil pipeline|fuel depot|fuel pric(?:e|es|ing)|energy infrastructure|oil facilit(?:y|ies))\b/i
      .test(`${event.title} ${event.confirmedFacts?.join(" ") ?? event.whatChanged ?? ""}`));
  // Half the week reading as energy infrastructure is already a collection
  // problem: search again before writing, rather than after publishing.
  return energy.length / events.length >= 1 / 2;
}

/** New content policy only; existing saved editions remain readable unchanged. */
export function validateRegionalContentPolicy(report: RegionalCanonicalReport): string[] {
  const errors: string[] = [];
  const events = report.developments;
  const outlookWords = report.polestarOutlook.trim().split(/\s+/u).filter(Boolean).length;
  if (outlookWords < REGIONAL_OUTLOOK_MIN_WORDS || outlookWords > REGIONAL_OUTLOOK_MAX_WORDS) {
    errors.push("Polestar Outlook must contain 120–160 words.");
  }
  const summaryWords = regionalWords(report.regionalOutlook);
  if (summaryWords < REGIONAL_SUMMARY_MIN_WORDS || summaryWords > REGIONAL_SUMMARY_MAX_WORDS) {
    errors.push(`regionalOutlook must contain ${REGIONAL_SUMMARY_MIN_WORDS} to ${REGIONAL_SUMMARY_MAX_WORDS} words: it states the week's most consequential change and where exposure sits, not a roundup.`);
  }
  // The map is a selection, not a mirror of the development list.
  if (report.mapPoints.length < 1 || report.mapPoints.length > REGIONAL_MAX_MAP_POINTS ||
    new Set(report.mapPoints.map((point) => point.title)).size !== report.mapPoints.length) {
    errors.push(`The map must plot one to ${REGIONAL_MAX_MAP_POINTS} distinct developments chosen for the operating picture.`);
  }
  for (const [section, text] of [
    ["regionalOutlook", report.regionalOutlook],
    ["riskPicture", report.riskPicture],
    ["businessImplicationsNarrative", report.businessImplicationsNarrative],
    ["polestarOutlook", report.polestarOutlook],
  ] as const) {
    const phrases = regionalPipelineVoicePhrases(text);
    if (phrases.length > 0) {
      errors.push(`${section} refers to the reporting behind the assessment ("${phrases.join('", "')}") instead of addressing the client directly.`);
    }
  }
  for (const event of events) {
    for (const [field, text] of [
      ["operationalImpact", event.operationalImpact ?? event.operationalSignificance],
      ["polestarView", event.polestarView ?? ""],
      ["outlook7Days", event.outlook7Days ?? event.whatToWatch],
    ] as const) {
      if (regionalPipelineVoicePhrases(text ?? "").length > 0) {
        errors.push(`${event.title}: source-material voice in ${field}.`);
      }
    }
  }
  const riskCountrySentences = regionalSingleCountrySentences(
    report.riskPicture, events.map((event) => event.country));
  if (riskCountrySentences.length > REGIONAL_MAX_RISK_SINGLE_COUNTRY_SENTENCES) {
    errors.push("riskPicture must connect the developments into a risk picture rather than work through one country at a time.");
  }
  const implicationCountrySentences = regionalSingleCountrySentences(
    report.businessImplicationsNarrative, events.map((event) => event.country));
  if (implicationCountrySentences.length > REGIONAL_MAX_RISK_SINGLE_COUNTRY_SENTENCES) {
    errors.push("businessImplicationsNarrative must stay organised by business function rather than by country.");
  }
  for (const event of events) {
    if (!event.severityRationale?.trim() || !Array.isArray(event.severityEvidence) ||
      (["High", "Extreme"].includes(event.severity) && event.severityEvidence.length === 0)) {
      errors.push(`Severity has not been reassessed from confirmed consequences: ${event.title}.`);
    }
  }
  const evidenceKeys = report.polestarOutlookEvidenceKeys ?? [];
  if (events.some((event) => !event.eventKey || !evidenceKeys.includes(event.eventKey)) ||
    evidenceKeys.some((key) => !events.some((event) => event.eventKey === key))) {
    errors.push("Polestar Outlook must consider the complete selected development set.");
  }
  const namedCountries = new Set(regionalOutlookNamedCountries(report.polestarOutlook, events));
  if (namedCountries.size < Math.min(3, new Set(events.map((event) => event.country)).size)) {
    errors.push("Polestar Outlook must assess the wider region, not one country or incident.");
  }
  const singleCountrySentences = regionalSingleCountrySentences(
    report.polestarOutlook, events.map((event) => event.country));
  if (singleCountrySentences.length > REGIONAL_MAX_SINGLE_COUNTRY_SENTENCES) {
    errors.push("Polestar Outlook must synthesise regional risks rather than list separate country updates.");
  }
  errors.push(...validateRegionalForwardWatch(report.topic, report.watchItems));
  const issue = new Date(`${report.issueDate}T00:00:00Z`).getTime();
  if (report.watchItems.length > REGIONAL_WATCH_MAX_ITEMS || report.watchItems.some((item) => {
    const date = new Date(item.date).getTime();
    return !Number.isFinite(date) || date <= issue || date > issue + 7 * 86_400_000 ||
      ![item.location, item.trigger, item.whyItMatters, item.whatToWatch].every((value) => value?.trim());
  })) {
    errors.push("7 Day Watch requires up to five complete, genuinely dated next-seven-day events.");
  }
  if (report.topic === "apac_weekly") {
    if (events.length !== 6) errors.push("APAC must retain six distinct developments and map items.");
    for (const category of ["Cyber", "Weather & Natural Hazards", "Regulatory"]) {
      if (!events.some((event) => event.category === category)) {
        errors.push(`APAC requires a material ${category} development; do not substitute filler.`);
      }
    }
    if (!report.watchItems.length) errors.push("APAC 7 Day Watch must remain populated.");
  } else {
    if (events.length < 5 || events.length > 8) errors.push("Middle East requires five to eight material developments.");
    const coverage = report.coverageManifest;
    for (const domain of MIDDLE_EAST_COLLECTION_DOMAINS) {
      if (!regionalCheckCompleted(coverage.domains.find((check) => check.domain === domain))) {
        errors.push(`Middle East collection is incomplete: ${domain}.`);
      }
    }
    if (!coverage.requiredForwardDomains || coverage.requiredForwardDomains.length !== 11 ||
      new Set(coverage.requiredForwardDomains).size !== 11 ||
      !coverage.requiredForwardDomains.every((domain) =>
        regionalCheckCompleted(coverage.forwardDomains?.find((check) => check.domain === domain))) ||
      !regionalCheckCompleted(coverage.forwardSearch)) {
      errors.push("Middle East requires a completed, separate eleven-domain 7 Day Watch search.");
    }
    if (regionalEnergyConcentrated(events) && (coverage.collectionPasses ?? 1) < 2) {
      errors.push("Energy infrastructure still dominates; repeat the broad collection before generation.");
    }
    // A Polestar Outlook that is mostly energy prose while other material risks
    // were selected is the same concentration problem, one stage later.
    const outlookSentences = regionalSentences(report.polestarOutlook);
    const energySentences = outlookSentences.filter((sentence) => ENERGY_PROSE.test(sentence));
    if (events.filter((event) => event.category !== "Energy").length >= 2 &&
      outlookSentences.length > 0 && energySentences.length > outlookSentences.length / 2) {
      errors.push("Polestar Outlook concentrates on energy infrastructure while other material risks were selected.");
    }
  }
  return [...new Set(errors)];
}