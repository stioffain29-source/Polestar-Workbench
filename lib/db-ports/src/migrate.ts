import type {
  DbPortsEvidence,
  DbPortsImpactArea,
  DbPortsItem,
  DbPortsParameters,
  DbPortsSeverity,
} from "@workspace/api-client-react";
import { DEFAULT_DB_PORTS_PARAMETERS } from "./defaults.js";
import {
  DB_PORTS_IMPACT_AREAS,
  DB_PORTS_ITEM_MIN_WORDS,
  DB_PORTS_OVERVIEW_MAX_WORDS,
  DB_PORTS_OVERVIEW_MIN_WORDS,
  DB_PORTS_SEVERITIES,
  DB_PORTS_THEMES,
  canonicalDbPortsTheme,
  emptyDbPortsItem,
  isCalendarDate,
} from "./rules.js";

type Raw = Record<string, unknown>;

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function calendarDate(value: unknown): string | null {
  return typeof value === "string" && isCalendarDate(value) ? value : null;
}

function severity(value: unknown): DbPortsSeverity | null {
  return typeof value === "string" && (DB_PORTS_SEVERITIES as string[]).includes(value)
    ? value as DbPortsSeverity
    : null;
}

function normaliseEvidence(value: unknown): DbPortsEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Raw;
    const sourceUrl = str(raw.sourceUrl);
    if (!sourceUrl) return [];
    const sourceType = str(raw.sourceType, "news");
    return [{
      id: str(raw.id) || `evidence-${index + 1}`,
      sourceName: str(raw.sourceName) || "Publisher not identified",
      sourceUrl,
      sourceType: (["official", "specialist", "news", "discovery"].includes(sourceType)
        ? sourceType
        : "news") as DbPortsEvidence["sourceType"],
      publishedDate: calendarDate(raw.publishedDate),
      sourceDate: calendarDate(raw.sourceDate),
      retrievedAt: str(raw.retrievedAt) || new Date().toISOString(),
      excerpt: str(raw.excerpt).slice(0, 800),
      originalTitle: str(raw.originalTitle).slice(0, 1000),
      sourceRecord: typeof raw.sourceRecord === "string" ? raw.sourceRecord : null,
      verified: bool(raw.verified, false),
    }];
  });
}

/** Reads an item persisted by any earlier revision of this report and returns
 * the current shape. Pilot-only review and worklog fields are dropped; the
 * analyst's written text is carried across under its current field name. */
export function normaliseStoredItem(value: unknown, index = 0): DbPortsItem {
  const raw = (value && typeof value === "object" ? value : {}) as Raw;
  const base = emptyDbPortsItem();
  const disposition = str(raw.disposition, "inbox");
  return {
    ...base,
    headline: str(raw.headline).slice(0, 500),
    country: str(raw.country),
    location: str(raw.location),
    assets: strings(raw.assets),
    eventDate: calendarDate(raw.eventDate),
    theme: canonicalDbPortsTheme(raw.theme),
    disposition: (["inbox", "selected", "watch", "hold", "rejected"].includes(disposition)
      ? disposition
      : "inbox") as DbPortsItem["disposition"],
    severity: severity(raw.severity),
    confidence: (["unverified", "single_source", "corroborated", "official"].includes(str(raw.confidence))
      ? str(raw.confidence)
      : "unverified") as DbPortsItem["confidence"],
    summary: str(raw.summary, str(raw.confirmedFacts)).slice(0, 8000),
    unverifiedClaims: str(raw.unverifiedClaims).slice(0, 4000),
    operationalImpact: str(raw.operationalImpact, str(raw.operationalImplications)).slice(0, 4000),
    polestarView: str(raw.polestarView).slice(0, 4000),
    outlook: str(raw.outlook).slice(0, 4000),
    materialityReason: str(raw.materialityReason).slice(0, 2000),
    impactAreas: strings(raw.impactAreas)
      .filter((area): area is DbPortsImpactArea => (DB_PORTS_IMPACT_AREAS as string[]).includes(area)),
    missingInfo: str(raw.missingInfo).slice(0, 4000),
    analystNotes: str(raw.analystNotes).slice(0, 4000),
    evidence: normaliseEvidence(raw.evidence).slice(0, 12),
    id: str(raw.id) || `item-${index + 1}`,
    mergedInto: typeof raw.mergedInto === "string" ? raw.mergedInto : null,
    updatedAt: str(raw.updatedAt) || new Date().toISOString(),
    drafted: bool(raw.drafted, false),
    warnings: [],
  };
}

export function normaliseStoredItems(value: unknown): DbPortsItem[] {
  return Array.isArray(value) ? value.map((entry, index) => normaliseStoredItem(entry, index)) : [];
}

/** Falls back to the saved preset for any parameter an older edition predates. */
export function normaliseParameters(
  value: unknown,
  preset: DbPortsParameters = DEFAULT_DB_PORTS_PARAMETERS,
): DbPortsParameters {
  const raw = (value && typeof value === "object" ? value : {}) as Raw;
  const themes = strings(raw.includedThemes).filter(theme => (DB_PORTS_THEMES as string[]).includes(theme));
  return {
    reportTitle: str(raw.reportTitle, preset.reportTitle).slice(0, 200),
    customerName: str(raw.customerName, preset.customerName).slice(0, 200),
    publicationDate: calendarDate(raw.publicationDate),
    targetItems: integer(raw.targetItems, preset.targetItems, 1, 40),
    includedCountries: strings(raw.includedCountries).length
      ? strings(raw.includedCountries).slice(0, 80)
      : [...preset.includedCountries],
    includedThemes: themes.length ? themes as DbPortsParameters["includedThemes"] : [...preset.includedThemes],
    excludedRegions: Array.isArray(raw.excludedRegions)
      ? strings(raw.excludedRegions).slice(0, 80)
      : [...preset.excludedRegions],
    excludedSubjects: Array.isArray(raw.excludedSubjects)
      ? strings(raw.excludedSubjects).slice(0, 80)
      : [...preset.excludedSubjects],
    minimumSeverity: severity(raw.minimumSeverity) ?? preset.minimumSeverity,
    priorityAssets: Array.isArray(raw.priorityAssets)
      ? strings(raw.priorityAssets).slice(0, 100)
      : [...preset.priorityAssets],
    // The same bounds the API validates against, so a stored edition can never
    // normalise into a configuration the server would refuse to save.
    itemWordTarget: integer(raw.itemWordTarget, preset.itemWordTarget, DB_PORTS_ITEM_MIN_WORDS, 600),
    overviewWordTarget: integer(
      raw.overviewWordTarget, preset.overviewWordTarget,
      DB_PORTS_OVERVIEW_MIN_WORDS, DB_PORTS_OVERVIEW_MAX_WORDS,
    ),
    includeWatchlist: bool(raw.includeWatchlist, preset.includeWatchlist),
    includeSourceLinks: bool(raw.includeSourceLinks, preset.includeSourceLinks),
  };
}
