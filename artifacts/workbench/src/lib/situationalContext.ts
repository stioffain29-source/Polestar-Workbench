import { format, isValid, parseISO } from "date-fns";
import type { ReliefWebReport } from "@workspace/api-client-react";

// Situational Context is a SUPPORTING layer drawn from UN OCHA ReliefWeb
// situational reports. It is presented alongside the incident analysis as
// background only and is NEVER counted as an incident. The builder here is the
// single source of truth for both the on-screen preview
// (SituationalContextSection) and the headless PDF exporters
// (drawSituationalContextPdf) so the two can never disagree.

export interface SituationalContextItem {
  id: string;
  title: string;
  org: string;
  date: Date | null;
  dateLabel: string;
  country: string;
  url: string;
}

function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = parseISO(s);
  return isValid(d) ? d : null;
}

/**
 * Normalise raw ReliefWeb reports into a capped, de-duplicated, date-sorted
 * list for display. Returns [] when there is nothing to show so callers can
 * render nothing. `opts.country` (case-insensitive) limits to one country,
 * matching either the primary country or any entry in `countries[]`.
 */
export function buildSituationalContext(
  reports: ReliefWebReport[] | undefined | null,
  opts: { max?: number; country?: string } = {},
): SituationalContextItem[] {
  const max = opts.max ?? 6;
  const wantCountry = (opts.country ?? "").trim().toLowerCase();

  const mapped = (reports ?? [])
    .filter((r) => r && r.title && r.url)
    .filter((r) => {
      if (!wantCountry) return true;
      const primary = (r.country ?? "").toLowerCase();
      if (primary === wantCountry) return true;
      return (r.countries ?? []).some(
        (c) => (c ?? "").toLowerCase() === wantCountry,
      );
    })
    .map((r): SituationalContextItem => {
      const date = toDate(r.publishedAt) ?? toDate(r.originalDate);
      const org = (r.sourceOrg ?? "").trim() || "UN OCHA ReliefWeb";
      return {
        id: r.externalId ?? String(r.id),
        title: r.title.trim(),
        org,
        date,
        dateLabel: date ? format(date, "dd MMM yyyy") : "",
        country: (r.country ?? "").trim(),
        url: r.url,
      };
    });

  const seen = new Set<string>();
  const deduped: SituationalContextItem[] = [];
  for (const it of mapped) {
    const key = `${it.url}::${it.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  deduped.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  return deduped.slice(0, max);
}

export const SITUATIONAL_CONTEXT_INTRO =
  "Supporting humanitarian context from UN OCHA ReliefWeb. These situational " +
  "reports add background to the incident picture and are never counted as incidents.";

export const SITUATIONAL_CONTEXT_HEADING = "Situational Context";
