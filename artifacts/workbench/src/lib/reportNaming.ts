// Canonical naming for topic reports.
//
// One source of truth used by:
//   - Reports page cards
//   - Report editor header + title seeding
//   - Report preview cover + running header
//   - PDF exporters (topic + shipping) cover + running header
//
// Country reports are NOT topic reports and must not pass through here.
//
// Rule: regional words (APAC, South Asia, Gulf, Hormuz, Malacca) are scope,
// not title. They only appear if a specific scope is selected on the report.

export type Cadence = "Weekly" | "Monthly";

export interface CanonicalTopic {
  /** Topic-line label shown above the title (e.g. "Energy / Grid"). */
  topicLine: string;
  /** Reporting cadence label. */
  cadence: Cadence;
  /** Canonical report title (e.g. "Shipping Watch"). */
  title: string;
  /** Optional subtitle / scope blurb (currently only Flashpoint uses it). */
  subtitle?: string;
}

export const CANONICAL_TOPIC: Record<string, CanonicalTopic> = {
  fuel:        { topicLine: "Fuel",          cadence: "Weekly",  title: "Fuel Watch" },
  shipping:    { topicLine: "Shipping",      cadence: "Weekly",  title: "Shipping Watch" },
  cargo_watch: { topicLine: "Cargo Watch",   cadence: "Monthly", title: "Cargo Watch" },
  flashpoint:  { topicLine: "Flashpoint",    cadence: "Weekly",  title: "Flashpoint", subtitle: "Activism, Protests & Civil Unrest" },
  protests:    { topicLine: "Flashpoint",    cadence: "Weekly",  title: "Flashpoint", subtitle: "Activism, Protests & Civil Unrest" },
  energy:      { topicLine: "Energy / Grid", cadence: "Weekly",  title: "Energy Watch" },
  fertiliser:  { topicLine: "Fertiliser",    cadence: "Monthly", title: "Fertiliser Watch" },
  conflict:    { topicLine: "Conflict",      cadence: "Monthly", title: "Conflict Watch", subtitle: "Armed Conflict, Insurgency & Armed Crime" },
};

export function canonicalTopic(topic: string): CanonicalTopic {
  return CANONICAL_TOPIC[topic] ?? { topicLine: topic, cadence: "Weekly", title: topic };
}

export function canonicalReportTitle(topic: string): string {
  return canonicalTopic(topic).title;
}

export function canonicalCadenceBriefing(topic: string): string {
  return `${canonicalTopic(topic).cadence} Briefing`;
}

// Old regional default titles that the cleanup is replacing. A stored title
// that exactly matches one of these is treated as "still on the default" and
// gets transparently replaced with the canonical title. Anything else is
// considered an intentional manual edit and is preserved.
const OLD_DEFAULT_TITLES: ReadonlySet<string> = new Set([
  "APAC Fuel Watch",
  "APAC Cargo Watch",
  "APAC Energy Watch",
  "APAC Flashpoint",
  "South Asia Fertiliser Watch",
  "Hormuz Maritime Watch",
]);

export function isOldDefaultTitle(stored: string | null | undefined): boolean {
  if (!stored) return false;
  return OLD_DEFAULT_TITLES.has(stored.trim());
}

/**
 * Decide what title to show / seed for a topic report.
 *
 * Preserves user-edited titles. Replaces empty titles and the well-known old
 * regional defaults with the canonical title. The database is never touched
 * by this helper — callers may persist the resolved value if they choose.
 */
export function resolveReportTitle(topic: string, storedTitle: string | null | undefined): string {
  const t = (storedTitle ?? "").trim();
  if (!t || isOldDefaultTitle(t)) return canonicalReportTitle(topic);
  return t;
}
