// Fuel Watch auto-derived narrative blocks.
//
// Regional Highlights and Producer and Buyer Actions are derived from
// the in-window incident set. If there is no signal, the helper returns
// null and the caller must omit the section — the brand spec forbids
// padding empty sections with generic prose.

import { filterTopicReportIncidents, type TopicFastFactsIncident } from "./topicFastFacts";

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function haystack(i: TopicFastFactsIncident): string {
  return [i.title ?? "", i.summary ?? ""].join(" ").toLowerCase();
}

/**
 * Group in-window incidents by country and describe the top 2-3 with
 * the leading operational issue type. Returns null when nothing useful
 * can be said (no country attribution or only one weak record).
 */
export function buildFuelRegionalHighlights(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
}): string | null {
  const window = filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  if (window.length === 0) return null;

  const byCountry = new Map<string, TopicFastFactsIncident[]>();
  for (const i of window) {
    const c = (i.country ?? "").trim();
    if (!c) continue;
    const arr = byCountry.get(c) ?? [];
    arr.push(i);
    byCountry.set(c, arr);
  }
  if (byCountry.size === 0) return null;

  const ranked = Array.from(byCountry.entries()).sort((a, b) => b[1].length - a[1].length);
  const lead = ranked.slice(0, 3);

  const paragraphs: string[] = [];
  for (const [country, items] of lead) {
    // Pick the most distinctive incident for the country — prefer the
    // highest-severity record so the narrative anchors on the worst case.
    const rank: Record<string, number> = { insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5 };
    const sorted = [...items].sort((a, b) => (rank[(b.severity ?? "").toLowerCase()] ?? 0) - (rank[(a.severity ?? "").toLowerCase()] ?? 0));
    const anchor = sorted[0];
    const n = items.length;
    const countLabel = n === 1 ? "1 record" : `${n} records`;
    const sentence = `${titleCase(country)}: ${countLabel} in window. ${anchor.title.trim().replace(/\.$/, "")}.`;
    paragraphs.push(sentence);
  }

  return paragraphs.join("\n\n");
}

const PRODUCER_RE: RegExp[] = [
  /\b(opec\+?|saudi aramco|adnoc|qatarenergy|petrobras|rosneft|gazprom|sinopec|cnpc|cnooc|reliance|indian oil|bharat petroleum|hindustan petroleum|ongc|pertamina|petronas)\b/,
  /\b(refinery|refiner|refining) .{0,30}(announce|cut|raise|expand|restart|shut|maintenance|outage)/,
  /\b(production|output) (cut|hike|increase|reduce|boost|target)/,
  /\b(export|import) (quota|ban|restriction|deal|agreement|cap|tariff)/,
  /\b(supply (contract|deal|agreement|swap)|long[- ]term contract)/,
];
const BUYER_RE: RegExp[] = [
  /\b(airline|carrier) .{0,30}(surcharge|fuel hedge|hedging|capacity (cut|reduction))/,
  /\b(buyer|importer|trading house|trader) .{0,30}(switch|diversif|cancel|defer|stockpile)/,
  /\b(strategic reserve|spr|stockpile|inventory) (release|draw|build|tap)/,
  /\b(fuel hedging|jet fuel hedging|bunker hedging)/,
  /\b(fleet|logistics operator|trucking firm) .{0,30}(fuel|diesel) (cost|pass[- ]through|surcharge)/,
];

/**
 * Producer / buyer-side actions referenced in the window. Returns a
 * short bulleted prose block, or null when nothing matches.
 */
export function buildFuelProducerBuyerActions(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
}): string | null {
  const window = filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  if (window.length === 0) return null;

  const producers: string[] = [];
  const buyers: string[] = [];
  for (const i of window) {
    const t = haystack(i);
    if (PRODUCER_RE.some((re) => re.test(t))) producers.push(i.title.trim().replace(/\.$/, ""));
    if (BUYER_RE.some((re) => re.test(t))) buyers.push(i.title.trim().replace(/\.$/, ""));
  }
  if (producers.length === 0 && buyers.length === 0) return null;

  const out: string[] = [];
  if (producers.length > 0) {
    const shown = producers.slice(0, 4).map((s) => `• Producer: ${s}.`).join("\n");
    out.push(shown);
  }
  if (buyers.length > 0) {
    const shown = buyers.slice(0, 4).map((s) => `• Buyer: ${s}.`).join("\n");
    out.push(shown);
  }
  return out.join("\n\n");
}
