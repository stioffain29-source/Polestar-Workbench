// Publication-calendar model.
//
// Pure helpers that turn the existing report products (topic reports, spot
// reports, country briefs) into a single "publication" stream the calendar
// page renders. No fetching, no side effects — the page passes in the data
// it already loaded via the existing list hooks.
//
// "Published date" maps to each product's natural issuance date:
//   topic report  -> issueDate   (the date printed on the report)
//   spot report   -> reportDate
//   country brief -> createdAt   (no issuance date exists)

import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";
import { TOPIC_LABELS } from "./topics";
import { canonicalTopic, type Cadence } from "./reportNaming";
import { classifyRegion } from "./cargoAnalysis";

// Structural inputs — kept loose so the generated API types pass straight in.
export interface TopicReportLike {
  id: number;
  title: string;
  topic: string;
  countrySlug?: string | null;
  status: string;
  issueDate: string;
  author?: string | null;
}

export interface SpotReportLike {
  id: number;
  title: string;
  status: string;
  reportDate: string;
  country?: string | null;
  category?: string | null;
}

export interface CountryReportLike {
  id: number;
  slug: string;
  name: string;
  region: string;
  createdAt: string;
}

export type PubKind = "topic" | "spot" | "country";

export const PUB_KIND_LABELS: Record<PubKind, string> = {
  topic: "Topic Report",
  spot: "Spot Report",
  country: "Country Brief",
};

// Distinct, brand-palette swatches per product type. Red stays reserved for
// the overdue status flag, so no type uses it.
export const PUB_KIND_COLORS: Record<PubKind, string> = {
  topic: "#465bff", // Electric Blue
  spot: "#363636", // Dusk Gray
  country: "#0b0a3d", // Midnight Blue
};

// Canonical topic product lines shown in the per-topic list. `protests` reports
// are the Flashpoint product, so they fold into `flashpoint`.
export const CALENDAR_TOPICS = [
  "fuel",
  "shipping",
  "cargo_watch",
  "flashpoint",
  "energy",
  "fertiliser",
] as const;

export function canonicalTopicKey(topic: string): string {
  return topic === "protests" ? "flashpoint" : topic;
}

/** "papua-new-guinea" -> "Papua New Guinea". */
export function slugToName(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Normalise any ISO value (date-only or full timestamp) to a local calendar
 * date key, YYYY-MM-DD. date-fns parses date-only strings as local midnight, so
 * pure dates never drift; full timestamps resolve to the local calendar day.
 */
export function toDateKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? "" : format(d, "yyyy-MM-dd");
}

/** Fold free-text region strings into the workbench's region vocabulary. */
export function normalizeRegion(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim().toLowerCase();
  if (/asia[- ]?pacific|apac|asia/.test(s)) return "APAC";
  if (/middle east|gulf|mena/.test(s)) return "Middle East";
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Region for a country name, using the shared classifier. */
export function regionForCountry(country: string | null | undefined): string {
  if (!country) return "";
  const r = classifyRegion(country);
  if (r === "Middle East" || r === "APAC") return r;
  return "Other";
}

export interface PubItem {
  key: string;
  kind: PubKind;
  typeLabel: string;
  title: string;
  /** Canonical topic key (topic reports only). */
  topicKey: string | null;
  topicLabel: string | null;
  country: string | null;
  region: string;
  /** Publication date, YYYY-MM-DD. */
  date: string;
  status: string | null;
  href: string;
}

export function buildPubItems(args: {
  topicReports: TopicReportLike[];
  spotReports: SpotReportLike[];
  countryReports: CountryReportLike[];
}): PubItem[] {
  const items: PubItem[] = [];

  for (const r of args.topicReports) {
    const tk = canonicalTopicKey(r.topic);
    const country = r.countrySlug ? slugToName(r.countrySlug) : null;
    items.push({
      key: `topic-${r.id}`,
      kind: "topic",
      typeLabel: PUB_KIND_LABELS.topic,
      title: r.title,
      topicKey: tk,
      topicLabel: TOPIC_LABELS[tk] ?? tk,
      country,
      region: country ? regionForCountry(country) : "Global",
      date: toDateKey(r.issueDate),
      status: r.status,
      href: `/reports/${r.id}`,
    });
  }

  for (const s of args.spotReports) {
    const country = s.country?.trim() || null;
    items.push({
      key: `spot-${s.id}`,
      kind: "spot",
      typeLabel: PUB_KIND_LABELS.spot,
      title: s.title,
      topicKey: null,
      topicLabel: s.category?.trim() || null,
      country,
      region: country ? regionForCountry(country) : "Unspecified",
      date: toDateKey(s.reportDate),
      status: s.status,
      href: `/spot-reports/${s.id}`,
    });
  }

  for (const c of args.countryReports) {
    const region = normalizeRegion(c.region) || regionForCountry(c.name) || "Other";
    items.push({
      key: `country-${c.id}`,
      kind: "country",
      typeLabel: PUB_KIND_LABELS.country,
      title: c.name,
      topicKey: null,
      topicLabel: null,
      country: c.name,
      region,
      date: toDateKey(c.createdAt),
      status: null,
      href: `/countries/${c.slug}`,
    });
  }

  return items.filter((i) => i.date);
}

export type PubFlag = "green" | "amber" | "red";

export interface PubFlagInfo {
  flag: PubFlag;
  label: string;
  color: string;
}

// Green: published in the last 7 days. Amber: 8-14. Red: over 14 (or never).
export const PUB_FLAG_COLORS: Record<PubFlag, string> = {
  green: "#6FB872",
  amber: "#E67E22",
  red: "#A33232",
};

export function pubFlag(daysSince: number | null): PubFlagInfo {
  if (daysSince === null) return { flag: "red", label: "No report", color: PUB_FLAG_COLORS.red };
  if (daysSince <= 7) return { flag: "green", label: "Current", color: PUB_FLAG_COLORS.green };
  if (daysSince <= 14) return { flag: "amber", label: "Ageing", color: PUB_FLAG_COLORS.amber };
  return { flag: "red", label: "Overdue", color: PUB_FLAG_COLORS.red };
}

/** Next expected issue date, derived from the product cadence. */
export function nextDueDate(lastDate: string, cadence: Cadence): string {
  const d = parseISO(lastDate);
  const nd = cadence === "Monthly" ? addMonths(d, 1) : addDays(d, 7);
  return format(nd, "yyyy-MM-dd");
}

export interface TopicRow {
  topicKey: string;
  topicLabel: string;
  cadence: Cadence;
  latest: PubItem | null;
  daysSince: number | null;
  flag: PubFlagInfo;
  nextDue: string | null;
}

/**
 * One row per supplied topic key, carrying its most-recent publication and
 * recency flag. Sorted by oldest last-publication first (never-published
 * topics float to the very top). Pass a narrowed `topicKeys` when a topic
 * filter is active so absent topics are not shown as overdue.
 */
export function buildTopicRows(
  topicItems: PubItem[],
  today: Date,
  topicKeys: readonly string[] = CALENDAR_TOPICS,
): TopicRow[] {
  const rows: TopicRow[] = topicKeys.map((tk) => {
    let latest: PubItem | null = null;
    for (const i of topicItems) {
      if (i.topicKey !== tk) continue;
      if (!latest || i.date > latest.date) latest = i;
    }
    const daysSince = latest ? differenceInCalendarDays(today, parseISO(latest.date)) : null;
    const cadence = canonicalTopic(tk).cadence;
    return {
      topicKey: tk,
      topicLabel: TOPIC_LABELS[tk] ?? tk,
      cadence,
      latest,
      daysSince,
      flag: pubFlag(daysSince),
      nextDue: latest ? nextDueDate(latest.date, cadence) : null,
    };
  });

  rows.sort((a, b) => {
    if (!a.latest && !b.latest) return a.topicLabel.localeCompare(b.topicLabel);
    if (!a.latest) return -1;
    if (!b.latest) return 1;
    return a.latest.date.localeCompare(b.latest.date);
  });

  return rows;
}
