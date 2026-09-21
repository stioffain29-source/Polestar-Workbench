import type { InsertReport, Report } from "@workspace/db";
import { REPORT_PROSE_KEYS } from "./reportProvenance";
import type { RegionalCoverageManifest } from "../../../workbench/src/lib/regionalWeekly";

function mergeJson(existing: unknown, rebuilt: unknown): unknown {
  if (rebuilt === undefined) return existing;
  if (
    !existing || typeof existing !== "object" || Array.isArray(existing) ||
    !rebuilt || typeof rebuilt !== "object" || Array.isArray(rebuilt)
  ) {
    return rebuilt;
  }
  const merged = { ...(existing as Record<string, unknown>) };
  for (const [key, value] of Object.entries(rebuilt as Record<string, unknown>)) {
    merged[key] = mergeJson(merged[key], value);
  }
  return merged;
}

function mergeRegionalHardNumbers(existing: unknown, rebuilt: unknown): unknown {
  const merged = mergeJson(existing, rebuilt);
  if (
    !merged || typeof merged !== "object" || Array.isArray(merged) ||
    !rebuilt || typeof rebuilt !== "object" || Array.isArray(rebuilt)
  ) {
    return merged;
  }
  const result = merged as Record<string, unknown>;
  const next = rebuilt as Record<string, unknown>;
  // These are engine-owned snapshots. They must exactly match this build,
  // rather than retaining hidden fields from an older engine version.
  for (const key of ["regionalCanonicalReport", "regionalEvidenceSnapshot"]) {
    if (Object.prototype.hasOwnProperty.call(next, key)) result[key] = next[key];
  }
  return result;
}

export function getRegionalCoverageManifest(
  hardNumbers: unknown,
): RegionalCoverageManifest | null {
  if (!hardNumbers || typeof hardNumbers !== "object") return null;
  const canonical = (hardNumbers as Record<string, unknown>).regionalCanonicalReport;
  if (!canonical || typeof canonical !== "object") return null;
  const manifest = (canonical as Record<string, unknown>).coverageManifest;
  return manifest && typeof manifest === "object"
    ? manifest as RegionalCoverageManifest
    : null;
}

export function matchesExpectedReportVersion(
  updatedAt: Date | null,
  expectedUpdatedAt: Date,
): boolean {
  return updatedAt?.getTime() === expectedUpdatedAt.getTime();
}

export function buildRegionalRebuildValues(
  target: Report,
  rebuilt: InsertReport,
): InsertReport {
  const values = {
    ...rebuilt,
    title: target.title,
    status: target.status,
    hardNumbers: mergeRegionalHardNumbers(target.hardNumbers, rebuilt.hardNumbers),
    proseProvenance: target.proseProvenance,
  } as InsertReport;
  const provenance =
    target.proseProvenance && typeof target.proseProvenance === "object"
      ? target.proseProvenance
      : {};
  for (const key of REPORT_PROSE_KEYS) {
    if (provenance[key]?.kind === "ANALYST_EDITED") {
      (values as Record<string, unknown>)[key] =
        (target as unknown as Record<string, unknown>)[key];
    }
  }
  return values;
}