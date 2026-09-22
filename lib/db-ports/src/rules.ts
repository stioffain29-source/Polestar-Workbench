import type {
  DbPortsEdition,
  DbPortsEvidence,
  DbPortsItemContent,
  DbPortsQuality,
} from "@workspace/api-client-react";

export const DB_PORTS_MAX_SELECTED = 6;
export const DB_PORTS_MAX_WATCH = 5;
export const DB_PORTS_MAX_ITEMS = 200;
export const DB_PORTS_DISCLAIMER =
  "Internal, unpublished DB Ports pilot. Provisional coverage targets are not confirmed client assets. " +
  "This edition is not a comprehensive regional service. Source-reported statements, confirmed facts and analytical judgments are distinguished; " +
  "unverified leads must not be treated as established events. No client distribution is authorised.";

export const DB_PORTS_COUNTRIES = [
  "Singapore", "Malaysia", "Indonesia", "Philippines", "Thailand", "Vietnam",
  "Cambodia", "Laos", "Myanmar", "Brunei", "Timor-Leste", "China", "Hong Kong",
  "Taiwan", "Japan", "South Korea", "Australia", "New Zealand", "Papua New Guinea",
  "Fiji", "Solomon Islands", "Vanuatu", "Samoa", "Tonga", "Kiribati", "Tuvalu",
  "Nauru", "Micronesia", "Marshall Islands", "Palau", "Cook Islands", "Niue",
] as const;

const ALIASES: Record<string, string> = {
  "viet nam": "Vietnam", "burma": "Myanmar", "republic of korea": "South Korea",
  "korea, republic of": "South Korea", "south korea": "South Korea",
  "east timor": "Timor-Leste", "timor leste": "Timor-Leste",
  "hong kong sar": "Hong Kong", "hong kong, china": "Hong Kong",
  "pr china": "China", "people's republic of china": "China",
  "papua new guinea": "Papua New Guinea", "png": "Papua New Guinea",
  "federated states of micronesia": "Micronesia",
};

export function canonicalDbPortsCountry(value: string): string | null {
  const key = value.trim().toLowerCase();
  return DB_PORTS_COUNTRIES.find(country => country.toLowerCase() === key) ?? ALIASES[key] ?? null;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function editionWindow(endDate: string): { startDate: string; endDate: string } {
  if (!isCalendarDate(endDate)) throw new Error("Choose a valid edition end date.");
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 13);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

export function isPublicSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password && !!url.hostname;
  } catch { return false; }
}

/** A discovery date is deliberately not interchangeable with a source's
 * verified publication date. Both are kept in the evidence model. */
function currentEvidence(
  evidence: DbPortsEvidence,
  window: { startDate: string; endDate: string },
): boolean {
  return evidence.verified && !!evidence.publishedDate &&
    isCalendarDate(evidence.publishedDate) &&
    evidence.publishedDate >= window.startDate && evidence.publishedDate <= window.endDate &&
    isPublicSourceUrl(evidence.sourceUrl) && !!evidence.sourceName.trim() &&
    !!evidence.excerpt.trim();
}

function publisherKey(evidence: DbPortsEvidence): string {
  try { return new URL(evidence.sourceUrl).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

const EXCLUDED_THEATRE = /\b(?:red\s+sea|houthi(?:s)?|bab[\s-]+el[\s-]+mandeb)\b/i;
const ROUTINE = /\b(?:annual\s+(?:report|results)|quarterly\s+(?:results|earnings)|container\s+throughput\s+(?:rose|grew)|new\s+(?:cruise\s+ship|service\s+launch)|port\s+anniversary|memorandum\s+of\s+understanding)\b/i;
const ACTUAL_DISRUPTION = /\b(?:clos(?:ure|ed)|suspend(?:ed|sion)|strike|stoppage|block(?:ed|ade)|attack|theft|stolen|fire|outage|restriction|evacuat|cyber|ransomware|sanction|ban|detain|seiz(?:e|ed|ure)|damag|contaminat)\w*/i;
const SENSITIVE = /\b(?:killed|deaths?|fatalit(?:y|ies)|casualt(?:y|ies)|sanctions?|export\s+(?:ban|control)|military|naval\s+blockade)\b/i;

export function assessDbPortsItem(
  item: DbPortsItemContent,
  window: { startDate: string; endDate: string },
): { blockers: string[]; secondaryReviewRequired: boolean } {
  const blockers: string[] = [];
  const isWatch = item.disposition === "watch";
  const text = `${item.headline} ${item.confirmedFacts} ${item.unverifiedClaims}`;
  const country = canonicalDbPortsCountry(item.country);
  if (!item.headline.trim()) blockers.push("Add a specific development headline.");
  if (!country) blockers.push("Geography is outside the APAC/Oceania pilot or has not been resolved.");
  if (EXCLUDED_THEATRE.test(text)) blockers.push("Red Sea and Houthi coverage is excluded from this pilot.");
  if (ROUTINE.test(item.headline) && !ACTUAL_DISRUPTION.test(text)) {
    blockers.push("Routine commercial or administrative news is not a material development.");
  }
  if (!item.location.trim() && !item.assets.some(value => value.trim())) {
    blockers.push("Identify the affected port, terminal, corridor or specific operating location.");
  }
  if (!item.impactAreas.length || !item.materialityReason.trim()) {
    blockers.push("State the demonstrated effect on at least one of the eight operating functions.");
  }
  if (!item.operationalImplications.trim()) blockers.push("Explain the operating implication without inventing consequences.");
  if (!item.outlook.trim()) blockers.push(isWatch ? "State the concrete trigger to watch." : "Add a source-grounded outlook.");

  const sources = item.evidence.filter(evidence => currentEvidence(evidence, window));
  const authoritative = sources.filter(evidence => evidence.sourceType !== "discovery");
  if (!authoritative.length) {
    blockers.push("Verify a non-aggregator source, its publication date within the 14-day window, and a concise supporting extract.");
  }
  if (!item.reviewed || !item.reviewer.trim()) blockers.push("An analyst must verify and sign off this item.");
  if (!isWatch) {
    if (!item.confirmedFacts.trim()) blockers.push("Record the verified facts separately from unverified claims.");
    if (!item.severity) blockers.push("Assess current severity; an upstream rating is not accepted automatically.");
    if (item.confidence === "unverified") blockers.push("Assess evidence confidence separately from severity.");
    if (!item.eventDate || !isCalendarDate(item.eventDate)) {
      blockers.push("Confirm the event or material-update date before selecting this development.");
    } else if (item.eventDate > window.endDate) {
      blockers.push("A future event belongs on the watch list, not in current developments.");
    }
  } else if (!item.missingInfo.trim()) {
    blockers.push("State the uncertainty or confirmation still needed for this watch item.");
  }

  const publishers = new Set(authoritative.map(publisherKey).filter(Boolean));
  const names = new Set(authoritative.map(source => source.sourceName.trim().toLowerCase()));
  const official = authoritative.some(source => source.sourceType === "official");
  const corroborated = publishers.size >= 2 && names.size >= 2;
  if (item.confidence === "official" && !official) {
    blockers.push("Official confidence requires a checked primary-authority source.");
  }
  if (item.confidence === "corroborated" && !corroborated) {
    blockers.push("Corroboration requires two independent checked publishers, not two syndicated URLs.");
  }
  const secondaryReviewRequired =
    item.severity === "High" || item.severity === "Extreme" || SENSITIVE.test(text) ||
    (item.theme === "geopolitical" && ["China", "Hong Kong", "Taiwan"].includes(country ?? ""));
  if (secondaryReviewRequired) {
    if (!official && !corroborated) blockers.push("High-impact or sensitive claims need an official source or two independent checked sources.");
    if (!item.secondReviewer.trim() || !item.secondReviewNote.trim() ||
      item.secondReviewer.trim().toLowerCase() === item.reviewer.trim().toLowerCase()) {
      blockers.push("Record a separate second review for high-impact, casualty, sanctions or sensitive geopolitical claims.");
    }
  }
  return { blockers: [...new Set(blockers)], secondaryReviewRequired };
}

export function buildDbPortsQuality(
  edition: Pick<DbPortsEdition, "overview" | "items" | "worklog" | "coverage" | "startDate" | "endDate">,
): DbPortsQuality {
  const selected = edition.items.filter(item => item.disposition === "selected" && !item.mergedInto);
  const watch = edition.items.filter(item => item.disposition === "watch" && !item.mergedInto);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (editionWindow(edition.endDate).startDate !== edition.startDate) {
    blockers.push("The edition must cover exactly 14 calendar days.");
  }
  if (!selected.length) blockers.push("No verified priority development has been selected. Do not fill the edition with weak leads.");
  if (selected.length > DB_PORTS_MAX_SELECTED) blockers.push("The pilot allows at most six priority developments.");
  if (watch.length > DB_PORTS_MAX_WATCH) blockers.push("The pilot allows at most five watch items.");
  const words = wordCount(edition.overview);
  if (words < 150 || words > 250) blockers.push(`The editorial overview must be 150–250 words (currently ${words}).`);
  for (const item of [...selected, ...watch]) {
    for (const blocker of assessDbPortsItem(item, edition).blockers) {
      blockers.push(`${item.headline || "Untitled item"}: ${blocker}`);
    }
  }
  if (!edition.coverage.length) blockers.push("Record the source checks and any coverage gaps before review.");
  if (!edition.coverage.some(check => check.sourceId === "recaap")) {
    warnings.push("The ReCAAP source check has not been recorded for this edition.");
  }
  const totalMinutes = edition.worklog.reduce((sum, entry) => sum + entry.minutes, 0);
  if (!edition.worklog.length) warnings.push("Analyst effort has not been logged; zero recorded hours does not mean zero work.");
  if (totalMinutes >= 40 * 60) warnings.push("This edition has reached the 40-hour pilot workload threshold.");
  const sourceFailures = edition.coverage.filter(check => check.status === "unavailable").length;
  if (sourceFailures) warnings.push(`${sourceFailures} source check(s) were unavailable; this is a coverage gap, not evidence of no events.`);
  if (selected.length > 0 && selected.length < 5) warnings.push("Fewer than five developments are selected. A shorter verified edition is preferable to padding.");
  return {
    blockers, warnings, selectedCount: selected.length, watchCount: watch.length,
    heldCount: edition.items.filter(item => item.disposition === "hold" && !item.mergedInto).length,
    inboxCount: edition.items.filter(item => item.disposition === "inbox" && !item.mergedInto).length,
    rejectedCount: edition.items.filter(item => item.disposition === "rejected").length,
    totalMinutes, corrections: edition.worklog.filter(entry => entry.activity === "correction").length,
    missedSignals: edition.worklog.filter(entry => entry.activity === "missed_signal").length,
    sourceFailures, readyForReview: blockers.length === 0,
  };
}

export function emptyDbPortsItem(): DbPortsItemContent {
  return {
    headline: "", country: "", location: "", assets: [], eventDate: null,
    theme: "operations", disposition: "inbox", severity: null, confidence: "unverified",
    confirmedFacts: "", unverifiedClaims: "", operationalImplications: "", outlook: "",
    materialityReason: "", impactAreas: [], missingInfo: "", analystNotes: "",
    reviewed: false, reviewer: "", secondReviewer: "", secondReviewNote: "", evidence: [],
  };
}