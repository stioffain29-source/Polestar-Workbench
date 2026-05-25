// Fuel Watch auto-derived narrative blocks.
//
// Regional Highlights and Producer and Buyer Actions are derived from
// the in-window incident set. Outputs read like analyst prose — never
// raw headline dumps and never weak "Unknown" rows. The helpers return
// null when there is no usable signal so the caller can omit the
// section instead of padding it.

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
 * Normalise a raw country field for use as a regional-highlight key.
 * Some upstream records carry combined values like "United Arab
 * Emirates; Iran" or "Saudi Arabia / Yemen"; we split on `;` / `/` /
 * `,` / `&` and pick the first usable country so the highlight row
 * is anchored on one place. Returns null when nothing usable remains.
 */
function normaliseCountry(c: string | null | undefined): string | null {
  if (!c) return null;
  const parts = c.split(/\s*[;/,&]\s*|\s+\bvs?\.?\b\s+/i);
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lc = trimmed.toLowerCase();
    if (lc === "unknown" || lc === "n/a" || lc === "global" || lc === "international") continue;
    return trimmed;
  }
  return null;
}

// Operational issue families, in priority order. The first family that
// matches the country's most-severe incident becomes the headline phrase
// for the country paragraph.
interface IssueFamily {
  test: RegExp[];
  phrase: string;
}
const ISSUE_FAMILIES: IssueFamily[] = [
  {
    test: [/\b(strait of hormuz|hormuz)\b/, /\bbab[- ]el[- ]mandeb\b/, /\bred sea\b/, /\bmalacca\b/, /\bsuez\b/],
    phrase: "chokepoint pressure and tanker-route disruption",
  },
  {
    test: [/\b(refinery|refineries) (outage|disruption|fire|attack|halt|maintenance|shutdown|closure)/],
    phrase: "refinery disruption and supply-side outage",
  },
  {
    test: [/\b(fuel|petrol|diesel|lpg|kerosene|jet fuel) (shortage|stockout|rationing|queue|queues)/, /\bforecourt (closure|shut|queue|disruption)/],
    phrase: "shortages, rationing and forecourt disruption",
  },
  {
    test: [/\btanker (driver|drivers|strike|shortage|attack|blockade|convoy)/, /\b(fuel|tanker) (convoy|hijack|seizure)/],
    phrase: "tanker and fuel-transport disruption",
  },
  {
    test: [
      /\b(subsidy|subsidies|levy|levies|duty|excise|tax) .{0,30}(fuel|petrol|diesel|gas|lpg|kerosene)/,
      /\b(price control|price cap|price freeze|export ban|import ban)/,
    ],
    phrase: "policy and subsidy / levy moves",
  },
  {
    test: [/\b(pump price|petrol price|diesel price|fuel price) (hike|rise|increase|cut|drop|fall|change)/, /\bfuel surcharge\b/],
    phrase: "pump and surcharge pricing pressure",
  },
  {
    test: [/\b(oil|crude) (export ban|export halt|embargo|sanctions|sabotage|attack|spill)/],
    phrase: "crude supply-chain and sanctions pressure",
  },
];

function issuePhrase(items: TopicFastFactsIncident[]): string {
  // Find the first family that any item in the country's set hits.
  for (const fam of ISSUE_FAMILIES) {
    for (const i of items) {
      const t = haystack(i);
      if (fam.test.some((re) => re.test(t))) return fam.phrase;
    }
  }
  return "fuel-operational reporting";
}

/**
 * Country-level Fuel Watch highlights as analyst prose. Drops records
 * without a usable country attribution and never emits "Unknown" as a
 * row. Returns null when there is nothing usable to say.
 */
export function buildFuelRegionalHighlights(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
}): string | null {
  const window = filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  if (window.length === 0) return null;

  const byCountry = new Map<string, TopicFastFactsIncident[]>();
  for (const i of window) {
    const key = normaliseCountry(i.country);
    if (!key) continue;
    const arr = byCountry.get(key) ?? [];
    arr.push(i);
    byCountry.set(key, arr);
  }
  if (byCountry.size === 0) return null;

  const ranked = Array.from(byCountry.entries()).sort((a, b) => b[1].length - a[1].length);
  const lead = ranked.slice(0, 3);

  const paragraphs: string[] = [];
  const leadCountry = lead[0]?.[0];
  for (let idx = 0; idx < lead.length; idx++) {
    const [country, items] = lead[idx];
    const phrase = issuePhrase(items);
    const n = items.length;
    let opener: string;
    if (idx === 0 && country === leadCountry) {
      opener = `${titleCase(country)} remains the main pressure point in this window`;
    } else if (idx === 1) {
      opener = `${titleCase(country)} also carries fuel signal`;
    } else {
      opener = `${titleCase(country)} adds further weight`;
    }
    const recordsClause = n === 1 ? "a single record" : `${n} records`;
    paragraphs.push(`${opener}, with ${recordsClause} tied to ${phrase}.`);
  }
  return paragraphs.join("\n\n");
}

// Producer/buyer/government/infrastructure/market classification rules.
// Order matters: a record is assigned to the first matching category.
type Category =
  | "Producer action"
  | "Buyer action"
  | "Government / policy action"
  | "Infrastructure / routing action"
  | "Market / supply signal";

interface CategoryRule {
  category: Category;
  test: RegExp[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "Government / policy action",
    test: [
      /\b(government|ministry|parliament|cabinet|regulator|state[- ]owned|caucus)\b/,
      /\b(subsidy|subsidies|levy|levies|duty|excise|tax) .{0,30}(fuel|petrol|diesel|gas|lpg|kerosene)/,
      /\b(fuel|petrol|diesel) .{0,20}(subsidy|levy|duty|excise|tax) (cut|hike|raise|removal|removed|reform|reintroduce)/,
      /\b(price control|price cap|price freeze|export ban|import ban|export quota|import quota)/,
    ],
  },
  {
    category: "Infrastructure / routing action",
    test: [
      /\b(pipeline|terminal|jetty|loading|berth) .{0,30}(bypass|reroute|open|close|shut|expand|sabotage|attack)/,
      /\b(bypass(?:ing)? hormuz|red sea bypass|alternative route|reroute|rerouting)/,
      /\b(adnoc|ila|aramco) .{0,30}(pipeline|bypass)/,
      /\b(storage|stockpile|reserve) (build|release|expand|tap)/,
    ],
  },
  {
    category: "Buyer action",
    test: [
      /\b(airline|carrier) .{0,30}(surcharge|fuel hedge|hedging|capacity (cut|reduction))/,
      /\b(indian oil|bharat petroleum|hindustan petroleum|sinopec|cnpc) .{0,30}(spot purchase|tender|cargo|import|buy)/,
      /\b(buyer|importer|trading house|trader|refiner) .{0,30}(switch|diversif|cancel|defer|stockpile|spot purchase|tender)/,
      /\b(strategic reserve|spr) (release|draw|tap)/,
      /\b(fuel hedging|jet fuel hedging|bunker hedging)/,
    ],
  },
  {
    category: "Producer action",
    test: [
      /\b(opec\+?|saudi aramco|adnoc|qatarenergy|petrobras|rosneft|gazprom|cnooc|pertamina|petronas|reliance|ongc)\b/,
      /\b(production|output) (cut|hike|increase|reduce|boost|target|guidance)/,
      /\b(refinery|refiner|refining) .{0,30}(announce|cut|raise|expand|restart|shut|maintenance|outage)/,
      /\b(supply (contract|deal|agreement|swap)|long[- ]term contract)/,
    ],
  },
  {
    category: "Market / supply signal",
    test: [
      /\b(brent|wti|crude|oil) (price|prices) (rise|fall|climb|drop|surge|slide|jump|plunge|hit|reach|break)/,
      /\b(jet fuel|diesel|petrol|gasoline|kerosene) (price|prices) (rise|fall|climb|drop|surge|slide|hit|break)/,
      /\b(supply (tighten|tightens|squeeze)|demand (jump|rise|fall|drop)|inventory (build|draw))/,
      /\b(refinery margin|crack spread)/,
    ],
  },
];

function classifyCategory(t: string): Category | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.test.some((re) => re.test(t))) return rule.category;
  }
  return null;
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

function pickActor(i: TopicFastFactsIncident, category: Category): string {
  const t = haystack(i);
  const ACTORS = [
    "OPEC+", "OPEC", "Saudi Aramco", "ADNOC", "QatarEnergy", "Petrobras",
    "Rosneft", "Gazprom", "Sinopec", "CNPC", "CNOOC", "Reliance",
    "Indian Oil", "Bharat Petroleum", "Hindustan Petroleum", "ONGC",
    "Pertamina", "Petronas",
  ];
  for (const a of ACTORS) {
    if (t.includes(a.toLowerCase())) return a;
  }
  if (category === "Government / policy action") return "Government / policy";
  if (category === "Infrastructure / routing action") return "Infrastructure operator";
  if (category === "Market / supply signal") return "Market";
  return "—";
}

interface ClassifiedAction {
  actor: string;
  category: Category;
  action: string;
  date: string;
}

/**
 * Classified producer / buyer / government / infrastructure / market
 * actions referenced in the window. Returns a clean table-style block
 * or null when nothing matches.
 */
export function buildFuelProducerBuyerActions(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
}): string | null {
  const window = filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  if (window.length === 0) return null;

  const rows: ClassifiedAction[] = [];
  for (const i of window) {
    const t = haystack(i);
    const category = classifyCategory(t);
    if (!category) continue;
    rows.push({
      actor: pickActor(i, category),
      category,
      action: i.title.trim().replace(/\.$/, ""),
      date: fmtDate(i.occurredAt),
    });
  }
  if (rows.length === 0) return null;

  // Group by category so the block reads cleanly and the strongest
  // signals (Producer / Buyer / Government) lead.
  const ORDER: Category[] = [
    "Producer action",
    "Buyer action",
    "Government / policy action",
    "Infrastructure / routing action",
    "Market / supply signal",
  ];
  const byCategory = new Map<Category, ClassifiedAction[]>();
  for (const r of rows) {
    const arr = byCategory.get(r.category) ?? [];
    arr.push(r);
    byCategory.set(r.category, arr);
  }

  const blocks: string[] = [];
  for (const cat of ORDER) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    const lines = items.slice(0, 4).map((r) => {
      const datePart = r.date ? ` (${r.date})` : "";
      return `• ${r.actor} — ${r.action}${datePart}`;
    });
    blocks.push(`${cat}\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
}
