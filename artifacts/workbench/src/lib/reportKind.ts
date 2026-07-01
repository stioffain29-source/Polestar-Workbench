// Report-kind registry. Jakarta is a CITY report (not a country report). Manila
// and Bangkok city reports are planned "in a similar fashion" and, once their
// data exists, only need a slug added here to inherit the city framing (cover
// kicker, PDF kind label, Countries-list badge). Keyed by slug; a display name
// is accepted too and normalised to the slug form. This is the single seam for
// the city-vs-country distinction — extend REPORT_KIND_BY_SLUG, nothing else.
export type ReportKind = "country" | "city";

const REPORT_KIND_BY_SLUG: Record<string, ReportKind> = {
  jakarta: "city",
  // manila: "city",   // planned — add when the Manila city report ships
  // bangkok: "city",  // planned — add when the Bangkok city report ships
};

function normalise(nameOrSlug: string): string {
  return nameOrSlug.trim().toLowerCase().replace(/\s+/g, "-");
}

export function reportKind(nameOrSlug: string | null | undefined): ReportKind {
  if (!nameOrSlug) return "country";
  return REPORT_KIND_BY_SLUG[normalise(nameOrSlug)] ?? "country";
}

export function isCityReport(nameOrSlug: string | null | undefined): boolean {
  return reportKind(nameOrSlug) === "city";
}

// "City Report" | "Country Report" — the human label used on covers and the PDF
// kind line.
export function reportKindLabel(nameOrSlug: string | null | undefined): string {
  return isCityReport(nameOrSlug) ? "City Report" : "Country Report";
}
