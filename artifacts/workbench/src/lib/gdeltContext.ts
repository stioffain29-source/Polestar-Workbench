import { format, isValid, parseISO } from "date-fns";
import type { GdeltStructuredItem } from "@workspace/api-client-react";
import { acceptedCountryTokens } from "./countryMatch";

// GDELT open-source context for country reports. Lane-bearing events that have
// already been promoted into incidents are omitted here so they are not shown
// twice — they appear in the incident picture above. Stories (lane=null) and
// events not yet promoted surface as supporting background only.

export interface GdeltContextItem {
  id: string;
  kind: "event" | "story";
  title: string;
  summary: string;
  date: Date | null;
  dateLabel: string;
  country: string;
  location: string;
  lane: string | null;
  subBucket: string | null;
  url: string;
}

export const GDELT_CONTEXT_HEADING = "GDELT Open-Source Context";
export const GDELT_CONTEXT_INTRO =
  "Supporting open-source context from GDELT Cloud daily Events and Stories for " +
  "this theatre. Lane-bearing events also feed the incident picture when promoted; " +
  "stories add background only and are never counted as incidents.";

const GDELT_MONITORED = new Set([
  "indonesia",
  "philippines",
  "thailand",
  "papua new guinea",
  "papua",
  "jakarta",
]);

function toDate(s: string | Date | null | undefined): Date | null {
  if (!s) return null;
  if (s instanceof Date) return isValid(s) ? s : null;
  const d = parseISO(s);
  return isValid(d) ? d : null;
}

function itemUrl(item: GdeltStructuredItem): string | null {
  return item.url ?? item.primaryStoryUrl ?? null;
}

/** Country reports that carry a GDELT structured pull. */
export function isGdeltMonitoredReport(reportName: string): boolean {
  const key = (reportName ?? "").trim().toLowerCase();
  return GDELT_MONITORED.has(key);
}

/**
 * Match a GDELT structured row to the same country routing the report uses
 * (national Indonesia vs Jakarta vs Indonesian Papua vs PNG, etc.).
 */
export function gdeltItemMatchesCountryReport(
  item: GdeltStructuredItem,
  reportName: string,
): boolean {
  const country = (item.country ?? "").trim();
  if (!country) return false;

  const tokens = acceptedCountryTokens(reportName);
  const sub = item.subBucket ?? null;

  if (tokens.includes("jakarta")) {
    return country === "Indonesia" && sub === "Jakarta";
  }
  if (tokens.includes("papua") && !tokens.includes("papua new guinea")) {
    return country === "Indonesia" && sub === "Indonesian Papua";
  }
  if (
    tokens.includes("indonesia") &&
    !tokens.includes("jakarta") &&
    !tokens.includes("papua")
  ) {
    return (
      country === "Indonesia" &&
      sub !== "Indonesian Papua" &&
      sub !== "Jakarta"
    );
  }
  if (tokens.includes("papua new guinea")) {
    return country === "Papua New Guinea";
  }
  if (tokens.includes("philippines")) return country === "Philippines";
  if (tokens.includes("thailand")) return country === "Thailand";
  return false;
}

/**
 * Normalise GDELT structured items into a capped, date-sorted context list for
 * display. Promoted event externalIds are skipped so promoted rows only appear
 * once (in the incident sections).
 */
export function buildGdeltContext(
  items: GdeltStructuredItem[] | undefined | null,
  opts: {
    country: string;
    max?: number;
    promotedExternalIds?: Set<string>;
  },
): GdeltContextItem[] {
  const max = opts.max ?? 12;
  const promoted = opts.promotedExternalIds ?? new Set<string>();
  const reportName = opts.country;

  if (!isGdeltMonitoredReport(reportName)) return [];

  const mapped = (items ?? [])
    .filter((it) => it && it.title && itemUrl(it))
    .filter((it) => gdeltItemMatchesCountryReport(it, reportName))
    .filter((it) => {
      if (it.kind === "story") return true;
      if (it.kind !== "event") return false;
      return !promoted.has(it.externalId);
    })
    .map((it): GdeltContextItem => {
      const date = toDate(it.sourceDate);
      const url = itemUrl(it)!;
      return {
        id: it.externalId,
        kind: it.kind,
        title: it.title.trim(),
        summary: (it.summary ?? "").trim(),
        date,
        dateLabel: date ? format(date, "dd MMM yyyy") : "",
        country: (it.country ?? "").trim(),
        location: (it.location ?? "").trim(),
        lane: it.lane ?? null,
        subBucket: it.subBucket ?? null,
        url,
      };
    });

  const seen = new Set<string>();
  const deduped: GdeltContextItem[] = [];
  for (const it of mapped) {
    const key = `${it.url}::${it.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  deduped.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  return deduped.slice(0, max);
}
