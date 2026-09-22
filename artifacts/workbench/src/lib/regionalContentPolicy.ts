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

export function regionalCheckCompleted(check: RegionalCoverageCheck | undefined): boolean {
  return !!check && check.status === "checked" && check.sourceNames.length > 0 && check.errors.length === 0;
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
  return energy.length / events.length >= 2 / 3;
}

/** New content policy only; existing saved editions remain readable unchanged. */
export function validateRegionalContentPolicy(report: RegionalCanonicalReport): string[] {
  const errors: string[] = [];
  const events = report.developments;
  const outlookWords = report.polestarOutlook.trim().split(/\s+/u).filter(Boolean).length;
  if (outlookWords < REGIONAL_OUTLOOK_MIN_WORDS || outlookWords > REGIONAL_OUTLOOK_MAX_WORDS) {
    errors.push("Polestar Outlook must contain 120–160 words.");
  }
  if (report.mapPoints.length !== events.length ||
    new Set(report.mapPoints.map((point) => point.title)).size !== events.length) {
    errors.push("Every selected development must retain its distinct map item.");
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
  const namedCountries = new Set(events
    .filter((event) => report.polestarOutlook.toLowerCase().includes(event.country.toLowerCase()) ||
      (!!event.location && event.location.length >= 4 &&
        report.polestarOutlook.toLowerCase().includes(event.location.toLowerCase())))
    .map((event) => event.country));
  if (namedCountries.size < Math.min(3, new Set(events.map((event) => event.country)).size)) {
    errors.push("Polestar Outlook must assess the wider region, not one country or incident.");
  }
  const selectedCountries = [...new Set(events.map((event) => event.country.toLowerCase()))];
  const singleCountrySentences = report.polestarOutlook.split(/(?<=[.!?])\s+/u)
    .filter((sentence) => selectedCountries.filter((country) => sentence.toLowerCase().includes(country)).length === 1);
  if (singleCountrySentences.length >= 3) {
    errors.push("Polestar Outlook must synthesise regional risks rather than list separate country updates.");
  }
  const issue = new Date(`${report.issueDate}T00:00:00Z`).getTime();
  if (report.watchItems.length > 5 || report.watchItems.some((item) => {
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
  }
  return [...new Set(errors)];
}