import type {
  ReportProseProvenance,
  ReportProseSectionProvenance,
  ReportProseProvenanceKind,
  Report,
  ReportProse,
} from "@workspace/db";

/**
 * All prose-bearing report columns. Reads are included because they are
 * rendered narrative sections too, while conflictAreaReads is intentionally
 * handled as one value by the report editor (and is therefore not inferred
 * from individual theatre keys here).
 */
export const REPORT_PROSE_KEYS = [
  "executiveSummary",
  "situation",
  "whatHappened",
  "whatMatters",
  "implications",
  "watchNext",
  "polestarView",
  "activismRead",
  "civilUnrestRead",
  "forecastRead",
  "regionalCountryRead",
  "chokepointRouteRead",
  "vesselPiracyRead",
  "commercialImpactRead",
  "maritimeSecurityRead",
  "cargoSecurityRead",
  "logisticsHubRead",
  "fuelMarketRead",
  "fuelOperationalRead",
  "fuelRegionalHighlights",
  "conflictOtherWatchedRead",
  "conflictAreaReads",
] as const;

export type ReportProseKey = (typeof REPORT_PROSE_KEYS)[number];

function isKind(value: unknown): value is ReportProseProvenanceKind {
  return (
    value === "GENERATED" ||
    value === "CACHED_AI" ||
    value === "ANALYST_EDITED" ||
    value === "GENERATED_UNKNOWN"
  );
}

function entry(value: unknown): ReportProseSectionProvenance | null {
  // Accept the old compact shape as a read-only compatibility measure. New
  // writes always use the object shape so basis fingerprints are retained.
  if (typeof value === "string" && isKind(value)) return { kind: value };
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isKind(candidate.kind)) return null;
  return {
    kind: candidate.kind,
    fingerprint:
      typeof candidate.fingerprint === "string"
        ? candidate.fingerprint
        : null,
    generationBasisFingerprint:
      typeof candidate.generationBasisFingerprint === "string"
        ? candidate.generationBasisFingerprint
        : null,
  };
}

export function normaliseReportProvenance(
  value: unknown,
): ReportProseProvenance {
  if (!value || typeof value !== "object") return {};
  const result: ReportProseProvenance = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const parsed = entry(raw);
    if (parsed) result[key] = parsed;
  }
  return result;
}

function exactEditedCacheProof(
  report: Report,
  key: string,
  value: unknown,
  cache: ReportProse | null | undefined,
): ReportProseSectionProvenance | null {
  if (!cache?.edited || typeof value !== "string") return null;
  const editedValue = (cache.edited as unknown as Record<string, unknown>)[key];
  if (editedValue !== value || !cache.editedFingerprint) return null;

  // A legacy report has no provenance row to point at. Require the cache's
  // recorded edit fingerprint and, when both are available, the same domain
  // basis as the report before treating the text as a genuine analyst edit.
  const reportBasis = report.proseBasisFingerprint ?? null;
  const editedBasis = cache.editedGenerationBasisFingerprint ?? null;
  if (reportBasis && editedBasis && reportBasis !== editedBasis) return null;
  if (!reportBasis && !editedBasis) return null;
  return {
    kind: "ANALYST_EDITED",
    fingerprint: cache.editedFingerprint,
    generationBasisFingerprint: editedBasis,
  };
}

/**
 * Merge provenance while applying a report PATCH. `dirtySections` is the only
 * path which can produce ANALYST_EDITED. This is intentionally server-side
 * enforced: a non-empty text field, or a client-supplied provenance label,
 * can never manufacture analyst authorship.
 */
export function mergeReportProvenance(
  report: Report,
  patch: Record<string, unknown>,
  cache: ReportProse | null | undefined,
  dirtySections: readonly string[] = [],
): ReportProseProvenance {
  const merged = normaliseReportProvenance(report.proseProvenance);
  const dirty = new Set(dirtySections);
  const basis =
    typeof patch.proseBasisFingerprint === "string"
      ? patch.proseBasisFingerprint
      : report.proseBasisFingerprint ?? null;

  for (const key of REPORT_PROSE_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (dirty.has(key)) {
      merged[key] = {
        kind: "ANALYST_EDITED",
        fingerprint: cache?.fingerprint ?? null,
        generationBasisFingerprint:
          cache?.generationBasisFingerprint ?? basis,
      };
      continue;
    }

    const legacyEdit = exactEditedCacheProof(report, key, value, cache);
    if (!report.proseProvenance && legacyEdit) {
      merged[key] = legacyEdit;
      continue;
    }

    const cachedValue =
      cache?.sections && typeof value === "string"
        ? (cache.sections as unknown as Record<string, unknown>)[key]
        : undefined;
    if (cachedValue === value && cache) {
      merged[key] = {
        kind: "CACHED_AI",
        fingerprint: cache.fingerprint,
        generationBasisFingerprint:
          cache.generationBasisFingerprint ?? basis,
      };
      continue;
    }

    // If a known analyst value is being carried through an unrelated PATCH,
    // preserve its authorship. Explicitly changing a section without marking it
    // dirty is never upgraded to analyst provenance.
    if (merged[key]?.kind === "ANALYST_EDITED" && report[key as keyof Report] === value) {
      continue;
    }

    const changed =
      JSON.stringify(report[key as keyof Report] ?? null) !==
      JSON.stringify(value ?? null);
    merged[key] = {
      // A PATCH carrying a changed deterministic projection (or an explicit
      // current basis) is a new generated save. A legacy value merely being
      // non-empty is not: it remains GENERATED_UNKNOWN.
      kind:
        report.proseProvenance ||
        changed ||
        Object.prototype.hasOwnProperty.call(patch, "proseBasisFingerprint")
          ? "GENERATED"
          : "GENERATED_UNKNOWN",
      fingerprint: basis,
      generationBasisFingerprint: basis,
    };
  }
  return merged;
}
