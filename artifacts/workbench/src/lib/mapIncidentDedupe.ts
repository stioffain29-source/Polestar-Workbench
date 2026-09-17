import { consolidateCountryStories } from "@/lib/countrySameStory";
import { SEV_RANK } from "@/lib/monitorDedupe";

export type MapIncidentCorroboration = {
  id: number;
  url: string;
  reportTitle: string;
  sourceAgency?: string | null;
};

export type MapIncidentDedupeRow = {
  id: number;
  topic: string;
  title: string;
  displayTitle?: string | null;
  summary?: string | null;
  country: string;
  location?: string | null;
  occurredAt: string;
  severity?: string | null;
  category?: string | null;
  eventClusterKey?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  resolvedUrl?: string | null;
  corroborations?: MapIncidentCorroboration[] | null;
};

type RowWithMembers<T> = T & { sourceMembers?: T[] };

function bestRepresentative<T extends MapIncidentDedupeRow>(rows: T[]): T {
  return rows.reduce((best, row) => {
    const rowRank = SEV_RANK[(row.severity ?? "").toLowerCase()] ?? 0;
    const bestRank = SEV_RANK[(best.severity ?? "").toLowerCase()] ?? 0;
    if (rowRank !== bestRank) return rowRank > bestRank ? row : best;
    const rowDate = Date.parse(row.occurredAt);
    const bestDate = Date.parse(best.occurredAt);
    return (Number.isNaN(rowDate) ? -Infinity : rowDate) >
      (Number.isNaN(bestDate) ? -Infinity : bestDate)
      ? row
      : best;
  });
}

function flattenMembers<T extends MapIncidentDedupeRow>(row: RowWithMembers<T>): T[] {
  const members = row.sourceMembers ?? [row];
  return members.flatMap((member) => {
    const nested = member as RowWithMembers<T>;
    return nested.sourceMembers ?? [member];
  });
}

function evidenceFor<T extends MapIncidentDedupeRow>(
  members: T[],
): MapIncidentCorroboration[] {
  const byUrl = new Map<string, MapIncidentCorroboration>();
  for (const member of members) {
    for (const corroboration of member.corroborations ?? []) {
      if (corroboration.url && !byUrl.has(corroboration.url)) {
        byUrl.set(corroboration.url, corroboration);
      }
    }
    const url = member.resolvedUrl?.trim() || member.sourceUrl?.trim();
    if (url && !byUrl.has(url)) {
      byUrl.set(url, {
        id: member.id,
        url,
        reportTitle: member.displayTitle?.trim() || member.title,
        sourceAgency: member.source ?? null,
      });
    }
  }
  return [...byUrl.values()];
}

function inferredEventFamilyKey(row: MapIncidentDedupeRow): string | null {
  const text = `${row.displayTitle ?? row.title} ${row.summary ?? ""}`.toLowerCase();
  const isThailandIndonesiaHaze =
    /\bthailand\b/.test(text)
    && /\bindonesia(?:n)?\b/.test(text)
    && (
      /\b(haze|smoke)\b/.test(text)
      || (/\b(fire|forest fire|burn(?:ed|ing|s)?)\b/.test(text) && /\b(wind|direction|air quality)\b/.test(text))
    );
  if (isThailandIndonesiaHaze) return "thailand-indonesia-transboundary-haze";

  const isAustralianVisaOverhaul =
    /\baustralia(?:n|'s)?\b/.test(text)
    && /\b(?:visa|visas|migration|immigration)\b/.test(text)
    && /\b(?:crackdown|overhaul|visa hopping|international students?|backpackers?)\b/.test(text);
  if (isAustralianVisaOverhaul) return "australia-visa-policy-overhaul";

  return null;
}

/**
 * Collapse high-confidence same-event records before they become map markers.
 *
 * The server-stamped event cluster is authoritative when present. Remaining
 * rows use the established conservative country-story matcher, scoped by both
 * topic and country so nearby or similarly worded events in different feeds
 * cannot merge. Every source URL from the collapsed rows is retained as marker
 * evidence.
 */
export function dedupeMapIncidents<T extends MapIncidentDedupeRow>(rows: T[]): T[] {
  const byScope = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.topic}|${row.country.trim().toLowerCase()}`;
    const scoped = byScope.get(key);
    if (scoped) scoped.push(row);
    else byScope.set(key, [row]);
  }

  return [...byScope.values()].flatMap((scopedRows) => {
    const authoritative = new Map<string, T[]>();
    const inferred = new Map<string, T[]>();
    const unclustered: T[] = [];
    for (const row of scopedRows) {
      const key = row.eventClusterKey?.trim();
      if (key) {
        const group = authoritative.get(key);
        if (group) group.push(row);
        else authoritative.set(key, [row]);
        continue;
      }
      const familyKey = inferredEventFamilyKey(row);
      if (!familyKey) {
        unclustered.push(row);
        continue;
      }
      const group = inferred.get(familyKey);
      if (group) group.push(row);
      else inferred.set(familyKey, [row]);
    }

    const clusteredRepresentatives: T[] = [
      ...authoritative.values(),
      ...inferred.values(),
    ].map(
      (members) =>
        ({
          ...bestRepresentative(members),
          sourceMembers: members,
        }) as T,
    );
    const storyRepresentatives = consolidateCountryStories([
      ...clusteredRepresentatives,
      ...unclustered,
    ]);

    return storyRepresentatives.map((representative) => {
      const members = flattenMembers(representative as RowWithMembers<T>);
      return {
        ...representative,
        corroborations: evidenceFor(members),
      };
    });
  });
}