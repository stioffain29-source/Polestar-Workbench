// Event dating (owner brief §6): use the date on which the event OCCURRED, not
// the publication date. Retrospective / anniversary cues mark an OLD event that
// must not be counted as a new incident, with low date confidence.
//
// Pure — no runtime dependencies (no date-fns). All date maths is done with the
// built-in Date on ISO strings only.

import type { EngineSourceInput } from "./types";

export interface EventDateResult {
  eventDate: string | null; // ISO date (YYYY-MM-DD) or null when unknown
  dateConfidence: number; // 0-100
  recycled: boolean; // out-of-window / retrospective republication
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const DAY_MS = 86_400_000;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function englishText(input: EngineSourceInput): string {
  const title = (input.displayTitle && input.displayTitle.trim()) || input.title || "";
  return `${title} ${input.summary ?? ""}`.toLowerCase();
}

// Retrospective cues indicate an OLD event referenced from a later date.
const RETROSPECTIVE_RE =
  /\b(a year after|years after|anniversary of|on the anniversary|months after|weeks after|to mark|commemorat\w*|remember\w*|back in|in \d{4}|last year|revisit\w*|looking back|retrospective|one year on|a decade)\b/i;

// Extract the event date per §6. Preference order:
//   1. explicit incidentDate
//   2. explicit absolute date cues in the text (e.g. "12 March", "March 2023")
//   3. relative cues ("on Monday", "last week", "yesterday") vs publicationDate
//   4. fall back to publicationDate with modest confidence
// Retrospective cues drop confidence and flag recycled.
export function extractEventDate(input: EngineSourceInput): EventDateResult {
  const pub = parseIso(input.occurredAt) ?? parseIso(input.incidentDate);
  const text = englishText(input);
  const retrospective = RETROSPECTIVE_RE.test(text);

  // 1. Explicit extracted event date is authoritative.
  const explicit = parseIso(input.incidentDate);
  if (explicit) {
    const recycled = isOutOfWindow(pub, explicit) || retrospective;
    return {
      eventDate: toIsoDate(explicit),
      dateConfidence: recycled ? 40 : 90,
      recycled,
    };
  }

  // 2. Absolute date cues in text.
  const absolute = parseAbsoluteDate(text, pub);
  if (absolute) {
    const recycled = isOutOfWindow(pub, absolute) || retrospective;
    return {
      eventDate: toIsoDate(absolute),
      dateConfidence: recycled ? 45 : 80,
      recycled,
    };
  }

  // 3. Relative cues resolved against the publication date.
  if (pub) {
    const relative = parseRelativeDate(text, pub);
    if (relative) {
      const recycled = retrospective || isOutOfWindow(pub, relative);
      return {
        eventDate: toIsoDate(relative),
        dateConfidence: recycled ? 45 : 75,
        recycled,
      };
    }
  }

  // 4. Retrospective piece with no resolvable date -> unknown, low confidence.
  if (retrospective) {
    // Try to pull an explicit year mentioned in the text.
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    if (yearMatch && pub) {
      const year = Number(yearMatch[0]);
      if (year < pub.getUTCFullYear()) {
        return {
          eventDate: `${year}-01-01`,
          dateConfidence: 30,
          recycled: true,
        };
      }
    }
    return { eventDate: null, dateConfidence: 20, recycled: true };
  }

  // 5. Fall back to publication date (a fresh report of a same-day event). A
  //    fresh, non-retrospective report is reasonably dated to its publication
  //    day, so this carries moderate confidence (§6).
  if (pub) {
    return { eventDate: toIsoDate(pub), dateConfidence: 70, recycled: false };
  }
  return { eventDate: null, dateConfidence: 0, recycled: false };
}

// True when the resolved event date is more than ~35 days before publication
// (outside a normal monthly reporting window) — a republished old incident.
function isOutOfWindow(pub: Date | null, event: Date): boolean {
  if (!pub) return false;
  return pub.getTime() - event.getTime() > 35 * DAY_MS;
}

// Parse an absolute date cue ("12 March 2023", "March 12", "on 3 April").
function parseAbsoluteDate(text: string, pub: Date | null): Date | null {
  const pubYear = pub ? pub.getUTCFullYear() : new Date(Date.parse("2000-01-01")).getUTCFullYear();

  // Numeric ISO date inside the text.
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (!Number.isNaN(d.getTime())) return d;
  }

  // "12 March 2023" / "12 March" / "march 12, 2023" / "march 12"
  const dmY = text.match(/\b(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?\b/);
  if (dmY && MONTHS[dmY[2]] !== undefined) {
    const day = Number(dmY[1]);
    const month = MONTHS[dmY[2]];
    const year = dmY[3] ? Number(dmY[3]) : pubYear;
    if (day >= 1 && day <= 31) return new Date(Date.UTC(year, month, day));
  }
  const mDy = text.match(/\b([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/);
  if (mDy && MONTHS[mDy[1]] !== undefined) {
    const month = MONTHS[mDy[1]];
    const day = Number(mDy[2]);
    const year = mDy[3] ? Number(mDy[3]) : pubYear;
    if (day >= 1 && day <= 31) return new Date(Date.UTC(year, month, day));
  }

  // "in March" (month only, no day) -> first of month, lower value; only when
  // the month is clearly in the past relative to publication.
  const monthOnly = text.match(/\bin\s+([a-z]+)\b/);
  if (monthOnly && MONTHS[monthOnly[1]] !== undefined && pub) {
    const month = MONTHS[monthOnly[1]];
    let year = pubYear;
    if (month > pub.getUTCMonth()) year = pubYear - 1; // month later in year => last year
    return new Date(Date.UTC(year, month, 1));
  }
  return null;
}

// Resolve a relative date cue against the publication date.
function parseRelativeDate(text: string, pub: Date): Date | null {
  if (/\byesterday\b/.test(text)) return new Date(pub.getTime() - DAY_MS);
  if (/\btoday\b|\bthis morning\b|\bthis afternoon\b|\bthis evening\b/.test(text))
    return new Date(pub.getTime());
  if (/\blast week\b|\ba week ago\b/.test(text)) return new Date(pub.getTime() - 7 * DAY_MS);
  if (/\btwo weeks ago\b|\bfortnight\b/.test(text)) return new Date(pub.getTime() - 14 * DAY_MS);
  if (/\blast month\b|\ba month ago\b/.test(text)) return new Date(pub.getTime() - 30 * DAY_MS);
  if (/\bdays ago\b/.test(text)) {
    const m = text.match(/\b(\d{1,2})\s+days ago\b/);
    if (m) return new Date(pub.getTime() - Number(m[1]) * DAY_MS);
  }

  // "on Monday" / "last Friday" -> the most recent such weekday before pub.
  const wd = text.match(/\b(?:on|last)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd) {
    const target = WEEKDAYS[wd[1]];
    const pubDow = pub.getUTCDay();
    let delta = (pubDow - target + 7) % 7;
    if (delta === 0) delta = 7; // "on Monday" reported on a Monday => a week prior
    return new Date(pub.getTime() - delta * DAY_MS);
  }
  return null;
}

// True when an event is a recycled / out-of-window republication given a
// resolved event date (§6). Used by the engine's confidence gate.
export function isRecycled(
  input: EngineSourceInput,
  eventDate: string | null,
): boolean {
  const text = englishText(input);
  if (RETROSPECTIVE_RE.test(text)) return true;
  const pub = parseIso(input.occurredAt);
  const ev = parseIso(eventDate);
  if (pub && ev) return isOutOfWindow(pub, ev);
  return false;
}
