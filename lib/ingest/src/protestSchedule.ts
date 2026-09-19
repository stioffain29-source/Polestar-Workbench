import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db, protestEventsTable, type InsertProtestEvent, type ProtestEvent } from "@workspace/db";
import { fetchFeed } from "./feedFetch";

export type ProtestStatus = "Confirmed" | "Planned" | "Possible" | "Cancelled" | "Postponed";
export type ProtestConfidence = "High" | "Moderate" | "Low";

type SearchFeed = { country: string; cities: string[]; locale: string; gl: string };

// Country and city terms are deliberately explicit: broad country-only Google
// queries tend to return historical commentary rather than event notices.
export const SEARCH_FEEDS: SearchFeed[] = [
  { country: "Australia", cities: ["Sydney", "Melbourne", "Brisbane", "Canberra", "Perth", "Adelaide"], locale: "en-AU", gl: "AU" },
  { country: "Cambodia", cities: ["Phnom Penh", "Siem Reap", "Sihanoukville"], locale: "en", gl: "KH" },
  { country: "China", cities: ["Beijing", "Shanghai", "Guangzhou", "Shenzhen", "Wuhan", "Chengdu"], locale: "en-US", gl: "US" },
  { country: "Laos", cities: ["Vientiane", "Luang Prabang", "Savannakhet", "Pakse"], locale: "en", gl: "LA" },
  { country: "Bangladesh", cities: ["Dhaka", "Chattogram", "Rajshahi"], locale: "en-BD", gl: "BD" },
  { country: "India", cities: ["Delhi", "Mumbai", "Bengaluru", "Kolkata", "Chennai", "Hyderabad"], locale: "en-IN", gl: "IN" },
  { country: "Indonesia", cities: ["Jakarta", "Surabaya", "Bandung", "Medan", "Makassar", "Jayapura"], locale: "en-ID", gl: "ID" },
  { country: "Japan", cities: ["Tokyo", "Osaka", "Kyoto", "Nagoya", "Hiroshima"], locale: "en-JP", gl: "JP" },
  { country: "Malaysia", cities: ["Kuala Lumpur", "Johor Bahru", "Penang", "Kota Kinabalu"], locale: "en-MY", gl: "MY" },
  { country: "Myanmar", cities: ["Yangon", "Mandalay", "Naypyidaw"], locale: "en-US", gl: "US" },
  { country: "Nepal", cities: ["Kathmandu", "Pokhara", "Biratnagar"], locale: "en-NP", gl: "NP" },
  { country: "New Zealand", cities: ["Auckland", "Wellington", "Christchurch", "Dunedin"], locale: "en-NZ", gl: "NZ" },
  { country: "Pakistan", cities: ["Islamabad", "Karachi", "Lahore", "Peshawar"], locale: "en-PK", gl: "PK" },
  { country: "Papua New Guinea", cities: ["Port Moresby", "Lae", "Mount Hagen", "Madang"], locale: "en-PG", gl: "PG" },
  { country: "Philippines", cities: ["Manila", "Quezon City", "Cebu", "Davao"], locale: "en-PH", gl: "PH" },
  { country: "Singapore", cities: ["Singapore"], locale: "en-SG", gl: "SG" },
  { country: "South Korea", cities: ["Seoul", "Busan", "Incheon", "Daegu"], locale: "en-US", gl: "US" },
  { country: "Sri Lanka", cities: ["Colombo", "Kandy", "Galle"], locale: "en-LK", gl: "LK" },
  { country: "Taiwan", cities: ["Taipei", "Kaohsiung", "Taichung"], locale: "en-TW", gl: "TW" },
  { country: "Thailand", cities: ["Bangkok", "Chiang Mai", "Phuket", "Hat Yai"], locale: "en-TH", gl: "TH" },
  { country: "Vietnam", cities: ["Hanoi", "Ho Chi Minh City", "Da Nang"], locale: "en-VN", gl: "VN" },
  { country: "Bahrain", cities: ["Manama"], locale: "en", gl: "BH" },
  { country: "Egypt", cities: ["Cairo", "Alexandria", "Suez"], locale: "en", gl: "EG" },
  { country: "Iran", cities: ["Tehran", "Mashhad", "Isfahan", "Tabriz"], locale: "en-US", gl: "US" },
  { country: "Iraq", cities: ["Baghdad", "Basra", "Erbil"], locale: "en-US", gl: "US" },
  { country: "Israel", cities: ["Jerusalem", "Tel Aviv", "Haifa"], locale: "en", gl: "IL" },
  { country: "Jordan", cities: ["Amman", "Aqaba"], locale: "en", gl: "JO" },
  { country: "Kuwait", cities: ["Kuwait City"], locale: "en", gl: "KW" },
  { country: "Lebanon", cities: ["Beirut", "Tripoli", "Sidon"], locale: "en", gl: "LB" },
  { country: "Oman", cities: ["Muscat", "Salalah", "Sohar"], locale: "en", gl: "OM" },
  { country: "Palestine", cities: ["Ramallah", "Gaza City", "Nablus"], locale: "en-US", gl: "US" },
  { country: "Qatar", cities: ["Doha"], locale: "en", gl: "QA" },
  { country: "Saudi Arabia", cities: ["Riyadh", "Jeddah", "Dammam"], locale: "en", gl: "SA" },
  { country: "Syria", cities: ["Damascus", "Aleppo", "Latakia"], locale: "en-US", gl: "US" },
  { country: "Turkey", cities: ["Istanbul", "Ankara", "Izmir"], locale: "en", gl: "TR" },
  { country: "United Arab Emirates", cities: ["Abu Dhabi", "Dubai", "Sharjah"], locale: "en", gl: "AE" },
  { country: "Yemen", cities: ["Sanaa", "Aden", "Hodeidah"], locale: "en-US", gl: "US" },
];

const PROTEST_TERMS = [
  "protest", "rally", "demonstration", "march", "picket", "strike",
  "blockade", "sit-in", "walkout", "mobilisation", "mobilization",
  "dharna", "dharnas", "mass mobilisation", "mass mobilization",
  "public gathering", "protest action", "day of action", "nationwide protest",
  "statewide protest",
  "aksi", "unjuk rasa", "demonstrasi", "pawai", "mogok", "bantahan",
  "tunjuk perasaan", "himpunan", "hikoi", "抗議", "デモ", "示威",
  "시위", "집회", "प्रदर्शन", "বিক্ষোভ", "biểu tình", "ประท้วง", "ชุมนุม",
];
const PLANNING_TERMS = [
  "planned", "plan to", "plans to", "will protest", "workers will protest",
  "workers will gather", "students will protest", "farmers will protest",
  "farmers announce", "student walkout", "union calls", "union announces",
  "will hold", "scheduled", "set to", "due to hold",
  "calls for", "calling for", "organiser", "organizer", "announced",
  "tomorrow", "next week", "upcoming", "rencana", "akan", "berencana",
  "direncanakan", "dijadwalkan", "disahkan", "akan menggelar", "diperkirakan",
  "akan berlangsung", "予定", "計画", "予定され", "예정", "계획", "예고",
  "กำหนด", "จะจัด", "dự kiến", "sẽ tổ chức", "প্রস্তুতি",
];
const CANCELLED_RE = /\b(cancel(?:led|ed)?|called off|scrapped|dibatalkan|batal)\b/i;
const POSTPONED_RE = /\b(postpon(?:ed|e)|rescheduled|ditunda|ditangguhkan)\b/i;
const CONFIRMED_RE = /\b(confirmed|scheduled|officially announced|will hold|set to hold)\b/i;
const PROTEST_HOMONYM_RE =
  /\b(rally championship|rally new zealand|strike capacity|carrier strike group|air strike|missile strike|drone strike|winning receipt|march[-– ]april|inflation (?:dips|rose|falls?) in march|scheduled for march 20\d{2}|mobilisation of capital)\b/i;
const STRONG_UNDATED_PLANNING_RE =
  /\b(?:plans? to|planned|scheduled|will)\s+(?:protest|demonstrate|rally|march|strike|walk out|gather|hold a (?:protest|demonstration|rally|march|strike))\b|\b(?:protest|demonstration|rally|march|strike|walkout)\s+(?:planned|scheduled)\b|\bunion (?:calls|announces)\b|\b(?:tomorrow|next week|upcoming)\b/i;
const DATE_MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8,
  sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11,
  dec: 11, januari: 0, februari: 1, maret: 2, mei: 4, juni: 5,
  juli: 6, agustus: 7, oktober: 9, desember: 11,
};

function clean(value: string | undefined | null): string | null {
  const text = value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 4000) : null;
}

function parseDate(text: string, now: Date): Date | null {
  const dmy = text.match(/\b(\d{1,2})\s+([A-Za-z]+)(?:\s*,?\s*(20\d{2}))?\b/i);
  const mdy = text.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:\s*,?\s*(20\d{2}))?\b/i);
  const day = dmy ? Number(dmy[1]) : mdy ? Number(mdy[2]) : null;
  const monthName = (dmy ? dmy[2] : mdy?.[1])?.toLowerCase();
  const month = monthName ? DATE_MONTHS[monthName] : undefined;
  const yearToken = dmy?.[3] ?? mdy?.[3];
  if (month !== undefined && day !== null) {
    const year = yearToken ? Number(yearToken) : now.getUTCFullYear();
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCMonth() === month && date.getUTCDate() === day) return date;
  }
  const numeric = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/)
    ?? text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if (numeric) {
    const [a, b, c] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
    const date = numeric[1].length === 4 ? new Date(Date.UTC(a, b - 1, c)) : new Date(Date.UTC(c, b - 1, a));
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

export function eventDateInWindow(eventDate: Date | null, now = new Date()): boolean {
  if (!eventDate) return false;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = start + 8 * 24 * 60 * 60 * 1000;
  return eventDate.getTime() >= start && eventDate.getTime() < end;
}

function findCity(text: string, cities: string[]): string | null {
  return cities.find((city) => new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) ?? null;
}

function parseTime(text: string): string | null {
  const match = text.match(/\b([01]?\d|2[0-3])(?:[:.][0-5]\d)?\s*(?:am|pm|hrs?|時|시)?\b/i);
  return match?.[0] ?? null;
}

function parseExplicitAttendance(text: string): number | null {
  const match = text.match(/\b(\d[\d,.\s]*)\s+(?:people|participants|attendees|protesters|demonstrators|คน|명|orang)\b/i);
  if (!match) return null;
  const n = Number(match[1].replace(/[^\d]/g, ""));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function makeProtestDedupeKey(input: Pick<InsertProtestEvent, "eventDate" | "country" | "city" | "eventType">): string {
  const date = input.eventDate instanceof Date ? input.eventDate.toISOString().slice(0, 10) : "";
  const basis = [date, input.country, input.city, input.eventType]
    .map((v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, " ").trim())
    .join("|");
  return createHash("sha256").update(basis).digest("hex");
}

export function parseProtestItem(
  item: Parser.Item,
  feed: SearchFeed,
  now = new Date(),
): InsertProtestEvent | null {
  const title = clean(item.title) ?? "";
  const description = clean(item.contentSnippet ?? item.content ?? item.summary) ?? "";
  const text = `${title} ${description}`;
  if (PROTEST_HOMONYM_RE.test(text)) return null;
  if (!PROTEST_TERMS.some((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) return null;
  const eventDate = parseDate(text, now);
  const planning = PLANNING_TERMS.some((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  if (!eventDate && !planning) return null;
  const sourcePublishedAt = item.pubDate ? new Date(item.pubDate) : null;
  const sourceDate = sourcePublishedAt && !Number.isNaN(sourcePublishedAt.getTime()) ? sourcePublishedAt : null;
  if (!eventDate) {
    const sourceAgeMs = sourceDate ? now.getTime() - sourceDate.getTime() : Number.POSITIVE_INFINITY;
    if (
      sourceAgeMs < 0 ||
      sourceAgeMs > 30 * 24 * 60 * 60 * 1000 ||
      !STRONG_UNDATED_PLANNING_RE.test(text)
    ) {
      return null;
    }
  }
  const status: ProtestStatus = CANCELLED_RE.test(text)
    ? "Cancelled"
    : POSTPONED_RE.test(text)
      ? "Postponed"
      : !eventDate
        ? "Possible"
        : CONFIRMED_RE.test(text)
          ? "Confirmed"
          : "Planned";
  const city = findCity(text, feed.cities);
  const venueMatch = text.match(/\b(?:at|outside|near|in front of)\s+([^.;,]{3,90})/i);
  const organiserMatch = text.match(/\b(?:organ(?:is|iz)(?:ed|er|ation)|by|from)\s*:?\s+([^.;,]{3,100})/i);
  const issueMatch = text.match(/\b(?:over|about|against|for|demanding)\s+([^.;]{3,180})/i);
  const sourceUrl = item.link ?? item.guid;
  if (!sourceUrl) return null;
  const eventType = /\bstrike|mogok|walkout/i.test(text)
    ? "strike"
    : /\bmarch|pawai|hikoi/i.test(text)
      ? "march"
      : /\brally|himpunan/i.test(text)
        ? "rally"
        : /\bdemonstration|demonstrasi|unjuk rasa/i.test(text)
          ? "demonstration"
          : /\bsit[- ]in/i.test(text)
            ? "sit-in"
            : "protest";
  const row: InsertProtestEvent = {
    sourceName: "google_news_protest_schedule",
    sourceUrl,
    sourceTitle: title || sourceUrl,
    sourcePublishedAt: sourceDate,
    eventDate,
    country: feed.country,
    city,
    venue: clean(venueMatch?.[1]),
    eventType,
    issue: clean(issueMatch?.[1]),
    organiser: clean(organiserMatch?.[1]),
    description: description || null,
    startTime: parseTime(text),
    attendance: parseExplicitAttendance(text),
    disruptionPotential: /\b(blockade|roadblock|traffic|shutdown|closure|jalan ditutup|blokade)\b/i.test(text)
      ? "High"
      : /\b(march|rally|strike|mogok|walkout)\b/i.test(text)
        ? "Moderate"
        : "Low",
    confidence: eventDate && city && venueMatch?.[1] && organiserMatch?.[1]
      ? sourceUrl.includes("google.com") ? "Moderate" : "High"
      : eventDate
        ? "Moderate"
        : "Low",
    status,
    collectedAt: now,
    searchCompletedAt: now,
    dedupKey: makeProtestDedupeKey({
      eventDate,
      country: feed.country,
      city,
      eventType,
    }),
  };
  return row;
}

function feedUrl(feed: SearchFeed): string {
  const locations = [feed.country, ...feed.cities].map((v) => `"${v}"`).join(" OR ");
  const terms = PROTEST_TERMS.slice(0, 18).join(" OR ");
  // Do not put a hard age filter on the discovery query. A valid notice can be
  // published more than 30 days before an event; recency is only a preference
  // in conservative deduplication, never an exclusion rule.
  const q = `(${locations}) (${terms}) (planned OR scheduled OR upcoming OR "will hold" OR rencana OR akan OR 予定 OR 예정 OR กำหนด)`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${feed.locale}&gl=${feed.gl}&ceid=${feed.gl}:en`;
}

export type ProtestScheduleSummary = {
  mode: "commit" | "dry-run";
  sourcesFetched: number;
  itemsConsidered: number;
  accepted: number;
  inserted: number;
  updated: number;
  rejected: number;
  errors: string[];
  countriesCovered: string[];
  logLines: string[];
};

export function emptyProtestScheduleSummary(mode: "commit" | "dry-run" = "commit"): ProtestScheduleSummary {
  return { mode, sourcesFetched: 0, itemsConsidered: 0, accepted: 0, inserted: 0, updated: 0, rejected: 0, errors: [], countriesCovered: [], logLines: [] };
}

export async function runProtestScheduleIngest(opts: { commit?: boolean; now?: Date } = {}): Promise<ProtestScheduleSummary> {
  const commit = opts.commit ?? false;
  const now = opts.now ?? new Date();
  const summary = emptyProtestScheduleSummary(commit ? "commit" : "dry-run");
  const parser = new Parser();
  const countries = new Set<string>();
  const candidates = new Map<string, InsertProtestEvent>();
  for (const feed of SEARCH_FEEDS) {
    try {
      const parsed = await fetchFeed(parser, feedUrl(feed), { stagger: true });
      summary.sourcesFetched++;
      countries.add(feed.country);
      for (const item of parsed.items) {
        summary.itemsConsidered++;
        const candidate = parseProtestItem(item, feed, now);
        if (!candidate) {
          summary.rejected++;
          continue;
        }
        // The collector is a forward-looking schedule, not an archive. Keep
        // undated Possible notices for analyst review, but only admit dated
        // events in today's seven-day event-date window.
        if (candidate.eventDate && !eventDateInWindow(candidate.eventDate, now)) {
          summary.rejected++;
          continue;
        }
        summary.accepted++;
        // Collapse syndicated wording before any write. A higher-confidence,
        // more recently published source wins for the same event identity.
        const candidateScore = (candidate.confidence === "High" ? 2 : candidate.confidence === "Moderate" ? 1 : 0) * 1_000_000_000_000 + (candidate.sourcePublishedAt?.getTime() ?? 0);
        const existing = candidates.get(candidate.dedupKey);
        const existingScore = existing
          ? (existing.confidence === "High" ? 2 : existing.confidence === "Moderate" ? 1 : 0) * 1_000_000_000_000 + (existing.sourcePublishedAt?.getTime() ?? 0)
          : -1;
        if (!existing || candidateScore > existingScore) {
          candidates.set(candidate.dedupKey, candidate);
        }
      }
    } catch (err) {
      summary.errors.push(`${feed.country}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Replace only the machine-generated schedule, and only after every feed
  // completed. Analyst-created rows use a different sourceName and survive.
  // A partial provider failure preserves the previous complete schedule.
  if (commit && summary.sourcesFetched > 0 && summary.errors.length === 0) {
    await db
      .delete(protestEventsTable)
      .where(eq(protestEventsTable.sourceName, "google_news_protest_schedule"));
    for (const candidate of candidates.values()) {
      const inserted = await db
        .insert(protestEventsTable)
        .values(candidate)
        .onConflictDoNothing()
        .returning({ id: protestEventsTable.id });
      if (inserted.length > 0) summary.inserted++;
    }
  }
  summary.countriesCovered = [...countries];
  summary.logLines.push(`protest schedule: ${summary.sourcesFetched} feeds, ${summary.accepted} candidates, ${summary.inserted} inserted`);
  return summary;
}

export async function listForwardProtestEvents(now = new Date(), limit = 200): Promise<{ confirmedPlanned: ProtestEvent[]; possible: ProtestEvent[] }> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 8 * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(protestEventsTable)
    .where(and(gte(protestEventsTable.eventDate, start), lt(protestEventsTable.eventDate, end)))
    .orderBy(protestEventsTable.eventDate, desc(protestEventsTable.confidence))
    .limit(limit);
  return {
    confirmedPlanned: rows.filter((r) => r.status === "Confirmed" || r.status === "Planned"),
    possible: rows.filter((r) => r.status === "Possible"),
  };
}