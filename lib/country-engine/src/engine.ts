// The canonical-event pipeline orchestrator (owner brief §2-13).
//
// buildCanonicalEvents projects each EngineSourceInput to a SourceRecord,
// classifies it, attributes the physical country, dates the event, deduplicates
// into CanonicalEvents, assesses severity + impact, applies the §7 confidence
// gate, then applies analyst overrides LAST (they are authoritative).
//
// Output is DETERMINISTIC: same inputs -> identical results (stable sort by
// eventDate desc then id). Pure — no runtime dependencies.

import type {
  AnalystEventOverride,
  CanonicalEvent,
  CountryEngineConfig,
  EngineResult,
  EngineSourceInput,
  InclusionStatus,
  LocationPrecision,
  SourceRecord,
} from "./types";
import { assessSourceReliability, isGoogleNewsAggregation, resolveUnderlyingPublisher } from "./reliability";
import { classifyArticle } from "./classify";
import { attributeCountry } from "./attribution";
import { extractEventDate, isRecycled } from "./eventDate";
import { assessSeverity } from "./severity";
import { assessImpact } from "./impact";
import {
  buildDuplicateGroups,
  isResponseOnly,
  linkResponses,
  type DedupeCandidate,
  type ResponseCandidate,
} from "./dedupe";

// Per-input processed projection used internally before dedupe.
interface Processed {
  input: EngineSourceInput;
  record: SourceRecord;
  displayTitle: string;
  isEvent: boolean;
  eventStatus: CanonicalEvent["eventStatus"];
  exclusionReason: CanonicalEvent["exclusionReason"];
  issueCategory: CanonicalEvent["issueCategory"];
  issueSubcategory: string | null;
  classificationConfidence: number;
  physicalCountry: string;
  relatedCountry: string | null;
  isForeignVenue: boolean;
  eventDate: string | null;
  dateConfidence: number;
  recycled: boolean;
  city: string | null;
  provinceOrState: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision: LocationPrecision;
  locationConfidence: number;
  isEnglish: boolean;
  reattributed: boolean;
  // City-scoped configs only (§ city reports): true when the record carries no
  // gazetteer match inside the city footprint, so it must be excluded.
  outsideCityScope: boolean;
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Crude English vs Indonesian language detector (en / id). No dependencies.
const INDONESIAN_CUES =
  /\b(yang|dengan|dan|di|ke|dari|untuk|tewas|orang|kebakaran|banjir|gempa|warga|polisi|pelaku|korban|jalan|pada|karena|akan|telah|dua|tiga|serang)\b/i;

function detectLanguage(text: string): string {
  const t = text ?? "";
  if (!t.trim()) return "en";
  let idHits = (t.match(new RegExp(INDONESIAN_CUES.source, "gi")) ?? []).length;
  return idHits >= 2 ? "id" : "en";
}

// Resolve the event's location + precision from the config gazetteer (§23).
function resolveLocation(
  input: EngineSourceInput,
  displayTitle: string,
  config: CountryEngineConfig,
  isForeignVenue: boolean,
): {
  city: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  precision: LocationPrecision;
  confidence: number;
} {
  // Foreign-venue events are outside the home gazetteer -> country only.
  if (isForeignVenue) {
    return { city: null, province: null, lat: null, lng: null, precision: "Country only", confidence: 40 };
  }
  const haystack = `${input.location ?? ""} ${displayTitle} ${input.summary ?? ""}`.toLowerCase();
  // Longest gazetteer key first so "port moresby" wins over "moresby".
  const keys = Object.keys(config.gazetteer).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const re = new RegExp(`\\b${esc(key.toLowerCase())}\\b`, "i");
    if (re.test(haystack)) {
      const g = config.gazetteer[key];
      return {
        city: titleCase(key),
        province: g.province,
        lat: g.lat ?? input.latitude ?? null,
        lng: g.lng ?? input.longitude ?? null,
        precision: "Town or city",
        confidence: 85,
      };
    }
  }
  // Province-only match against explicit province field.
  if (input.province && input.province.trim()) {
    return {
      city: null,
      province: input.province,
      lat: input.latitude ?? null,
      lng: input.longitude ?? null,
      precision: "Province or state",
      confidence: 70,
    };
  }
  // Country named but no place -> country only.
  const countryRe = new RegExp(`\\b${esc(config.countryName.toLowerCase())}\\b`, "i");
  if (countryRe.test(haystack) || config.acceptedTokens.some((t) => new RegExp(`\\b${esc(t)}\\b`, "i").test(haystack))) {
    return { city: null, province: null, lat: input.latitude ?? null, lng: input.longitude ?? null, precision: "Country only", confidence: 50 };
  }
  return { city: null, province: null, lat: input.latitude ?? null, lng: input.longitude ?? null, precision: "Unknown", confidence: 20 };
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// True when the stored country tag matches the config's accepted tokens.
function storedTagMatches(country: string | null | undefined, config: CountryEngineConfig): boolean {
  const tokens = (country ?? "")
    .split(";")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const accepted = new Set(config.acceptedTokens.map((t) => t.toLowerCase()));
  return tokens.some((t) => accepted.has(t));
}

// Build a natural event title from the display title (never a raw wire
// headline masthead). Strips a trailing " - Publisher".
function naturalTitle(displayTitle: string): string {
  const parts = displayTitle.split(/\s[-–—]\s/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].trim();
    if (last.split(/\s+/).length <= 6 && !/[.!?]$/.test(last)) {
      return parts.slice(0, -1).join(" - ").trim();
    }
  }
  return displayTitle.trim();
}

function project(input: EngineSourceInput, config: CountryEngineConfig): Processed {
  const rawTitle = input.title ?? "";
  // Underlying publisher for Google News aggregation (§28); never "Google News".
  const publisher = isGoogleNewsAggregation(input.source, input.sourceUrl)
    ? resolveUnderlyingPublisher(input.source, rawTitle)
    : input.source ?? null;
  const displayTitle = (input.displayTitle && input.displayTitle.trim()) || rawTitle;
  const language = detectLanguage(rawTitle);
  const isEnglish = language === "en" || (!!input.displayTitle && input.displayTitle.trim().length > 0);

  const reliability = assessSourceReliability(input.source, input.sourceUrl, config, rawTitle);

  const cls = classifyArticle(
    { title: rawTitle, displayTitle: input.displayTitle, summary: input.summary, category: input.category },
    config,
  );
  const attr = attributeCountry(input, config);
  const date = extractEventDate(input);
  const recycled = date.recycled || isRecycled(input, date.eventDate);

  const loc = resolveLocation(input, displayTitle, config, attr.isForeignVenue);

  const record: SourceRecord = {
    sourceRecordId: input.id,
    sourceName: publisher || input.source || "Unknown",
    sourceUrl: input.sourceUrl ?? null,
    sourceType: isGoogleNewsAggregation(input.source, input.sourceUrl) ? "aggregator" : "news",
    publicationDate: input.occurredAt,
    retrievalDate: null,
    originalHeadline: rawTitle,
    articleText: input.summary ?? null,
    language,
    translatedText: input.displayTitle && input.displayTitle.trim() ? input.displayTitle : null,
    sourceReliability: reliability,
    sourceCountry: attr.physicalCountry,
    processingStatus: "processed",
  };

  return {
    input,
    record,
    displayTitle,
    isEvent: cls.isEvent,
    eventStatus: cls.eventStatus,
    exclusionReason: cls.exclusionReason,
    issueCategory: cls.issueCategory,
    issueSubcategory: cls.issueSubcategory,
    classificationConfidence: cls.classificationConfidence,
    physicalCountry: attr.physicalCountry,
    relatedCountry: attr.relatedCountry,
    isForeignVenue: attr.isForeignVenue,
    eventDate: date.eventDate,
    dateConfidence: date.dateConfidence,
    recycled,
    city: loc.city,
    provinceOrState: loc.province,
    latitude: loc.lat,
    longitude: loc.lng,
    locationPrecision: loc.precision,
    locationConfidence: loc.confidence,
    isEnglish,
    reattributed: !storedTagMatches(input.country, config) ||
      attr.physicalCountry.toLowerCase() !== config.countryName.toLowerCase(),
    // City scope (Jakarta): the gazetteer IS the city footprint, so a record
    // only belongs to the city brief when it resolved a gazetteer city match.
    // Nationwide home-country reporting (e.g. Surabaya under Indonesia) stays
    // out of the city run; national slugs are unaffected (cityScope unset).
    outsideCityScope: Boolean(config.cityScope) && !attr.isForeignVenue && loc.city == null,
  };
}

// Decide inclusion status per the §7 confidence gate.
function gateInclusion(p: Processed): { status: InclusionStatus; reason: CanonicalEvent["exclusionReason"] } {
  // Non-events / permanent exclusions are excluded with their stored reason.
  if (!p.isEvent) {
    return { status: "excluded", reason: p.exclusionReason };
  }
  // Foreign-venue events are excluded (§4/§5).
  if (p.isForeignVenue) {
    return { status: "excluded", reason: "foreign_venue" };
  }
  // Recycled / out-of-window republications are excluded (§6).
  if (p.recycled) {
    return { status: "excluded", reason: "recycled_or_out_of_window" };
  }
  // City-scoped reports: home-country records outside the city footprint are
  // excluded with a stored reason — never silently included.
  if (p.outsideCityScope) {
    return { status: "excluded", reason: "outside_city_scope" };
  }
  const c = p.classificationConfidence;
  // §7 confidence gate.
  if (c >= 85) return { status: "included", reason: null };
  if (c >= 70) {
    // Include only when location + date confidence also >= 70; else hold.
    if (p.locationConfidence >= 70 && p.dateConfidence >= 70) {
      return { status: "included", reason: null };
    }
    return { status: "held", reason: null };
  }
  if (c >= 50) return { status: "held", reason: null };
  return { status: "excluded", reason: "low_confidence" };
}

function eventSummary(p: Processed): string {
  const base = naturalTitle(p.displayTitle);
  return base;
}

// Build the canonical-event pipeline result.
export function buildCanonicalEvents(
  inputs: EngineSourceInput[],
  config: CountryEngineConfig,
  overrides?: AnalystEventOverride[],
): EngineResult {
  const processed = inputs.map((i) => project(i, config));
  const byId = new Map(processed.map((p) => [p.input.id, p]));

  // Response linking (§9) over the processed set.
  const responseCands: ResponseCandidate[] = processed.map((p) => {
    const text = `${p.displayTitle} ${p.input.summary ?? ""}`;
    return {
      id: p.input.id,
      title: text,
      eventDate: p.eventDate,
      physicalCountry: p.physicalCountry,
      city: p.city,
      category: p.issueCategory,
      // Response-only when the classifier flagged it OR the text is a pure
      // follow-up AND it is not itself a hard occurrence.
      isResponseOnly:
        p.exclusionReason === "response_only_followup" ||
        (isResponseOnly(text) && !p.isEvent),
      createsNewEffect: assessImpact({ title: p.displayTitle, summary: p.input.summary }).impactLevel === "Direct",
    };
  });
  const responseLinks = linkResponses(responseCands);
  const responseByOrigin = new Map<string, string[]>();
  const responseIds = new Set<string>();
  for (const link of responseLinks) {
    responseIds.add(link.responseId);
    const arr = responseByOrigin.get(link.originatingEventId) ?? [];
    arr.push(link.responseId);
    responseByOrigin.set(link.originatingEventId, arr);
  }

  // Deduplicate ONLY the genuine, home-country, non-recycled events (§8). Others
  // become their own (excluded/held) canonical rows.
  const mergeable = processed.filter(
    (p) =>
      p.isEvent &&
      !p.isForeignVenue &&
      !p.recycled &&
      !p.outsideCityScope &&
      !responseIds.has(p.input.id),
  );
  const dedupeCands: DedupeCandidate[] = mergeable.map((p) => ({
    id: p.input.id,
    title: p.displayTitle,
    eventDate: p.eventDate,
    physicalCountry: p.physicalCountry,
    city: p.city,
    provinceOrState: p.provinceOrState,
    category: p.issueCategory,
    reliability: p.record.sourceReliability,
    locationPrecision: p.locationPrecision,
    isEnglish: p.isEnglish,
  }));
  const groups = buildDuplicateGroups(dedupeCands);
  const groupedIds = new Set<string>();
  let duplicatesMerged = 0;

  const events: CanonicalEvent[] = [];

  // 1. One canonical event per duplicate group (§8).
  for (const g of groups) {
    if (g.supportingSourceIds.length > 1) duplicatesMerged += g.supportingSourceIds.length - 1;
    for (const id of g.supportingSourceIds) groupedIds.add(id);
    const rep = byId.get(g.representativeId)!;
    const publicationDates = g.supportingSourceIds
      .map((id) => byId.get(id)!.input.occurredAt)
      .filter(Boolean)
      .sort();
    const relatedResponses = responseByOrigin.get(g.representativeId) ?? [];
    const dup = g.supportingSourceIds.length > 1 ? g.groupId : null;
    events.push(
      makeEvent(rep, {
        supportingSourceIds: g.supportingSourceIds,
        publicationDates,
        duplicateGroupId: dup,
        relatedEventIds: relatedResponses,
        overrideRelated: relatedResponses,
      }),
    );
  }

  // 2. Every non-grouped processed row becomes its own canonical row
  //    (excluded / held), so EngineResult.events holds ALL rows.
  for (const p of processed) {
    if (groupedIds.has(p.input.id)) continue;
    const isResponse = responseIds.has(p.input.id);
    events.push(
      makeEvent(p, {
        supportingSourceIds: [p.input.id],
        publicationDates: [p.input.occurredAt].filter(Boolean),
        duplicateGroupId: null,
        relatedEventIds: [],
        forcedExclusion: isResponse ? "response_only_followup" : undefined,
      }),
    );
  }

  // 3. Apply analyst overrides LAST (authoritative).
  applyOverrides(events, overrides);

  // 4. Deterministic sort: eventDate desc, then id asc.
  events.sort((a, b) => {
    const da = a.eventDate ? Date.parse(a.eventDate) : -Infinity;
    const db = b.eventDate ? Date.parse(b.eventDate) : -Infinity;
    if (db !== da) return db - da;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });

  const included = events.filter((e) => e.inclusionStatus === "included");
  const held = events.filter((e) => e.inclusionStatus === "held");
  const excluded = events.filter((e) => e.inclusionStatus === "excluded");
  const reattributed = processed.filter((p) => p.reattributed).length;

  const sourceRecords = processed.map((p) => {
    const status: SourceRecord["processingStatus"] =
      held.some((e) => e.supportingSourceIds.includes(p.input.id))
        ? "held"
        : excluded.some((e) => e.supportingSourceIds.includes(p.input.id))
          ? "excluded"
          : "processed";
    return { ...p.record, processingStatus: status };
  });

  return {
    sourceRecords,
    events,
    included,
    held,
    excluded,
    stats: {
      sourcesProcessed: inputs.length,
      excluded: excluded.length,
      held: held.length,
      duplicatesMerged,
      reattributed,
    },
  };
}

function makeEvent(
  p: Processed,
  opts: {
    supportingSourceIds: string[];
    publicationDates: string[];
    duplicateGroupId: string | null;
    relatedEventIds: string[];
    overrideRelated?: string[];
    forcedExclusion?: CanonicalEvent["exclusionReason"];
  },
): CanonicalEvent {
  const gate = gateInclusion(p);
  const inclusionStatus: InclusionStatus = opts.forcedExclusion ? "excluded" : gate.status;
  const exclusionReason = opts.forcedExclusion ?? gate.reason;

  const sev = assessSeverity(
    {
      title: p.displayTitle,
      summary: p.input.summary,
      fatalities: p.input.fatalities,
      category: p.input.category,
      severity: p.input.severity,
    },
    p.issueCategory,
  );
  const impact = assessImpact({ title: p.displayTitle, summary: p.input.summary });

  return {
    eventId: p.input.id,
    eventTitle: naturalTitle(p.displayTitle),
    eventSummary: eventSummary(p),
    eventDate: p.eventDate,
    eventEndDate: null,
    publicationDates: opts.publicationDates,
    physicalCountry: p.physicalCountry,
    relatedCountry: p.relatedCountry,
    city: p.city,
    district: null,
    provinceOrState: p.provinceOrState,
    latitude: p.latitude,
    longitude: p.longitude,
    locationPrecision: p.locationPrecision,
    issueCategory: p.issueCategory,
    issueSubcategory: p.issueSubcategory,
    secondaryCategories: [],
    eventStatus: p.eventStatus,
    severity: sev.severity,
    severityReason: sev.severityReason,
    casualties: typeof p.input.fatalities === "number" ? p.input.fatalities : null,
    injuries: null,
    arrests: null,
    infrastructureImpact: null,
    transportImpact: null,
    commercialImpact: null,
    staffImpact: null,
    siteImpact: null,
    continuityImpact: null,
    confirmedOperationalEffect: impact.confirmedOperationalEffect,
    assessedOperationalRelevance: impact.assessedOperationalRelevance,
    impactLevel: impact.impactLevel,
    classificationConfidence: p.classificationConfidence,
    locationConfidence: p.locationConfidence,
    dateConfidence: p.dateConfidence,
    supportingSourceIds: opts.supportingSourceIds,
    duplicateGroupId: opts.duplicateGroupId,
    relatedEventIds: opts.relatedEventIds,
    inclusionStatus,
    exclusionReason,
  };
}

function applyOverrides(events: CanonicalEvent[], overrides?: AnalystEventOverride[]): void {
  if (!overrides || overrides.length === 0) return;
  const byId = new Map(events.map((e) => [e.eventId, e]));
  for (const ov of overrides) {
    const ev = byId.get(ov.eventId);
    if (!ev) continue;
    if (ov.physicalCountry !== undefined) ev.physicalCountry = ov.physicalCountry;
    if (ov.eventDate !== undefined) ev.eventDate = ov.eventDate;
    if (ov.issueCategory !== undefined) ev.issueCategory = ov.issueCategory;
    if (ov.locationPrecision !== undefined) ev.locationPrecision = ov.locationPrecision;
    if (ov.severity !== undefined) ev.severity = ov.severity;
    if (ov.inclusionStatus !== undefined) ev.inclusionStatus = ov.inclusionStatus;
    if (ov.exclusionReason !== undefined) ev.exclusionReason = ov.exclusionReason;

    // Merge: fold this event's sources into the target and mark it duplicate.
    if (ov.mergeIntoEventId) {
      const target = byId.get(ov.mergeIntoEventId);
      if (target) {
        target.supportingSourceIds = Array.from(
          new Set([...target.supportingSourceIds, ...ev.supportingSourceIds]),
        ).sort();
        target.publicationDates = Array.from(
          new Set([...target.publicationDates, ...ev.publicationDates]),
        ).sort();
        ev.inclusionStatus = "excluded";
        ev.exclusionReason = "duplicate";
        ev.duplicateGroupId = target.eventId;
      }
    }

    // Split: carve named sources out (they remain in the split-out event; here
    // we simply remove them from this event's supporting set).
    if (ov.splitSourceIds && ov.splitSourceIds.length > 0) {
      const split = new Set(ov.splitSourceIds);
      ev.supportingSourceIds = ev.supportingSourceIds.filter((id) => !split.has(id));
    }
  }
}
