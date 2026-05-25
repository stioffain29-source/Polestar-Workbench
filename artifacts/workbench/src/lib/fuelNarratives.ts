// Fuel Watch auto-derived narrative blocks.
//
// Regional Highlights, Producer/Buyer Actions and the Operational Read
// are derived from the in-window incident set. Outputs read like
// analyst prose — never raw headline dumps and never weak "Unknown"
// rows. Helpers return null / empty so the caller can omit a section
// instead of padding it.

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

// Operational issue families, in priority order. Each family carries:
//   phrase: short label for the signal
//   why:    one-line business reason it matters
//   watch:  one-line "what should business users watch for"
//   key:    stable identifier used by the Operational Read aggregation
interface IssueFamily {
  key:
    | "chokepoint"
    | "refinery"
    | "shortage"
    | "tanker"
    | "policy"
    | "pricing"
    | "crude";
  test: RegExp[];
  phrase: string;
  why: string;
  watch: string;
}
const ISSUE_FAMILIES: IssueFamily[] = [
  {
    key: "chokepoint",
    test: [/\b(strait of hormuz|hormuz)\b/, /\bbab[- ]el[- ]mandeb\b/, /\bred sea\b/, /\bmalacca\b/, /\bsuez\b/],
    phrase: "chokepoint pressure and tanker-route disruption",
    why: "Route pressure on Hormuz, Bab-el-Mandeb or the Red Sea feeds straight into bunker cost, transit time and war-risk premium.",
    watch: "Watch for fresh advisories, vessel reroutes and any naval movement that signals escalation.",
  },
  {
    key: "refinery",
    test: [/\b(refinery|refineries) (outage|disruption|fire|attack|halt|maintenance|shutdown|closure)/],
    phrase: "refinery disruption and supply-side outage",
    why: "Refinery outage typically tightens regional crack spreads and pushes downstream pump and bunker prices up within days.",
    watch: "Watch for restart timelines, force-majeure declarations and follow-on import announcements.",
  },
  {
    key: "shortage",
    test: [/\b(fuel|petrol|diesel|lpg|kerosene|jet fuel) (shortage|stockout|rationing|queue|queues)/, /\bforecourt (closure|shut|queue|disruption)/],
    phrase: "shortages, rationing and forecourt disruption",
    why: "Forecourt shortages put road transport, staff movement and generator runtime under immediate continuity pressure.",
    watch: "Watch for rationing rules, allocation cuts to commercial users and convoy or queue management announcements.",
  },
  {
    key: "tanker",
    test: [/\btanker (driver|drivers|strike|shortage|attack|blockade|convoy)/, /\b(fuel|tanker) (convoy|hijack|seizure)/],
    phrase: "tanker and fuel-transport disruption",
    why: "Tanker driver action or convoy disruption usually shows up as delivery delays at depots and forecourts inside a few days.",
    watch: "Watch for negotiation outcomes, military or police escort decisions and downstream depot-stock levels.",
  },
  {
    key: "policy",
    test: [
      /\b(subsidy|subsidies|levy|levies|duty|excise|tax) .{0,30}(fuel|petrol|diesel|gas|lpg|kerosene)/,
      /\b(price control|price cap|price freeze|export ban|import ban)/,
    ],
    phrase: "policy and subsidy / levy moves",
    why: "Policy moves on subsidies, levies or price controls reset operating cost assumptions and contract pass-through clauses.",
    watch: "Watch for gazette dates, ministerial statements and any contract-renegotiation triggers from suppliers.",
  },
  {
    key: "pricing",
    test: [/\b(pump price|petrol price|diesel price|fuel price) (hike|rise|increase|cut|drop|fall|change)/, /\bfuel surcharge\b/],
    phrase: "pump and surcharge pricing pressure",
    why: "Pump and surcharge moves flow through fleet cost, freight rates and supplier invoices within the next billing cycle.",
    watch: "Watch for surcharge revisions on freight contracts and any government push-back against price rises.",
  },
  {
    key: "crude",
    test: [/\b(oil|crude) (export ban|export halt|embargo|sanctions|sabotage|attack|spill)/],
    phrase: "crude supply-chain and sanctions pressure",
    why: "Crude-side disruption rolls into bunker, jet and downstream pricing on a 1-2 week lag and is hard to hedge away cleanly.",
    watch: "Watch for OPEC+ commentary, sanctions enforcement signals and any retaliation in shipping lanes.",
  },
];

function familyFor(items: TopicFastFactsIncident[]): IssueFamily | null {
  for (const fam of ISSUE_FAMILIES) {
    for (const i of items) {
      const t = haystack(i);
      if (fam.test.some((re) => re.test(t))) return fam;
    }
  }
  return null;
}

/**
 * Country-level Fuel Watch highlights as proper analyst paragraphs.
 * Each country answers three questions: what is the signal, why does
 * it matter, what should the reader watch. Records without a usable
 * country attribution are dropped and "Unknown" is never emitted.
 * Returns null when there is nothing usable to say.
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
  for (let idx = 0; idx < lead.length; idx++) {
    const [country, items] = lead[idx];
    const fam = familyFor(items);
    const phrase = fam?.phrase ?? "fuel-operational reporting";
    const why = fam?.why ?? "These records signal underlying pressure on local fuel availability and cost.";
    const watch = fam?.watch ?? "Watch the next reporting cycle to confirm whether the pattern persists or eases.";
    const n = items.length;
    const recordsClause = n === 1 ? "A single record this cycle points to" : `${n} records this cycle point to`;
    let opener: string;
    if (idx === 0) {
      opener = `${titleCase(country)} is the clearest pressure point in this window.`;
    } else if (idx === 1) {
      opener = `${titleCase(country)} carries a secondary but credible signal.`;
    } else {
      opener = `${titleCase(country)} adds further weight to the picture.`;
    }
    paragraphs.push(`${opener} ${recordsClause} ${phrase}. ${why} ${watch}`);
  }
  return paragraphs.join("\n\n");
}

// Producer/buyer/government/infrastructure/market classification rules.
// Order matters: a record is assigned to the first matching category.
export type FuelActionCategory =
  | "Producer action"
  | "Buyer action"
  | "Government / policy action"
  | "Infrastructure / routing action"
  | "Market / supply signal";

interface CategoryRule {
  category: FuelActionCategory;
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

function classifyCategory(t: string): FuelActionCategory | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.test.some((re) => re.test(t))) return rule.category;
  }
  return null;
}

// Category → "Operational Read" template. Kept generic so it reads as
// analyst judgement, not a headline restatement.
const OPERATIONAL_READ_BY_CATEGORY: Record<FuelActionCategory, string> = {
  "Producer action":
    "Supply-side move: expect knock-on impact on bunker, jet and downstream pricing if the action sustains.",
  "Buyer action":
    "Buyer-side hedging or sourcing pressure; spot and contract pricing on similar grades is likely to follow.",
  "Government / policy action":
    "Policy moves reset pump price and subsidy exposure; review contract pass-through and surcharge clauses.",
  "Infrastructure / routing action":
    "Route diversification remains a live mitigation theme for Gulf-linked and Red Sea fuel movement.",
  "Market / supply signal":
    "Reinforces the cost-pressure picture in the market indicators; treat as confirming, not new, evidence.",
};

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

function pickActor(i: TopicFastFactsIncident, category: FuelActionCategory): string {
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

export interface ProducerBuyerActionRow {
  actor: string;
  category: FuelActionCategory;
  action: string;
  operationalRead: string;
  date: string;
}

/**
 * Classified producer / buyer / government / infrastructure / market
 * actions referenced in the window. Returns ordered table rows or an
 * empty array when nothing matches.
 */
export function buildFuelProducerBuyerActions(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
}): ProducerBuyerActionRow[] {
  const window = filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  if (window.length === 0) return [];

  const raw: ProducerBuyerActionRow[] = [];
  for (const i of window) {
    const t = haystack(i);
    const category = classifyCategory(t);
    if (!category) continue;
    raw.push({
      actor: pickActor(i, category),
      category,
      action: i.title.trim().replace(/\.$/, ""),
      operationalRead: OPERATIONAL_READ_BY_CATEGORY[category],
      date: fmtDate(i.occurredAt),
    });
  }
  if (raw.length === 0) return [];

  // Group by category in the priority order so the strongest signals
  // (Producer / Buyer / Government) lead the table.
  const ORDER: FuelActionCategory[] = [
    "Producer action",
    "Buyer action",
    "Government / policy action",
    "Infrastructure / routing action",
    "Market / supply signal",
  ];
  const out: ProducerBuyerActionRow[] = [];
  for (const cat of ORDER) {
    const items = raw.filter((r) => r.category === cat).slice(0, 4);
    out.push(...items);
  }
  return out;
}

/**
 * Operational Read — translates the in-window incident picture into a
 * short prose section (1-2 paragraphs). Aggregates by issue family so
 * the section never repeats the Related Incidents table.
 */
export function buildFuelOperationalRead(opts: {
  issueDate: string;
  incidents: TopicFastFactsIncident[];
}): string | null {
  const window = filterTopicReportIncidents(opts.incidents, "fuel", opts.issueDate);
  if (window.length === 0) return null;

  const counts = new Map<IssueFamily["key"], { fam: IssueFamily; items: TopicFastFactsIncident[] }>();
  for (const i of window) {
    const t = haystack(i);
    for (const fam of ISSUE_FAMILIES) {
      if (fam.test.some((re) => re.test(t))) {
        const slot = counts.get(fam.key) ?? { fam, items: [] };
        slot.items.push(i);
        counts.set(fam.key, slot);
        break;
      }
    }
  }
  if (counts.size === 0) {
    // We have window items but none mapped to a recognised family. Say
    // so plainly rather than padding with generic language.
    return `The window carries ${window.length} fuel-relevant record${window.length === 1 ? "" : "s"} that do not group into a single dominant operational theme this cycle. Treat the read as directional and rely on the related-incidents table below for the detail.`;
  }

  // Country roll-up for the closing line ("strongest operational signal").
  const byCountry = new Map<string, number>();
  for (const i of window) {
    const k = normaliseCountry(i.country);
    if (!k) continue;
    byCountry.set(k, (byCountry.get(k) ?? 0) + 1);
  }
  const topCountries = Array.from(byCountry.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const ordered = Array.from(counts.values()).sort((a, b) => b.items.length - a.items.length);

  const themeLine = ordered
    .slice(0, 3)
    .map(({ fam, items }) => {
      const n = items.length;
      return `${fam.phrase} (${n} record${n === 1 ? "" : "s"})`;
    })
    .join("; ");

  const lead = ordered[0];
  const driverPara = `The dominant operational themes in this window are ${themeLine}. ${lead.fam.why}`;

  const watchLines: string[] = [];
  for (const { fam } of ordered.slice(0, 2)) watchLines.push(fam.watch);

  const where =
    topCountries.length > 0
      ? ` ${topCountries.map(([c]) => titleCase(c)).join(", ")} carr${topCountries.length === 1 ? "ies" : "y"} the strongest operational signal this cycle.`
      : "";

  const closingPara = `${watchLines.join(" ")}${where}`.trim();

  return `${driverPara}\n\n${closingPara}`;
}
