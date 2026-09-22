import type {
  RegionalCanonicalReport,
  RegionalDevelopment,
  RegionalIntelligenceCategory,
} from "./regionalWeekly";
import { REGIONAL_OUTLOOK_MAX_WORDS, validateRegionalContentPolicy } from "./regionalContentPolicy";

export const REGIONAL_EDITORIAL_VERSION = "regional-facts-v4" as const;

export function isRegionalFactualEdition(version: string | undefined): boolean {
  return version === "regional-facts-v2" || version === "regional-facts-v3" ||
    version === REGIONAL_EDITORIAL_VERSION;
}

/** Report facts are separate from source articles and from analytical judgement. */
export interface RegionalEventFact {
  eventKey: string;
  country: string;
  location: string;
  eventDate: string;
  dateBasis: "event" | "reported";
  category: RegionalIntelligenceCategory;
  severity: RegionalDevelopment["severity"];
  title: string;
  confirmedFacts: string[];
  evidenceIds: Array<string | number>;
  uncertainties: string[];
}

export const REGIONAL_WORD_LIMITS = {
  regionalOutlook: 140,
  riskPicture: 180,
  businessImplicationsNarrative: 180,
  polestarOutlook: REGIONAL_OUTLOOK_MAX_WORDS,
  title: 12,
  whatChanged: 65,
  operationalImpact: 40,
  polestarView: 35,
  outlook7Days: 30,
} as const;

const SOURCE_OR_SCRAPE =
  /\b(?:Ratopati|SuaraGarut(?:\.ID)?|The New Indian Express|Inquirer\.net|Reuters|Associated Press|SBS|BBC|AFP|read more|keep on reading|appeared first on|click here|subscribe)\b|https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|co\.uk|co\.id)\b/i;
const BOILERPLATE =
  /\b(?:the development is relevant to|their regional importance comes from what could follow|the principal .+ changes this week were|the specific indicators are|the significance is confined to the named market|recorded a (?:security|regulatory|operational) (?:incident|change|development)|the immediate implications concern|reporting placed the casualties at)\b/i;

export function regionalWordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

export function normalizedRegionalQuote(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** This is deliberately a lexical check, not a claim of semantic verification. */
export function containsRegionalSourceLeak(value: string): boolean {
  return SOURCE_OR_SCRAPE.test(value);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

export function regionalNumericClaims(value: string): string[] {
  const normalized = value.toLowerCase().replace(
    new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "g"),
    (word) => String(NUMBER_WORDS[word]),
  );
  return [...normalized.matchAll(/\b(\d[\d,]*(?:\.\d+)?)(?:\s*(hundred|thousand|million|billion))?\b/g)]
    .map((match) => {
      const multiplier = { hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 }[match[2]] ?? 1;
      return String(Number(match[1].replace(/,/g, "")) * multiplier);
    });
}

function casualtyClaims(value: string): string[] {
  const output: string[] = [];
  const normalize = (word: string) => /kill|dead|death|died/i.test(word) ? "dead" : "injured";
  const text = value.toLowerCase().replace(
    new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "g"),
    (word) => String(NUMBER_WORDS[word]),
  );
  for (const match of text.matchAll(/\b(\d+)\s+(?:(?:people|civilians?|police|officers?|personnel|were|was|have|been|are|reportedly)\s+){0,4}(killed|dead|deaths?|died|injured|wounded)\b/g)) {
    output.push(`${match[1]}:${normalize(match[2])}`);
  }
  for (const match of text.matchAll(/\b(kills?|killed|injures?|injured|wounds?|wounded)\s+(?:(?:at least|more than|up to|over)\s+)?(\d+)\b/g)) {
    output.push(`${match[2]}:${normalize(match[1])}`);
  }
  return output;
}

/** Exact source spans + number/role checks prevent headline debris becoming a toll. */
export function validateRegionalFactStatement(
  statement: string,
  quote: string,
  sourceText: string,
  sourceHeadline?: string,
): string[] {
  const errors: string[] = [];
  const quoted = normalizedRegionalQuote(quote);
  if (quoted.length < 12 || !normalizedRegionalQuote(sourceText).includes(quoted)) {
    errors.push("The supporting quotation is not an exact source span.");
  }
  if (!statement.trim() || regionalWordCount(statement) > 45 || !/[.!?]$/.test(statement.trim())) {
    errors.push("A fact must be a short, complete sentence.");
  }
  if (containsRegionalSourceLeak(statement)) errors.push("Publisher or scrape text remains in a fact.");
  if (/["“”]|\b(?:(?:a|one|another|the|the same)\s+)?report(?:s|ing)?\s+(?:said|says|stated|added|described)\b/i.test(statement)) {
    errors.push("Write the event as a factual sentence; do not wrap or quote a headline in report-attribution text.");
  }
  if (sourceHeadline && normalizedRegionalQuote(statement) === normalizedRegionalQuote(sourceHeadline)) {
    errors.push("A factual sentence must not be a copied source headline.");
  }
  const supportedNumbers = new Set(regionalNumericClaims(quote));
  if (regionalNumericClaims(statement).some((number) => !supportedNumbers.has(number))) {
    errors.push("A numerical claim is not supported by its quotation.");
  }
  const supportedCasualties = new Set(casualtyClaims(quote));
  if (casualtyClaims(statement).some((claim) => !supportedCasualties.has(claim))) {
    errors.push("A casualty figure or casualty type differs from its quotation.");
  }
  return errors;
}

/** Validate the saved payload itself; never silently rewrite it during reload/export. */
export function validateRegionalEditorialReport(report: RegionalCanonicalReport): string[] {
  if (!isRegionalFactualEdition(report.editorialVersion)) return [];
  const errors: string[] = [];
  for (const key of ["regionalOutlook", "riskPicture", "businessImplicationsNarrative", "polestarOutlook"] as const) {
    const value = report[key];
    if (!value.trim()) errors.push(`${key} is empty.`);
    if (regionalWordCount(value) > REGIONAL_WORD_LIMITS[key]) errors.push(`${key} exceeds its word limit.`);
    if (containsRegionalSourceLeak(value) || BOILERPLATE.test(value)) errors.push(`${key} contains source text or generic templates.`);
  }
  const keys = report.developments.map((row) => row.eventKey);
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) errors.push("Developments must represent distinct identified events.");
  // Five to eight for the Middle East since the factual editions; APAC stays at six.
  const maximum = report.editorialVersion !== "regional-facts-v2" && report.topic === "middle_east_weekly" ? 8 : 6;
  if (report.developments.length < 5 || report.developments.length > maximum) errors.push(`The regional selection must contain five to ${maximum} material events.`);
  const sourceIds = new Set<string>();
  for (const row of report.developments) {
    if (!row.confirmedFacts?.length || !row.evidenceIds?.length) errors.push(`Missing factual evidence for ${row.title}.`);
    for (const id of row.evidenceIds ?? []) {
      if (sourceIds.has(String(id))) errors.push("The same source evidence appears in more than one development.");
      sourceIds.add(String(id));
    }
    for (const [key, value] of [
      ["title", row.title], ["whatChanged", row.whatChanged],
      ["operationalImpact", row.operationalImpact ?? row.operationalSignificance],
      ["polestarView", row.polestarView ?? ""], ["outlook7Days", row.outlook7Days ?? row.whatToWatch],
    ] as const) {
      if (!value.trim() || regionalWordCount(value) > REGIONAL_WORD_LIMITS[key]) errors.push(`${row.title}: invalid ${key} length.`);
      if (containsRegionalSourceLeak(value) || BOILERPLATE.test(value)) errors.push(`${row.title}: source text or generic prose in ${key}.`);
    }
  }
  for (const point of report.mapPoints) {
    if (!report.developments.some((row) => row.title === point.title && row.whatChanged === point.summary)) {
      errors.push("A map point is not derived from the final development set.");
    }
  }
  if (report.editorialVersion === REGIONAL_EDITORIAL_VERSION) {
    errors.push(...validateRegionalContentPolicy(report));
  }
  return [...new Set(errors)];
}