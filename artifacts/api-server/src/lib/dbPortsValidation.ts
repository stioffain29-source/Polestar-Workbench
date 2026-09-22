import type {
  DbPortsEvidence,
  DbPortsItemContent,
  DbPortsParameters,
  DbPortsSettings,
} from "@workspace/db-ports";
import {
  DB_PORTS_MAX_SELECTED,
  DB_PORTS_OVERVIEW_MAX_WORDS,
  DB_PORTS_OVERVIEW_MIN_WORDS,
  DB_PORTS_ITEM_MIN_WORDS,
  canonicalDbPortsCountry,
  isCalendarDate,
  isPublicSourceUrl,
} from "@workspace/db-ports";

/** Parameters the analyst can set. Rejected values are reported rather than
 * silently clamped, so the panel always shows what the report will use. */
export function validateParameters(parameters: DbPortsParameters): string | null {
  if (!parameters.reportTitle.trim()) return "The report title cannot be empty.";
  if (parameters.publicationDate && !isCalendarDate(parameters.publicationDate)) {
    return "Publication date must be a real calendar date.";
  }
  if (parameters.targetItems < 1 || parameters.targetItems > DB_PORTS_MAX_SELECTED) {
    return `Target number of items must be between 1 and ${DB_PORTS_MAX_SELECTED}.`;
  }
  if (!parameters.includedCountries.length) return "Select at least one country or region.";
  const unknown = parameters.includedCountries.filter((country) => !canonicalDbPortsCountry(country));
  if (unknown.length) return `Unrecognised country in the geography list: ${unknown[0]}.`;
  if (!parameters.includedThemes.length) return "Select at least one intelligence theme.";
  if (parameters.itemWordTarget < DB_PORTS_ITEM_MIN_WORDS) {
    return `Maximum item word count cannot be below the ${DB_PORTS_ITEM_MIN_WORDS}-word floor for a complete item.`;
  }
  if (parameters.itemWordTarget > 600) return "Maximum item word count cannot exceed 600.";
  if (
    parameters.overviewWordTarget < DB_PORTS_OVERVIEW_MIN_WORDS ||
    parameters.overviewWordTarget > DB_PORTS_OVERVIEW_MAX_WORDS
  ) {
    return `Regional Overview word count must be between ${DB_PORTS_OVERVIEW_MIN_WORDS} and ${DB_PORTS_OVERVIEW_MAX_WORDS}.`;
  }
  return null;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function validateCalendarDate(value: string): string | null {
  return isCalendarDate(value) ? null : "Date must be a real calendar date in YYYY-MM-DD form.";
}

export function validateEvidence(evidence: DbPortsEvidence[]): string | null {
  if (evidence.length > 12) return "An item may retain at most 12 evidence records.";
  const ids = new Set<string>();
  for (const entry of evidence) {
    if (ids.has(entry.id)) return `Duplicate evidence id: ${entry.id}`;
    ids.add(entry.id);
    if (!isPublicSourceUrl(entry.sourceUrl)) {
      return `Evidence ${entry.id} must use a public HTTP or HTTPS URL.`;
    }
    if (entry.publishedDate && !isCalendarDate(entry.publishedDate)) {
      return `Evidence ${entry.id} has an invalid publication date.`;
    }
    if (entry.sourceDate && !isCalendarDate(entry.sourceDate)) {
      return `Evidence ${entry.id} has an invalid upstream source date.`;
    }
    if (!Number.isFinite(Date.parse(entry.retrievedAt))) {
      return `Evidence ${entry.id} has an invalid retrieval timestamp.`;
    }
  }
  return null;
}

export function validateItemContent(item: DbPortsItemContent): string | null {
  if (item.eventDate && !isCalendarDate(item.eventDate)) {
    return "Event date must be a real calendar date.";
  }
  return validateEvidence(item.evidence);
}

export function validateSettings(settings: Pick<DbPortsSettings, "sources" | "watchlist">): string | null {
  if (settings.sources.length > 150 || settings.watchlist.length > 150) {
    return "Sources and watchlist are each limited to 150 entries.";
  }
  const sourceIds = new Set<string>();
  for (const source of settings.sources) {
    if (sourceIds.has(source.id)) return `Duplicate source id: ${source.id}`;
    sourceIds.add(source.id);
    if (!isPublicSourceUrl(source.url)) return `Source ${source.id} must use a public HTTP or HTTPS URL.`;
    if (source.lastRelevantItemDate && !isCalendarDate(source.lastRelevantItemDate)) {
      return `Source ${source.id} has an invalid last relevant item date.`;
    }
    if (source.lastRelevantItemUrl && !isPublicSourceUrl(source.lastRelevantItemUrl)) {
      return `Source ${source.id} last relevant item URL must use public HTTP or HTTPS.`;
    }
    if (source.lastSuccessfulCheckAt &&
      (!Number.isFinite(Date.parse(source.lastSuccessfulCheckAt)) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(source.lastSuccessfulCheckAt))) {
      return `Source ${source.id} has an invalid last successful check timestamp.`;
    }
  }
  const targetIds = new Set<string>();
  for (const target of settings.watchlist) {
    if (targetIds.has(target.id)) return `Duplicate watch target id: ${target.id}`;
    targetIds.add(target.id);
  }
  return null;
}