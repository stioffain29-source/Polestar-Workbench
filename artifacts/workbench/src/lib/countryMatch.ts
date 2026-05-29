// Country matching for the Country Report builder.
//
// The incidents feed stores `country` as a free-text, semicolon-separated
// list (e.g. "Papua New Guinea", "West Papua; Papua New Guinea",
// "United Arab Emirates; Iran"). A plain equality match misses compound
// tags and — worse for the Papua/PNG pair — a substring match would let
// "Papua New Guinea" leak into the Indonesian "Papua" report and vice
// versa. This module resolves a report's canonical country name to the
// set of acceptable country *tokens* and matches an incident only when
// one of its tokens is an exact (case-insensitive) member of that set.
//
// A record tagged with tokens from both groups (e.g. "West Papua; Papua
// New Guinea") is genuinely cross-border and is intentionally included in
// both reports. Single-group records never cross over.

// Canonical report name -> accepted country tokens. Names not listed here
// default to a single-token group of their own name, which still picks up
// compound tags (e.g. the UAE report matches "United Arab Emirates; Iran").
const COUNTRY_GROUPS: Record<string, string[]> = {
  "papua new guinea": ["papua new guinea", "png"],
  papua: [
    "papua",
    "west papua",
    "highland papua",
    "papua pegunungan",
    "central papua",
    "papua tengah",
    "south papua",
    "papua selatan",
    "southwest papua",
    "papua barat daya",
  ],
};

/** Split a free-text country field into normalised, lower-cased tokens. */
function countryTokens(field: string | null | undefined): string[] {
  if (!field) return [];
  return field
    .split(";")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** Accepted country tokens for a given report name. */
export function acceptedCountryTokens(reportName: string): string[] {
  const key = (reportName ?? "").trim().toLowerCase();
  return COUNTRY_GROUPS[key] ?? (key ? [key] : []);
}

/**
 * True when an incident's `country` field contains at least one token that
 * is an exact member of the report's accepted-token set. Cross-border
 * records (tokens from more than one group) match every group they touch.
 */
export function incidentMatchesCountry(
  incidentCountry: string | null | undefined,
  reportName: string,
): boolean {
  const accepted = acceptedCountryTokens(reportName);
  if (accepted.length === 0) return false;
  const acceptedSet = new Set(accepted);
  return countryTokens(incidentCountry).some((t) => acceptedSet.has(t));
}
