// Protests & Civil Unrest analysis helpers.
//
// The "Protests & Civil Unrest" monitor is fed by the live `flashpoint` data
// topic (activism, protests, industrial action and civil unrest). This module
// is the single source of truth for:
//   1. classifying each record into one of four categories, and
//   2. inferring cautious operational-impact tags from the title/summary text.
//
// Classification is deliberately keyword-based and conservative. There is no
// "Other" bucket — when nothing matches we default to Protest, the broadest of
// the four. Keep these pure and side-effect free so they stay easy to test.

import { format } from "date-fns";

export const PROTEST_CATEGORIES = [
  "Activism",
  "Protest",
  "Industrial Action",
  "Civil Unrest",
] as const;

export type ProtestCategory = (typeof PROTEST_CATEGORIES)[number];

export interface ProtestTextLike {
  title: string;
  summary?: string | null;
}

function text(i: ProtestTextLike): string {
  return `${i.title} ${i.summary ?? ""}`.toLowerCase();
}

// Word-stem patterns. Anchored with \b at the start so "union" does not match
// "communion" etc.; trailing inflections (strikes, rioting, marches) are left
// open so plurals/verb forms are caught.
const CIVIL_UNREST =
  /\b(riot|unrest|clash|violen|arson|loot|curfew|crackdown|ransack|vandal|stampede)/;
const INDUSTRIAL_ACTION =
  /\b(strike|union|walkout|walk-out|labour|labor|wage|worker|industrial dispute|industrial action|picket)/;
// Activism = cause/advocacy-driven action (rights, environment, awareness,
// indigenous land defence, boycotts, vigils). Deliberately does NOT include
// bare "rally" or "march" — those collide with stock-market/sports "rally" and
// the calendar month "March", and a generic demonstration belongs in Protest.
// We only claim Activism when the cause itself is explicit in the text.
const ACTIVISM =
  /\b(activist|activism|advoca(te|cy|tes|ting)|campaign|blockade|boycott|hunger strike|indigenous|environmental|ecolog|climate (protest|activis|march|strike|rally)|human rights|civil rights|minority rights|women'?s rights|animal rights|gender rights|land rights|disability rights|rights group|rights activis|lgbt|pride (month|parade|march)|awareness (rally|campaign|march|drive|walk)|petition|candlelight|vigil|sit-in|sit in|rally for|march for|world \w+ day)/;

// Precedence is intentional: violence (Civil Unrest) is the most operationally
// significant signal, so a labour strike that turns violent reads as Civil
// Unrest. Industrial Action is next (a specific, identifiable event type), then
// Activism, then Protest as the catch-all default.
export function classifyProtestCategory(i: ProtestTextLike): ProtestCategory {
  const t = text(i);
  if (CIVIL_UNREST.test(t)) return "Civil Unrest";
  // Cause-driven "strikes" (hunger/climate/rent) are activism, not labour
  // action, so catch them before the Industrial Action /strike/ test below.
  if (/\b(hunger strike|climate strike|rent strike)/.test(t)) return "Activism";
  if (INDUSTRIAL_ACTION.test(t)) return "Industrial Action";
  if (ACTIVISM.test(t)) return "Activism";
  return "Protest";
}

// Category colours — drawn ONLY from the existing Polestar palette plus the
// existing high-severity red for the violence category. No new palette.
export const CATEGORY_COLOR: Record<ProtestCategory, string> = {
  Activism: "#363636", // Dusk Gray
  Protest: "#465bff", // Electric Blue
  "Industrial Action": "#0b0a3d", // Midnight Blue
  "Civil Unrest": "#C0392B", // existing High-severity red
};

// Plural display labels for the category metric cards (the incident table keeps
// the singular canonical names above).
export const CATEGORY_CARD_LABEL: Record<ProtestCategory, string> = {
  Activism: "Activism",
  Protest: "Protests",
  "Industrial Action": "Industrial Action",
  "Civil Unrest": "Civil Unrest",
};

// ---------------------------------------------------------------------------
// Operational impact inference (cautious — keyword only, no confidence claims)
// ---------------------------------------------------------------------------

export interface OperationalImpactRule {
  label: string;
  description: string;
  re: RegExp;
}

export const OPERATIONAL_IMPACTS: OperationalImpactRule[] = [
  {
    label: "Transport disruption",
    description: "Roads, rail, transit, airports or traffic affected.",
    re: /\b(road|rail|railway|train|metro|subway|highway|motorway|airport|flight|transport|traffic|transit|\bbus\b|roadblock)/,
  },
  {
    label: "Site access disruption",
    description: "Entrances, premises or sites blocked or occupied.",
    re: /\b(access|entrance|gate|premises|sit-in|sit in|occupy|occupation|occupied|barricad|encampment|blockade)/,
  },
  {
    label: "Industrial site disruption",
    description: "Factories, plants, refineries or mines affected.",
    re: /\b(factory|factories|plant|refinery|refineries|\bmine|mining|industrial|smelter|assembly line|shipyard)/,
  },
  {
    label: "Government facility targeting",
    description: "Government buildings, ministries or police facilities targeted.",
    re: /\b(government|parliament|ministry|ministries|embassy|consulate|city hall|town hall|police station|courthouse|capitol|governor|legislat)/,
  },
  {
    label: "Energy or utility disruption",
    description: "Power, water, gas or fuel infrastructure affected.",
    re: /\b(power plant|powerplant|electricity|\bgrid\b|blackout|water supply|utility|utilities|\bgas\b|fuel depot|pipeline|substation)/,
  },
  {
    label: "Supply chain disruption",
    description: "Ports, logistics, cargo or freight movement affected.",
    re: /\b(supply chain|logistics|\bport\b|cargo|freight|distribution|shipment|warehouse|container)/,
  },
];

/** Returns the operational-impact labels whose keywords appear in the text. */
export function detectOperationalImpacts(i: ProtestTextLike): string[] {
  const t = text(i);
  return OPERATIONAL_IMPACTS.filter((r) => r.re.test(t)).map((r) => r.label);
}

// ---------------------------------------------------------------------------
// Monthly archive grouping
// ---------------------------------------------------------------------------
// The incident table on the monitor grows unbounded as history accumulates, so
// it is chunked by calendar month: the most recent month renders in full while
// every earlier month collapses into an archive box the analyst can expand.

export interface MonthGroup<T> {
  /** Sort/identity key, e.g. "2026-07". */
  key: string;
  /** Human label, e.g. "July 2026". */
  label: string;
  rows: T[];
}

/**
 * Group already-date-sorted records into calendar-month buckets, newest month
 * first. Records must carry a valid `occurredDate`; callers filter out unpar- 
 * seable dates upstream (the monitor's in-window set already does). Preserves
 * the incoming order of rows within each month.
 */
export function groupByMonth<T extends { occurredDate: Date }>(
  rows: T[],
): MonthGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    if (Number.isNaN(r.occurredDate.getTime())) continue;
    const key = format(r.occurredDate, "yyyy-MM");
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
    else buckets.set(key, [r]);
  }
  return Array.from(buckets.entries())
    .map(([key, groupRows]) => ({
      key,
      label: format(groupRows[0].occurredDate, "MMMM yyyy"),
      rows: groupRows,
    }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}
