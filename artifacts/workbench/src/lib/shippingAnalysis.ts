// Shared shipping derivations used by the Shipping page and the
// Shipping report PDF exporter. Single source of truth so the dashboard
// and the report never disagree.

export type ChokepointKey =
  | "Strait of Hormuz"
  | "Gulf of Oman"
  | "Arabian / Persian Gulf"
  | "Red Sea"
  | "Bab el-Mandeb"
  | "Malacca Strait";

export const CHOKEPOINTS: ChokepointKey[] = [
  "Strait of Hormuz",
  "Gulf of Oman",
  "Arabian / Persian Gulf",
  "Red Sea",
  "Bab el-Mandeb",
  "Malacca Strait",
];

const CHOKEPOINT_RULES: Array<{ key: ChokepointKey; pattern: RegExp }> = [
  // Match the strait labels first so a generic "hormuz" reference is captured
  // even when the surrounding text also mentions the wider gulf.
  { key: "Strait of Hormuz", pattern: /\b(strait of hormuz|hormuz strait|hormuz)\b/i },
  { key: "Gulf of Oman", pattern: /\bgulf of oman\b/i },
  { key: "Bab el-Mandeb", pattern: /\bbab[- ]?(el|al)[- ]?mande[bn]\b/i },
  { key: "Red Sea", pattern: /\bred sea\b/i },
  { key: "Malacca Strait", pattern: /\b(strait of malacca|malacca strait|malacca)\b/i },
  { key: "Arabian / Persian Gulf", pattern: /\b(arabian gulf|persian gulf)\b/i },
];

export interface MaritimeRecordLike {
  title: string;
  summary?: string | null;
  location?: string | null;
}

function blob(i: MaritimeRecordLike): string {
  return `${i.title ?? ""} ${i.summary ?? ""} ${i.location ?? ""}`;
}

/**
 * Return every chokepoint mentioned by the record. A single attack in the
 * Strait of Hormuz can legitimately surface under both Hormuz and the wider
 * Persian/Arabian Gulf row, so we do not stop at the first hit.
 */
export function detectChokepoints(i: MaritimeRecordLike): ChokepointKey[] {
  const text = blob(i);
  const hits: ChokepointKey[] = [];
  for (const r of CHOKEPOINT_RULES) {
    if (r.pattern.test(text)) hits.push(r.key);
  }
  return hits;
}

/**
 * Convenience — first chokepoint match, used when picking a single label.
 */
export function detectChokepoint(i: MaritimeRecordLike): ChokepointKey | null {
  return detectChokepoints(i)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Piracy and Armed Robbery
//
// Captures piracy, armed robbery at sea, boarding, attempted boarding,
// suspicious approach, small craft approach, hijacking, crew threat and
// theft from a vessel at anchorage. Land cargo theft is excluded — that
// remains under Cargo Watch.
// ---------------------------------------------------------------------------

export type PiracyAct =
  | "Hijacking"
  | "Armed robbery"
  | "Piracy"
  | "Boarding"
  | "Attempted boarding"
  | "Suspicious approach"
  | "Small craft approach"
  | "Crew threat"
  | "Theft from vessel at anchorage";

// Hard exclusion — clear land/warehouse cargo theft must not be labelled
// piracy. Cargo Watch remains the home for those records.
const LAND_CARGO_RE =
  /\b(warehouse|depot|truck|lorry|convoy|highway|road|yard|parking|shipping container yard|distribution centre|distribution center)\b/i;

const PIRACY_RULES: Array<{ type: PiracyAct; pattern: RegExp }> = [
  { type: "Hijacking", pattern: /\b(hijack(ed|ing)?)\b/i },
  { type: "Attempted boarding", pattern: /\battempted boarding\b/i },
  { type: "Armed robbery", pattern: /\b(armed robbery (against|at sea|on board|in port|at anchorage)?|robbery (against|at sea) (a |the )?(ship|vessel|tanker)|robbery on board)\b/i },
  { type: "Piracy", pattern: /\b(piracy|pirat(e|es))\b/i },
  { type: "Boarding", pattern: /\b(boarded by (pirates|robbers|armed (men|gang|gunmen))|pirates? boarded|robbers? boarded|armed (men|gang|gunmen) boarded)\b/i },
  { type: "Suspicious approach", pattern: /\bsuspicious approach\b/i },
  { type: "Small craft approach", pattern: /\b(small craft approach|approached by (a )?skiffs?|skiff (sighted|approach))\b/i },
  { type: "Crew threat", pattern: /\b(crew (kidnap|abduct|threat|held hostage|taken hostage|injured by (pirates|robbers))|hostage taking at sea)\b/i },
  { type: "Theft from vessel at anchorage", pattern: /\b(theft from vessel|petty theft .{0,15}(anchorage|vessel|ship)|theft .{0,15}anchorage|stores theft .{0,15}(vessel|ship))\b/i },
];

/**
 * Classify a record as a piracy/armed-robbery type, or return null if it is
 * not a piracy event. Land cargo theft is always rejected.
 */
export function classifyPiracy(i: MaritimeRecordLike): PiracyAct | null {
  const text = blob(i);
  if (LAND_CARGO_RE.test(text) && !/\b(at sea|at anchorage|on board|vessel|ship|tanker|dhow|crew)\b/i.test(text)) {
    return null;
  }
  for (const r of PIRACY_RULES) {
    if (r.pattern.test(text)) return r.type;
  }
  return null;
}

export const PIRACY_ACTS: PiracyAct[] = [
  "Hijacking",
  "Armed robbery",
  "Piracy",
  "Boarding",
  "Attempted boarding",
  "Suspicious approach",
  "Small craft approach",
  "Crew threat",
  "Theft from vessel at anchorage",
];
