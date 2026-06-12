// Draft prose generator for every report builder.
//
// Goal: when a report is opened, each narrative section is prefilled with
// short analyst-style prose. The user edits it; nothing is auto-saved.
//
// Voice rules (strict, applied across Fuel, Fertiliser, Cargo, Shipping,
// Flashpoint and Energy reports):
//   - lead with the operational meaning, not with record counts
//   - plain, direct, business-relevant, calm; no consultant waffle
//   - vary sentence openers; adjacent sections must not share the same rhythm
//   - banned dashboard phrases (do not reintroduce):
//       "X records sit in the window", "Activity concentrates in",
//       "The leading patterns are", "The usable signal is",
//       "Most recent", "Records on file covering",
//       "The reporting window is noisy",
//       "Detail sits in the related incidents table below",
//       "The most serious entry reaches", "The load is on",
//       "This cycle's read", "Watch for..." as a default Watch Next opener
//   - each topic uses its own vocabulary (fuel, fertiliser, cargo, shipping,
//     flashpoint, energy) — no generic paragraph pattern shared across topics
//   - if data is thin, say so plainly; never invent confidence

import { resolveReportWindow, filterIncidentsToWindow, reportCadence } from "./reportWindow";
import { classifyIncidentType, type ClassifiableIncident } from "./incidentClassifier";
import { isTopicRelevant, isCountryRelevant } from "./topicRelevance";
import { selectFlashpointUsable } from "./flashpointReportDataset";
import { buildShippingReportDataset, type ShippingReportIncident } from "./shippingReportDataset";

export interface DraftableIncident extends ClassifiableIncident {
  id?: number | string;
  severity: string;
  occurredAt: string;
  country?: string | null;
}

export interface TopicReportProse {
  executiveSummary: string;
  situation: string;
  whatHappened: string;
  whatMatters: string;
  implications: string;
  watchNext: string;
  polestarView: string;
}

export interface CountryReportProse {
  // Auto-derived sections (always populated, never persisted; render-time only).
  executiveSummary: string;
  whatMatters: string;
  watchNext: string;
  polestarView: string;
  // Persisted editable sections — mapped to the new section labels:
  //   overview      -> Situation
  //   trendSummary  -> What Happened
  //   implications  -> Implications for Business
  overview: string;
  trendSummary: string;
  implications: string;
}

// ---------------------------------------------------------------------------
// Shared counters
// ---------------------------------------------------------------------------

function countBy<T>(items: T[], key: (t: T) => string): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

function joinList(parts: string[]): string {
  const clean = parts.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

// Multi-country strings ("South Korea; Iran", "China, Iran") are split so
// each country scores individually. "Unknown" is dropped.
function expandCountries(raw: string | null | undefined): string[] {
  const v = (raw ?? "").trim();
  if (!v) return [];
  return v
    .split(/[;,/]+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^unknown$/i.test(s));
}

// Top countries as a plain list ("Iran, India and Pakistan") — no (n) counts
// inside the prose. Counts must support, not dominate, the read.
function topCountriesPlain(rows: DraftableIncident[]): string {
  const m = new Map<string, number>();
  for (const r of rows) {
    for (const c of expandCountries(r.country)) {
      m.set(c, (m.get(c) ?? 0) + 1);
    }
  }
  const counts = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  if (counts.length === 0) return "";
  return joinList(counts.slice(0, 3).map(([c]) => c));
}

// Lead country (first by volume) used to pick a "clearest pressure point"
// when the prose calls one out.
function leadCountry(rows: DraftableIncident[]): string {
  const m = new Map<string, number>();
  for (const r of rows) {
    for (const c of expandCountries(r.country)) {
      m.set(c, (m.get(c) ?? 0) + 1);
    }
  }
  const counts = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  return counts[0]?.[0] ?? "";
}

// Strip product-family words so the type label reads as the event itself.
const PRODUCT_WORDS = /\b(fuel|fertiliser|fertilizer|energy|cargo|shipping|maritime|flashpoint|protest|protests|civil)\b/gi;

const TYPE_REMAP: Record<string, string> = {
  "naval / advisory": "naval advisory",
  "to-power disruption": "power supply disruption",
  "farmer": "farmer action",
  "/ freight pressure": "freight pressure",
  "insurance / freight pressure": "insurance and freight pressure",
  "/ loss": "loss events",
  "theft / loss": "theft and loss",
  "fertiliser shortage": "shortage",
  "supply chain disruption": "supply chain disruption",
};

function cleanTypeLabel(raw: string): string {
  let s = raw.toLowerCase().trim();
  if (/^other .* incident$/.test(s)) return "";
  // Drop armed-conflict / kinetic labels entirely — these are excluded
  // from the protests/flashpoint dataset by design, so they must not
  // surface in the Executive Summary "driver" sentence.
  if (/\b(armed group|armed[- ]?conflict|militant|insurgent|terror|kinetic|drone|missile|airstrike|air[- ]?strike|shelling|ambush|ied|suicide|car bomb|jihadist|ttp|isis|baloch liberation|bla)\b/.test(s)) return "";
  s = s.replace(PRODUCT_WORDS, " ");
  s = s.replace(/\s*\/\s*/g, " / ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[\/,\-\s]+/, "").trim();
  s = s.replace(/[\/,\-\s]+$/, "").trim();
  s = s.replace(/^\/ ?/, "").replace(/ ?\/$/, "").trim();
  if (TYPE_REMAP[s]) s = TYPE_REMAP[s];
  if (/^(to|of|for|and|or|the|a)$/.test(s)) return "";
  if (s.length < 4) return "";
  return s;
}

function topTypesText(rows: DraftableIncident[]): string {
  const counts = countBy(rows, (r) => classifyIncidentType(r));
  if (counts.length === 0) return "";
  const cleaned: string[] = [];
  for (const [label] of counts) {
    const c = cleanTypeLabel(label);
    if (c && !cleaned.includes(c)) cleaned.push(c);
    if (cleaned.length === 3) break;
  }
  return joinList(cleaned);
}

function highestSeverity(rows: DraftableIncident[]): string {
  const rank: Record<string, number> = { insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5 };
  let best = "";
  let bestRank = 0;
  for (const r of rows) {
    const s = (r.severity ?? "").toLowerCase();
    const rk = rank[s] ?? 0;
    if (rk > bestRank) { bestRank = rk; best = s; }
  }
  return best;
}

function periodPhrase(topic: string, issueDate: string): string {
  const w = resolveReportWindow(topic, issueDate);
  return w.shortLabel;
}

function cadenceWord(topic: string): string {
  // Single source of truth: defer to reportWindow so prose voice ("this month"
  // vs "this week") never drifts from the actual report window/cadence.
  return reportCadence(topic);
}

// ---------------------------------------------------------------------------
// Per-topic prose packs
//
// Each pack owns its own vocabulary and its own opener variants so adjacent
// sections do not start the same way. Builders receive a small context object
// and decide how to use counts (as supporting evidence, never as the lead).
// ---------------------------------------------------------------------------

interface BuildCtx {
  total: number;
  countries: string;   // "Iran, India and Pakistan"
  lead: string;        // "Iran"
  types: string;       // "price increase, shortage and transport disruption"
  sev: string;         // "high" | ""
  period: string;      // "18 May - 24 May"
  cadence: string;     // "weekly" | "monthly"
  thin: boolean;       // total < 3
}

type SectionBuilder = (ctx: BuildCtx) => string;

interface ReportPack {
  exec: SectionBuilder;
  situation: SectionBuilder;
  whatHappened: SectionBuilder;
  whatMatters: SectionBuilder;
  implications: SectionBuilder;
  watchNext: SectionBuilder;
  polestarView: SectionBuilder;
  zeroExec: string;
  zeroSituation: string;
  zeroWhatHappened: string;
  zeroWhatMatters: string;
  zeroPolestar: string;
  thinNote: string;
}

function sevTail(sev: string): string {
  return sev ? ` The most serious reached ${sev}.` : "";
}

function thinTail(thin: boolean, total: number, cadence: string): string {
  if (!thin || total === 0) return "";
  const period = cadence === "monthly" ? "month" : "week";
  return ` There is little to go on this ${period}, so treat this as a rough guide.`;
}

// Fuel Watch tracks cost-and-continuity pressure, not casualty-grade events.
// The shared severity classifier tags individual price/policy wire headlines
// (e.g. a fuel-levy debate, a postponed price hike, a pipeline part-complete)
// as "extreme", which overstates operational severity for a market watch. So
// the Fuel pack reports OPERATING PRESSURE, capped at "high", instead of echoing
// a per-record "Severity peaked at extreme" label the evidence does not support.
function fuelPressureTail(sev: string): string {
  if (!sev) return "";
  const level =
    sev === "extreme" || sev === "high"
      ? "high"
      : sev === "moderate"
        ? "elevated"
        : "contained";
  return ` Operating pressure right now reads as ${level}.`;
}

// ---------------------------------------------------------------------------
// Fuel Watch
// ---------------------------------------------------------------------------
const FUEL: ReportPack = {
  // Executive Summary: 3 short paragraphs covering the headline judgement,
  // what the incident reporting adds, and the business meaning.
  exec: ({ types, lead, countries, sev, thin, total, cadence }) => {
    const driver = types || "price movement, shortage reporting and transport disruption";
    const geo = lead
      ? ` ${lead} saw the most activity${countries && countries !== lead ? `, with more reported from ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    const para1 = `Fuel risk this ${cadence === "monthly" ? "month" : "week"} is mainly about cost and continuity rather than a single dramatic event. The pressure came from ${driver}.${geo}${fuelPressureTail(sev)}${thinTail(thin, total, cadence)}`;
    const para2 = `Cost indicators are holding above easy-budget levels, and the incident picture adds operational stress — shortages, forecourt disruption, subsidy moves and route pressure where they appear — rather than relief.`;
    const para3 = `For business users, the headline is straightforward: protect fuel-dependent operations from short-notice price or availability shocks. That means live attention to fuel stock cover, generator runtime, road transport exposure and supplier resilience while this picture holds.`;
    return `${para1}\n\n${para2}\n\n${para3}`;
  },
  // Situation: short — current operating picture, why the cycle
  // matters. No section cross-references, no meta-report wording.
  situation: ({ lead }) => {
    const where = lead ? ` ${lead} is the country carrying the most weight.` : "";
    return `Fuel cost is holding above easy-budget levels while availability and policy pressure remain live downstream. This matters because cost pressure and availability pressure are showing up together right now, which is when contract economics and operational continuity stop being separate concerns.${where}`;
  },
  // What Happened: short — what changed or was reported. No
  // cross-references to Market Read / Operational Read, no "table
  // below" language.
  whatHappened: ({ types, countries, sev, lead }) => {
    if (!types) {
      return `Fuel reporting was light recently, with no single pattern standing out.${fuelPressureTail(sev)}`;
    }
    const secondaries = countries && countries !== lead
      ? countries.replace(`${lead}, `, "").replace(`${lead} and `, "")
      : "";
    const geo = lead
      ? ` concentrated on ${lead}${secondaries ? `, with secondary reporting from ${secondaries}` : ""}`
      : "";
    return `Reporting was led by ${types}${geo}.${fuelPressureTail(sev)}`;
  },
  // What Matters: two analytical paragraphs connecting prices, jet movement,
  // shortage / route pressure and business continuity.
  whatMatters: ({ lead }) => {
    const where = lead ? ` Exposure to ${lead} is the live pressure point for fleet, generator and field operations.` : "";
    const para1 = `Elevated crude and a jet fuel series that is not retreating tell the cost side of the story: fuel-linked invoices stay heavy. The incident picture then tells the availability side: shortages, rationing and route pressure are the points where price stops being the only problem and physical access becomes the issue.${where}`;
    const para2 = `Where the two reinforce each other — high prices meeting tight supply or chokepoint disruption — the operational impact compounds. Freight rates lift, surcharge clauses fire, generator runtime decisions get made on tighter stocks, and supplier conversations turn into renegotiations rather than confirmations. That is the picture worth planning against now.`;
    return `${para1}\n\n${para2}`;
  },
  // Implications for Business: practical and client-useful, one distinct
  // action per bullet. Emitted as discrete "- " bullets (not dense
  // paragraphs) so each point reads as a separate action and the section
  // never collapses into two long blocks or repeats itself.
  implications: () => {
    const lines = [
      "Revisit bulk-fuel contract pricing and surcharge pass-through clauses now — elevated indicators usually hit the next invoice cycle, not the current one.",
      "Forward-cover the bulk and aviation fuel lines you depend on rather than waiting for the spot move to confirm.",
      "Check on-site fuel stock cover and generator runtime assumptions against a short-notice availability shock.",
      "Pull commercial-allocation conversations forward with suppliers where rationing or forecourt disruption is being reported.",
      "Agree escalation triggers in advance (queues, allocation cuts, station closures), and where Gulf or Red Sea routing matters treat route diversification as a live mitigation.",
    ];
    return lines.map((l) => `- ${l}`).join("\n");
  },
  // Watch Next: 3-5 forward-looking indicators, one short sentence each.
  watchNext: () => {
    const lines = [
      "Subsidy or levy decisions — a single gazette notice can reset pump price and contract economics overnight.",
      "Rationing or forecourt disruption — queue formation, allocation cuts or station closures are the fastest operational tells.",
      "Refinery or supply interruption — outages and force-majeure declarations usually feed into crack spreads and downstream pricing within days.",
      "Jet fuel price movement — sustained moves in the trajectory flow through to aviation surcharges and bunker-adjacent costs.",
      "Gulf and Hormuz route pressure — fresh advisories, naval movement or vessel reroutes shift war-risk premium and transit time.",
    ];
    return lines.join("\n");
  },
  // Polestar View: the clearest "so what" judgement in the report.
  polestarView: ({ lead, countries }) => {
    const pressure = lead
      ? ` ${lead} is the clearest country pressure point${countries && countries !== lead ? `, with the rest of the picture filled in by ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : " No single country stands out right now.";
    return `Fuel Watch is flagging a cost-and-continuity risk right now, not simply a rise in fuel headlines. The market indicators show elevated fuel costs holding rather than easing, while the incident picture shows operational stress around shortages, route pressure and policy intervention. For business users, the priority is to protect movement, backup power and fuel-dependent operations from short-notice price or availability shocks.${pressure}`;
  },
  zeroExec: "Fuel reporting was quiet this week. Read that as a gap in reporting rather than a sign that supply has settled. The market indicators in the Fast Facts and Jet Fuel Price Trajectory still carry the cost-side picture. For business users, the lasting exposures — fuel stock cover, generator runtime, road transport exposure and supplier resilience — remain the focus until fresh reporting comes through.",
  zeroSituation: "Underlying exposure to shortage, subsidy change and refinery disruption remains, even in a quiet week.",
  zeroWhatHappened: "Nothing notable on fuel came through this week, so the picture carries over from recent weeks rather than fresh reporting.",
  zeroWhatMatters: "Transport cost, generator reliance and continuity at high-fuel-use sites stay the standing concern whether or not anything is reported. With no fresh incidents this week, the market indicators above carry the picture on their own; treat them as the cost floor for any forward planning.",
  zeroPolestar: "Nothing useful came through on fuel incidents this week, so the picture leans on the market indicators above. Keep current fuel-resilience measures in place and revisit once new reporting comes through.",
  thinNote: "Fuel reporting was light this week. Treat that as a gap in reporting, not a sign that supply has settled.",
};

// ---------------------------------------------------------------------------
// Fertiliser Watch
// ---------------------------------------------------------------------------
const FERTILISER: ReportPack = {
  // Executive Summary: three short paragraphs — the headline judgement, what
  // the incident reporting adds, and the business meaning.
  exec: ({ types, lead, countries, sev, thin, total, cadence }) => {
    const period = cadence === "monthly" ? "month" : "week";
    const driver = types || "pricing, supply security and export policy";
    const geo = lead
      ? ` ${lead} carried the most reporting${countries && countries !== lead ? `, with more from ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    const para1 = `Fertiliser risk this ${period} is a cost-and-supply story rather than a single dramatic event. The pressure showed up as ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total, cadence)}`;
    const para2 = `The reporting tracks the affordability and availability of urea, DAP and ammonia — the inputs that set planting economics. Price moves, import and subsidy decisions, and any production interruption are the levers that decide whether farmers and downstream food costs feel relief or strain.`;
    const para3 = `For business users, the priority is forward cover: secure the input lines you depend on, watch for export or subsidy shifts that can reset prices quickly, and keep contingency for single-source urea and potash exposure while this picture holds.`;
    return `${para1}\n\n${para2}\n\n${para3}`;
  },
  situation: ({ types, lead }) => {
    const focus = types
      ? `Supply security, pricing and export policy stay front of mind, currently showing up as ${types}.`
      : "Supply security, pricing and export policy stay front of mind, with farmer access and planting timing the operational concern.";
    const where = lead ? ` ${lead} sits at the centre of the current reporting.` : "";
    return `${focus} The chain runs from input price and availability into farm output and onward food cost.${where}`;
  },
  whatHappened: ({ types, countries, sev, lead }) => {
    if (!types) {
      return `Fertiliser reporting was light recently, with no single pattern standing out.${sevTail(sev)}`;
    }
    const secondaries = countries && countries !== lead
      ? countries.replace(`${lead}, `, "").replace(`${lead} and `, "")
      : "";
    const geo = lead
      ? ` Reporting concentrated on ${lead}${secondaries ? `, with more from ${secondaries}` : ""}.`
      : "";
    return `Activity centred on ${types}.${geo}${sevTail(sev)}`;
  },
  whatMatters: ({ lead }) => {
    const where = lead ? ` Exposure to ${lead} is the live pressure point for forward stock cover and supplier conversations.` : "";
    const para1 = `Fertiliser pricing and availability feed straight into planting decisions and farm input cost, and from there into the wider food security picture. When urea or DAP gets dearer or harder to source, the cost lands on the next planting cycle rather than the current invoice.${where}`;
    const para2 = `Where price pressure meets a supply or production interruption, the impact compounds: subsidy bills rise, import bills stretch, and governments lean on export controls or emergency procurement. Those interventions are the points where a slow cost story turns into a short-notice availability problem worth planning against now.`;
    return `${para1}\n\n${para2}`;
  },
  implications: () => {
    const lines = [
      "Secure forward cover on the urea, DAP and ammonia lines you depend on rather than waiting for the next price move to confirm.",
      "Map single-source exposure to urea and potash, and line up alternate suppliers before a shortage forces the conversation.",
      "Track subsidy and export-policy signals — a single notice can reset input economics and availability quickly.",
      "Stress-test planting and production budgets against a short-notice price spike or import interruption.",
      "Pull procurement conversations forward where shortage, plant outage or feedstock pressure is being reported.",
    ];
    return lines.map((l) => `- ${l}`).join("\n");
  },
  watchNext: () => {
    const lines = [
      "Export restrictions and quotas — bans or curbs on urea, DAP or potash reset regional availability fast.",
      "Subsidy and budget decisions — changes to the subsidy regime feed straight into farm-gate prices.",
      "Plant maintenance and production outages — ammonia or urea unit interruptions tighten supply within weeks.",
      "Import tenders and procurement deals — tender pricing and volume signal the next cost direction.",
      "Farmer access and protest activity — queues, rationing and unrest are the fastest operational tells.",
    ];
    return lines.join("\n");
  },
  polestarView: ({ lead, countries }) => {
    const pressure = lead
      ? ` ${lead} is the clearest country to watch when planning forward cover${countries && countries !== lead ? `, with the rest of the picture filled in by ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : " No single country stands out right now.";
    return `Fertiliser Watch is flagging a supply-continuity and cost risk, not simply a rise in headlines. The standing concern is whether input price and availability hold steady enough for planting economics to work. For business users, the priority is to protect forward cover and supplier resilience against short-notice price or availability shocks.${pressure}`;
  },
  zeroExec: "Fertiliser reporting was quiet this month. Read that as a gap in reporting rather than proof of market calm. The standing exposures — input price, supply security and export policy — still set the picture for planting economics and food cost until fresh reporting comes through.",
  zeroSituation: "Supply security, pricing and export decisions remain the operating concern even when little is reported.",
  zeroWhatHappened: "Little fertiliser reporting came through, so the picture rests on recent months rather than fresh reporting.",
  zeroWhatMatters: "Farm input cost, planting decisions and downstream food price pressure stay live exposures whatever is reported. With nothing fresh this month, treat the recent assessment as the working baseline.",
  zeroPolestar: "Nothing useful came through on fertiliser this month. Hold the recent assessment and keep forward-cover measures in place until fresh reporting arrives.",
  thinNote: "Fertiliser reporting was light this month. Treat that as a gap in reporting, not proof of supply stability.",
};

// ---------------------------------------------------------------------------
// Cargo Watch
// ---------------------------------------------------------------------------
const CARGO: ReportPack = {
  exec: ({ types, lead, countries, sev, thin, total, cadence }) => {
    const driver = types || "theft, pilferage and warehouse loss";
    const geo = lead
      ? ` ${lead} saw the most consistent reporting${countries && countries !== lead ? `, alongside ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    return `Cargo loss this month was shaped by ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total, cadence)}`;
  },
  situation: ({ types, lead }) => {
    const focus = types ? `Warehouse, depot and road corridors hold the live exposure, currently visible in ${types}.` : "Warehouse, depot and road corridors hold the live exposure, with route knowledge and insider risk as the persistent drivers.";
    const where = lead ? ` ${lead} sits at the centre of the recurring geography.` : "";
    return `${focus}${where}`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `The dominant patterns were ${types}.` : `Little classifiable cargo activity came through.`;
    const geo = countries ? ` Loss reporting concentrated on ${countries}.` : "";
    return `${lead}${geo}${sevTail(sev)}`;
  },
  whatMatters: ({ countries }) => {
    const where = countries ? ` Repeat geography in ${countries} points to known modus operandi rather than isolated events.` : "";
    return `Loss in this category lands directly on supply chain continuity, insurance exposure and the cost of moving goods through repeat corridors.${where}`;
  },
  implications: () =>
    "Review routing, escort use on high-value moves, depot access controls, seal and lock checks at handover, and insurance cover for repeat corridors. Cross-check supplier vetting on yard staff and contracted drivers.",
  watchNext: () =>
    "Look for copycat losses on the same corridor inside two weeks of a reported event, fresh arrests or recoveries, and route shifts that quietly push volume through weaker depots.",
  polestarView: ({ lead, countries }) => {
    const where = countries ? ` ${countries} hold the recurring geography${lead ? `; ${lead} is the lead pressure point` : ""}.` : "";
    return `Insider knowledge and route familiarity continue to drive the larger losses.${where}`;
  },
  zeroExec: "Cargo reporting was quiet this month. Read that as a gap in reporting, not proof that the problem is absent.",
  zeroSituation: "Warehouse, depot and road-corridor exposure persists regardless of how quiet reporting looks.",
  zeroWhatHappened: "Little cargo activity came through, so the picture carries over from recent weeks.",
  zeroWhatMatters: "Insider knowledge and route familiarity continue to sit behind the larger losses whether or not new reporting lands.",
  zeroPolestar: "Nothing useful came through on cargo this month. Hold the recent assessment and revisit once fresh reporting arrives.",
  thinNote: "Cargo reporting was light this month. Treat that as a gap in reporting, not proof that the problem is absent.",
};

// ---------------------------------------------------------------------------
// Shipping Watch
// ---------------------------------------------------------------------------
const SHIPPING: ReportPack = {
  exec: ({ types, lead, countries, sev, thin, total, cadence }) => {
    const driver = types || "chokepoint exposure, vessel risk and freight-side pressure";
    const geo = lead
      ? ` ${lead} saw the most activity${countries && countries !== lead ? `, with less from ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : " No single country stands out, and several reports do not pin down a precise location.";
    return `Maritime reporting was centred on ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total, cadence)}`;
  },
  situation: ({ types }) => {
    const focus = types ? `Chokepoints and major ports remain the standing pressure points, currently showing up as ${types}.` : "Chokepoints and major ports remain the standing pressure points, with vessel and freight-side risk close behind.";
    return `${focus}`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `Maritime activity was shaped by ${types}.` : `Maritime activity was light this week.`;
    const geo = countries ? ` Reporting traced back to ${countries}.` : "";
    return `${lead}${geo}${sevTail(sev)}`;
  },
  whatMatters: () =>
    "Pressure here feeds straight into transit time, freight cost and war-risk premium exposure across the wider region. A small shift on any one chokepoint usually shows up in the freight and insurance picture soon after.",
  implications: () =>
    "Re-walk routing options around affected chokepoints, port-call sequencing, bunker planning and war-risk premium exposure. Confirm crew-change and advisory triggers with operators.",
  watchNext: () =>
    "Next week hinges on a handful of triggers: fresh port closures or strikes, naval movement near Hormuz, Bab-el-Mandeb or the Malacca approaches, new maritime advisories, and visible moves in war-risk premiums or freight indices.",
  polestarView: ({ lead }) =>
    `Chokepoint exposure remains the dominant operational concern, supported by freight and insurance pressure and a thinner layer of commercial disruption.${lead ? ` ${lead} saw the most activity this week.` : ""}`,
  zeroExec: "Maritime reporting was quiet this week. Read that as a gap in reporting rather than proof of calm at sea.",
  zeroSituation: "Chokepoint, vessel and freight-side exposure persists even when little is reported.",
  zeroWhatHappened: "No notable maritime activity came through, so the picture is a rough guide rather than firm.",
  zeroWhatMatters: "Underlying pressure on transit time, freight cost and war-risk premium remains, whatever is reported.",
  zeroPolestar: "Nothing useful came through on shipping this week. Standing exposure to chokepoint, vessel and freight risk remains.",
  thinNote: "Shipping reporting was light this week. Treat that as a gap in reporting, not proof that disruption has eased.",
};

// ---------------------------------------------------------------------------
// Flashpoint
// ---------------------------------------------------------------------------
const FLASHPOINT: ReportPack = {
  // Executive Summary: three short analyst paragraphs covering the
  // headline judgement, what the reporting adds and the business
  // meaning. No dashboard tells like "drew the most consistent
  // reporting" or "Severity peaked at extreme."
  exec: ({ types, lead, countries, sev, thin, total }) => {
    const driver = types || "protest activity, civil unrest and public-order disruption";
    const secondaries = countries && lead && countries !== lead
      ? countries.replace(`${lead}, `, "").replace(`${lead} and `, "")
      : "";
    const geoLead = lead
      ? `${lead} carries the heaviest concentration${secondaries ? `, with ${secondaries} as supporting watch areas` : ""}`
      : "no single country stands out this week";
    const sevClause = sev
      ? ` The most serious reached ${sev.toLowerCase()}, so this week is not routine.`
      : "";
    const thinClause = thin && total > 0
      ? " There is little to go on this week, so treat this as a rough guide."
      : "";
    const para1 = `Flashpoint risk this week is about operational tempo rather than a single headline event. It was shaped by ${driver}, and ${geoLead}.${sevClause}${thinClause}`;
    const para2 = `What stands out is speed: these events move from notice to road closure, transport halt or site-access disruption inside a working day. The pattern is rapid escalation against a standing baseline, not isolated flare-ups.`;
    const para3 = `For business users the implication is straightforward: protect staff movement, site access and continuity comms against short-notice disruption on the named cities. Standing readiness — refreshed journey-management, agreed escalation triggers and live country-lead routing — does more work this week than headline-severity tracking.`;
    return `${para1}\n\n${para2}\n\n${para3}`;
  },
  situation: ({ types }) => {
    const focus = types ? `Fast-moving events on streets, transport hubs and central business districts shape the picture, with ${types} the visible drivers.` : "Fast-moving events on streets, transport hubs and central business districts shape the picture, with rapid escalation the standing risk.";
    return `${focus} Operational impact lands quickly when these surface.`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `Disruption centred on ${types}.` : `Little flashpoint activity came through.`;
    const geo = countries ? ` Activity concentrated around ${countries}.` : "";
    return `${lead}${geo}${sevTail(sev)}`;
  },
  whatMatters: ({ countries }) => {
    const where = countries ? ` Repeat activity in ${countries} is what drives live staff-movement risk.` : "";
    return `Speed is the issue: these events move from notice to road closure inside a working day, putting staff movement, site access and crisis comms under real-time pressure.${where}`;
  },
  implications: () =>
    "Hold journey management at short notice, refresh shelter-in-place and lockdown procedures, and confirm escalation routes with country leads.",
  watchNext: () =>
    "Track planned political dates, calls to mobilise, security-force deployments and any sign of cross-city escalation.",
  polestarView: ({ lead }) => {
    const tail = lead ? ` ${lead} remains the city-by-city focus.` : "";
    return `The story this week is operational tempo rather than headline severity. Standing readiness on affected cities is what protects continuity.${tail}`;
  },
  zeroExec: "Flashpoint reporting was quiet this week. Read that as a gap in reporting, not proof that the streets are calm.",
  zeroSituation: "Fast-moving disruption risk on transport hubs and central business districts persists whether or not new reporting lands.",
  zeroWhatHappened: "Little flashpoint activity came through, so the picture draws on recent weeks.",
  zeroWhatMatters: "Speed of escalation continues to set the operational concern; staff movement and site access stay the live points.",
  zeroPolestar: "Nothing useful came through on flashpoint activity this week. Maintain standing readiness on previously affected cities.",
  thinNote: "Flashpoint reporting was light this week. Treat that as a gap in reporting, not proof of calm.",
};

// ---------------------------------------------------------------------------
// Energy Watch
// ---------------------------------------------------------------------------
const ENERGY: ReportPack = {
  exec: ({ types, lead, countries, sev, thin, total, cadence }) => {
    const driver = types || "outage events, load shedding and generation shortfall";
    const geo = lead
      ? ` ${lead} carried the most visible grid strain${countries && countries !== lead ? `, alongside ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    return `Power and grid pressure this week was led by ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total, cadence)}`;
  },
  situation: ({ types }) => {
    const focus = types ? `Capacity strain shows through ${types}, with fuel-to-power supply the underlying weakness.` : "Capacity strain remains the background condition, with fuel-to-power supply the underlying weakness.";
    return `${focus} Industrial continuity sits squarely in the firing line when outages run long.`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `Grid reporting was shaped by ${types}.` : `Grid reporting was light this week.`;
    const geo = countries ? ` Visible stress traced back to ${countries}.` : "";
    return `${lead}${geo}${sevTail(sev)}`;
  },
  whatMatters: ({ countries }) => {
    const where = countries ? ` Sites in ${countries} are the live cost centres for backup and continuity spend.` : "";
    return `Reliability gaps land on site uptime, generator load and the running cost of business continuity.${where}`;
  },
  implications: () =>
    "Review backup generator cover, fuel stock for extended outage, UPS run-time on critical sites and any single-source dependency on the public grid.",
  watchNext: () =>
    "Keep an eye on fresh load-shedding schedules, substation incidents, fuel-to-power supply moves and weather events that pressure peak demand.",
  polestarView: ({ lead }) => {
    const tail = lead ? ` ${lead} is where backup and continuity spend earn their keep this week.` : "";
    return `The grid story is one of standing fragility rather than a single dramatic event.${tail}`;
  },
  zeroExec: "Grid reporting was quiet this week. Read that as a gap in reporting rather than evidence that the grid is stable.",
  zeroSituation: "Capacity strain and fuel-to-power supply weakness remain the background condition whether or not new reporting lands.",
  zeroWhatHappened: "No notable grid stress came through, so the picture carries forward from recent weeks.",
  zeroWhatMatters: "Site uptime, generator load and continuity spend stay the operational concern on regional grids.",
  zeroPolestar: "Nothing useful came through on the grid this week. Underlying capacity gaps on most regional grids remain.",
  thinNote: "Energy reporting was light this week. Treat that as a gap in reporting, not proof that the grid is stable.",
};

// ---------------------------------------------------------------------------
// Generic civil-protest pack (used when topic is "protests" but not the
// flashpoint surface). Kept distinct from flashpoint so adjacent prose
// across reports does not converge.
// ---------------------------------------------------------------------------
const PROTESTS: ReportPack = {
  // Executive Summary: three short analyst paragraphs — headline
  // judgement, what the reporting adds, and the business meaning.
  // Avoids dashboard wording ("drew the most consistent reporting",
  // "Severity peaked at extreme") and never quotes internal filter
  // counts to the client.
  exec: ({ types, lead, countries, sev, thin, total }) => {
    const driver = types || "protest action, strike activity and public-order disruption";
    const secondaries = countries && lead && countries !== lead
      ? countries.replace(`${lead}, `, "").replace(`${lead} and `, "")
      : "";
    const geoLead = lead
      ? `${lead} carries the heaviest concentration${secondaries ? `, with ${secondaries} as supporting watch areas` : ""}`
      : "no single country stands out this week";
    const sevClause = sev
      ? ` The most serious reached ${sev.toLowerCase()}, so this week is not routine.`
      : "";
    const thinClause = thin && total > 0
      ? " There is little to go on this week, so treat this as a rough guide."
      : "";
    const para1 = `Public-order risk this week is about operational tempo rather than a single headline event. It was shaped by ${driver}, and ${geoLead}.${sevClause}${thinClause}`;
    const para2 = `What stands out is speed: these events move from notice to road closure, transit halt or site-access disruption inside a working day. The pattern is rapid escalation against a standing baseline of unrest, not isolated flare-ups.`;
    const para3 = `For business users the implication is straightforward: protect staff movement, site access and continuity comms against short-notice disruption on the named cities. Refreshed journey-management plans, agreed escalation triggers and live country-lead routing do more work this week than headline-severity tracking.`;
    return `${para1}\n\n${para2}\n\n${para3}`;
  },
  situation: ({ types }) => {
    const focus = types ? `Most events touch transport, access and central business districts, with ${types} the active patterns.` : "Most events touch transport, access and central business districts, with rapid disruption the standing risk.";
    return `${focus}`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `Reporting centred on ${types}.` : `Little public-order activity came through.`;
    const geo = countries ? ` Activity clustered around ${countries}.` : "";
    return `${lead}${geo}${sevTail(sev)}`;
  },
  whatMatters: ({ countries }) => {
    const where = countries ? ` Concentration in ${countries} carries the operational weight.` : "";
    return `These events move quickly from notice to disruption, putting staff movement, site access and business continuity under real-time pressure.${where}`;
  },
  implications: () =>
    "Review staff movement plans, journey management for affected cities, site access controls and standing crisis communication triggers.",
  watchNext: () =>
    "Track planned protest dates, university and union calls to action, police deployment notices and any escalation in arrest numbers.",
  polestarView: ({ lead }) => {
    const tail = lead ? ` ${lead} remains the city-by-city focus.` : "";
    return `Operational tempo, not headline severity, is the picture this week.${tail}`;
  },
  zeroExec: "Public-order reporting was quiet this week. Read that as a gap in reporting rather than calm streets.",
  zeroSituation: "Standing risk to transport, access and central business districts persists whether or not new reporting lands.",
  zeroWhatHappened: "Little public-order activity came through, so the picture carries forward from recent weeks.",
  zeroWhatMatters: "Staff movement and site access remain the operational concern when these events do appear.",
  zeroPolestar: "Nothing useful came through on public order this week.",
  thinNote: "Public-order reporting was light this week. Treat that as a gap in reporting, not proof of calm.",
};

const PACKS: Record<string, ReportPack> = {
  fuel: FUEL,
  fertiliser: FERTILISER,
  cargo_watch: CARGO,
  shipping: SHIPPING,
  flashpoint: FLASHPOINT,
  energy: ENERGY,
  protests: PROTESTS,
};

function packFor(topic: string): ReportPack {
  return PACKS[topic] ?? PROTESTS;
}

// ---------------------------------------------------------------------------
// Topic report draft
// ---------------------------------------------------------------------------

export function draftTopicReportProse(opts: {
  topic: string;
  issueDate: string;
  incidents: DraftableIncident[];
}): TopicReportProse {
  const { topic, issueDate, incidents } = opts;
  // Shipping reports seed their prose directly from the Shipping report
  // dataset — the SAME dataset that drives the on-screen preview, the PDF,
  // the chokepoint counts and the Regional / Country chart. This is what
  // keeps the seeded Polestar View / What Matters from ever naming a
  // different lead country than the chart: there is one country derivation
  // (deriveIncidentCountry, via ds.countryRows), and every analyst section
  // reads from it. Editor edits still win downstream; this only seeds.
  if (topic === "shipping") {
    // Carry the same fields the live preview/PDF dataset receives (id,
    // sourceUrl, location) so the seeded dataset is identical to what
    // ShippingReportPreview builds — no silent country/source divergence.
    const shipIncidents: ShippingReportIncident[] = incidents.map((r, i) => ({
      id: r.id ?? i,
      title: r.title,
      topic: r.topic,
      severity: r.severity,
      occurredAt: r.occurredAt,
      country: r.country ?? null,
      summary: r.summary ?? null,
      source: r.source ?? null,
      sourceUrl: r.sourceUrl ?? null,
      location: r.location ?? null,
    }));
    const ds = buildShippingReportDataset(shipIncidents, topic, issueDate);
    const sEnriched: DraftableIncident[] = ds.enriched.map((e) => ({
      id: e.id,
      topic: e.topic,
      title: e.title,
      summary: e.summary ?? null,
      source: e.source ?? null,
      sourceUrl: e.sourceUrl ?? null,
      location: e.location ?? null,
      severity: e.severity,
      occurredAt: e.occurredAt,
      country: e.country ?? null,
    }));
    const sTotal = sEnriched.length;
    const sLead = ds.countryRows[0]?.label ?? "";
    const sCountries = joinList(
      ds.countryRows.filter((r) => r.value > 0).slice(0, 3).map((r) => r.label),
    );
    const shipCtx: BuildCtx = {
      total: sTotal,
      countries: sCountries,
      lead: sLead,
      types: topTypesText(sEnriched),
      sev: highestSeverity(sEnriched),
      period: periodPhrase(topic, issueDate),
      cadence: cadenceWord(topic),
      thin: sTotal > 0 && sTotal < 3,
    };
    return {
      executiveSummary: sTotal === 0 ? SHIPPING.zeroExec : SHIPPING.exec(shipCtx),
      situation: sTotal === 0 ? SHIPPING.zeroSituation : SHIPPING.situation(shipCtx),
      whatHappened: sTotal === 0 ? SHIPPING.zeroWhatHappened : SHIPPING.whatHappened(shipCtx),
      // These four come straight from the dataset's auto-prose so the seeded
      // form text is byte-identical to what the preview/PDF fall back to.
      whatMatters: ds.autoWhatMatters,
      implications: ds.autoImplications,
      watchNext: ds.autoWatchNext,
      polestarView: ds.autoPolestarView,
    };
  }
  // Flashpoint / protests reports share a single usable-incident selector
  // with the report dataset (merged flashpoint+protests buckets, with
  // kinetic / court / crime / novelty / weak-operational noise removed).
  // Using it here guarantees the seeded prose's "quiet vs populated"
  // decision — and the lead country it names — can never contradict the
  // Fast Facts count or the Related Incidents table the report renders.
  const isFlashpoint = topic === "flashpoint" || topic === "protests";
  let inWindow: DraftableIncident[];
  if (isFlashpoint) {
    inWindow = selectFlashpointUsable(
      incidents as unknown as Parameters<typeof selectFlashpointUsable>[0],
      topic,
      issueDate,
    ).enriched as unknown as DraftableIncident[];
  } else {
    const rawWindow = filterIncidentsToWindow(incidents, topic, issueDate, { byTopic: true });
    inWindow = rawWindow.filter((i) =>
      isTopicRelevant(topic, {
        topic: i.topic,
        title: i.title ?? "",
        summary: i.summary ?? null,
        source: i.source ?? null,
        sourceUrl: null,
        location: null,
      }),
    );
  }
  const pack = packFor(topic);
  const total = inWindow.length;
  const ctx: BuildCtx = {
    total,
    countries: topCountriesPlain(inWindow),
    lead: leadCountry(inWindow),
    types: topTypesText(inWindow),
    sev: highestSeverity(inWindow),
    period: periodPhrase(topic, issueDate),
    cadence: cadenceWord(topic),
    thin: total > 0 && total < 3,
  };

  const executiveSummary = total === 0 ? pack.zeroExec : pack.exec(ctx);

  const polestarView = total === 0 ? pack.zeroPolestar : pack.polestarView(ctx);

  return {
    executiveSummary,
    situation: total === 0 ? pack.zeroSituation : pack.situation(ctx),
    whatHappened: total === 0 ? pack.zeroWhatHappened : pack.whatHappened(ctx),
    whatMatters: total === 0 ? pack.zeroWhatMatters : pack.whatMatters(ctx),
    implications: pack.implications(ctx),
    watchNext: pack.watchNext(ctx),
    polestarView,
  };
}

// ---------------------------------------------------------------------------
// Country report draft (rolling 7-day weekly headline window applied)
// ---------------------------------------------------------------------------

export function draftCountryReportProse(opts: {
  countryName: string;
  region: string;
  incidents: DraftableIncident[];
  issueDate?: string;
  // Pre-resolved active-window incidents (already window + relevance filtered).
  // When supplied, the prose reads against the same active window as the rest
  // of the report instead of re-filtering.
  windowIncidents?: DraftableIncident[];
  // Active reporting basis (7 / 30 / 90). Country reports are a weekly brief and
  // lead with 7; this drives the window labels in the prose.
  basisDays?: number;
}): CountryReportProse {
  const name = opts.countryName || "this country";
  const region = opts.region || "the region";
  const issueDate = opts.issueDate ?? new Date().toISOString().slice(0, 10);
  // Country reports lead with the rolling 7-day weekly window; callers supply a
  // pre-resolved active window so prose, Fast Facts, map and table all read
  // against one window. The filter fallback below is a defensive default only.
  const inWindow = opts.windowIncidents ??
    filterIncidentsToWindow(opts.incidents, "country", issueDate).filter((i) =>
      isCountryRelevant({
        topic: i.topic,
        title: i.title ?? "",
        summary: i.summary ?? null,
        source: i.source ?? null,
      }),
    );
  const total = inWindow.length;

  // Reporting period in plain reader-facing words. Country reports lead with
  // the rolling weekly window (basisDays defaults to 7); the toggle can widen
  // it to a month or quarter.
  const basisDays = opts.basisDays ?? 7;
  const periodWord = basisDays === 30 ? "this past month" : basisDays === 90 ? "this past quarter" : "this week";
  const types = topTypesText(inWindow);
  const sev = highestSeverity(inWindow);

  // Pick the leading area for a "geographical signal" sentence (uses the
  // first location token, properly cased; "Unknown" excluded).
  const areaCounts = new Map<string, number>();
  for (const i of inWindow) {
    const loc = (i.location ?? "").trim();
    if (!loc || /^unknown$/i.test(loc)) continue;
    const first = loc.split(/[;,/]/)[0].trim();
    if (!first) continue;
    const cased = first
      .split(/(\s+|-)/)
      .map((t) => {
        if (!t || /^\s+$/.test(t) || t === "-") return t;
        if (t.length >= 2 && t === t.toUpperCase() && /^[A-Z]+$/.test(t)) return t;
        return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
      })
      .join("");
    areaCounts.set(cased, (areaCounts.get(cased) ?? 0) + 1);
  }
  const sortedAreas = Array.from(areaCounts.entries()).sort((a, b) => b[1] - a[1]);
  const leadArea = sortedAreas[0]?.[0] ?? "";
  const secondArea = sortedAreas[1]?.[0] ?? "";
  const areaSentence = leadArea
    ? secondArea
      ? `Most of it was in and around ${leadArea} and ${secondArea}.`
      : `Most of it was in and around ${leadArea}.`
    : "";

  // Situation — what the country is like to operate in, in plain terms.
  const overview = total === 0
    ? `${name} sits in ${region}. Little came through in open reporting ${periodWord}. On its own that says little, so treat the country's usual risks as unchanged until fresh activity appears.`
    : `${name} sits in ${region}. The picture ${periodWord} is shaped by ${types || "a mix of security and public-order events"}.${areaSentence ? ` ${areaSentence}` : ""}`;

  // What Happened — what actually occurred, told for a reader.
  const trendSummary = total === 0
    ? `Nothing of note reached open reporting ${periodWord}. The picture from recent weeks still stands.`
    : total < 4
      ? `Reporting was light ${periodWord}. ${types ? `What did come through pointed to ${types}` : "What did come through was a mixed picture"}${leadArea ? ` around ${leadArea}` : ""}.${sev ? ` The most serious reached ${sev}.` : ""} It is too little to call a firm trend, but worth noting.`
      : `Activity ran at a normal level ${periodWord}, led by ${types || "a broad mix of events"}.${sev ? ` The most serious reached ${sev}.` : ""}`;

  // What Matters — why a reader should care and where to focus.
  const whatMatters = total === 0
    ? "A quiet week is not the same as a safe one. Keep existing security and travel measures in place rather than easing them on the strength of one calm period."
    : total < 4
      ? `Even a handful of incidents helps focus attention in ${name}. Use the locations named above to guide where to tighten movement, site access and security checks, while accepting the wider picture needs more reporting to firm up.`
      : `The pattern is clear enough to act on.${areaSentence ? ` ${areaSentence}` : ""} Prioritise journey planning, site-access checks and pre-movement coordination in the affected areas before making wider changes.`;

  // Implications for Business — plain actions.
  const implications = total === 0
    ? "Keep current controls on staff movement, site access and journey planning in place. Review them as soon as new activity appears."
    : `Keep journey planning tight on routes through the affected areas, keep site-access controls under review and update staff briefings on the types of incident now occurring. Confirm escalation contacts with the in-country lead before locking any movement plan.`;

  // Watch Next — concrete, no "Watch for..." opener.
  const watchNext = total === 0
    ? "Watch whether activity picks up again next week. A second quiet week would start to look like a genuine lull rather than a gap in coverage."
    : `Watch whether activity around ${leadArea || name} settles down or builds. Next week's reporting will show whether to tighten posture or hold.`;

  // Polestar View — the bottom-line judgement, in a reader's words.
  const polestarView = total === 0
    ? `${name} looks quiet for now, but the lack of reporting is the thing to question, not to trust. Keep a cautious posture until the picture fills in.`
    : `${name} warrants steady monitoring, with a sharper briefing for staff and contractors moving through the affected areas. Tighten posture only if next week escalates.`;

  // -------------------------------------------------------------------------
  // Country-specific editorial overrides
  // -------------------------------------------------------------------------
  // Some countries have a distinctive operating signature where the generic
  // wording reads as a placeholder. For those countries we replace the
  // weakest sections (Implications / Watch Next / Polestar View) with text
  // that names the standing risk pattern. Keep this list short and only
  // override when generic wording would mislead the reader.
  const isPNG = /\bpapua new guinea\b/i.test(name) || /^png$/i.test(name);

  if (isPNG) {
    const png = {
      executiveSummary: total === 0
        ? `Papua New Guinea is a demanding place to operate, and open reporting is patchy from week to week. Nothing of note surfaced ${periodWord} — read that as a gap in coverage, not a safe week. Urban violent crime in Port Moresby and Lae, road security, instability in the Highlands and exposure around resource sites remain the main risks for any operation.`
        : `Papua New Guinea is a demanding place to operate, and open reporting is patchy from week to week. Activity ${periodWord} points to ${types || "urban violent crime"} in or around Port Moresby and Lae. The wider picture holds: urban violent crime sets the day-to-day tempo, with road security, Highlands instability and exposure around resource sites in the background.`,

      overview: total === 0
        ? `Day to day, Papua New Guinea is shaped by opportunistic urban crime in Port Moresby and Lae, inter-clan violence in the Highlands, recurring disputes around resource projects, and very limited roads and infrastructure away from the main centres. Nothing notable came through in open reporting ${periodWord}, which in PNG is common and reflects thin coverage rather than calm. The risks above still set the operating picture.`
        : `Day to day, Papua New Guinea is shaped by opportunistic urban crime in Port Moresby and Lae, inter-clan violence in the Highlands, recurring disputes around resource projects, and very limited roads and infrastructure away from the main centres. The activity ${periodWord} centred on ${types || "urban crime"}${leadArea ? ` around ${leadArea}` : ""}, which is where attention should sit now.`,

      trendSummary: total === 0
        ? `Nothing of note reached open reporting ${periodWord}. Recent months have featured election-related unrest, occasional fuel and port disruption, and incidents along the Madang–Lae corridor; treat these as the standing pattern rather than current events.`
        : `Reporting ${periodWord} points to ${types || "urban violent-crime activity"} in or around Port Moresby and Lae. Longer-running issues — election-related unrest, fuel or port disruption, Highlands Highway incidents and Madang–Lae corridor events — are part of the background pattern rather than this week's news.`,

      implications: [
        "- Review movement plans for Port Moresby and Lae and refresh pre-movement briefings on the current incident types.",
        "- Avoid predictable travel patterns around cash-handling sites, ATMs and end-of-shift cash runs.",
        "- Check local security support is in place for any commercial site visit, including arrival and departure windows.",
        "- Confirm journey planning for staff and contractors, with a named on-call contact and a clear escalation path.",
        "- Review road travel assumptions outside the main urban areas; fly rather than drive where Highlands Highway travel is involved.",
        "- Keep routing flexible and allow for delay; closures and protests can happen at short notice.",
        "- Confirm medical and evacuation arrangements for remote work, including the Cairns, Brisbane or Singapore evacuation route.",
      ].join("\n"),

      watchNext: [
        "- Repeat armed-robbery or violent-crime activity in Port Moresby or Lae.",
        "- Copycat or clustered activity around commercial premises, banks and cash-handling sites.",
        "- Police response, arrests or any visible change in police posture in the affected districts.",
        "- Disruption to movement near markets, main roads or cash-handling points in the two cities.",
        "- Any shift from opportunistic urban crime to incidents on the main roads and corridors.",
        "- Worsening conditions on the Highlands Highway or Lae corridor — ambush, landslide, tribal-fight closure or strike action.",
        "- Fuel, port or road disruption building up that could spill into the cities.",
      ].join("\n"),

      polestarView: total === 0
        ? `Papua New Guinea should be treated as a demanding operating environment, and a quiet week does not mean low risk. The lasting concerns — urban violent crime in Port Moresby and Lae, road security, Highlands instability and resource-site exposure — still apply. For business travel, the priorities are disciplined movement, reliable local security support, and clear escalation triggers for any staff or contractor travel.`
        : `Papua New Guinea should be treated as a demanding operating environment, and a quiet week does not mean low risk. The activity ${periodWord} points to urban violent crime in Port Moresby and Lae, while road security, Highlands instability and resource-site exposure stay in view. For business travel, the priorities are disciplined movement, reliable local security support, and clear escalation triggers for any staff or contractor travel.`,
    };

    return {
      executiveSummary: png.executiveSummary,
      whatMatters,
      watchNext: png.watchNext,
      polestarView: png.polestarView,
      overview: png.overview,
      trendSummary: png.trendSummary,
      implications: png.implications,
    };
  }

  // Indonesian Papua / West Papua — distinct from PNG above (which returns
  // early). This is the Indonesian-administered western half of New Guinea
  // (six provinces), NOT Papua New Guinea. Like PNG it is a low-volume,
  // restricted-reporting environment where foreign press/NGO access is
  // tightly controlled, so a thin or empty week is the norm — which is why the
  // report leads with the rolling 7-day weekly window. Name the standing
  // operating signature and lean explicitly on the weekly headline and the
  // 30 / 90-day context sections rather than inventing bland country prose.
  const isPapua = /\bpapua\b/i.test(name);
  if (isPapua) {
    const papua = {
      executiveSummary: total === 0
        ? `${name} (Indonesian West Papua) is a difficult, tightly controlled place to operate, and open reporting comes and goes. Nothing of note surfaced ${periodWord} — with foreign press and NGO access restricted, read that as limited coverage rather than calm. Student and church-led protest, security operations in the highlands and armed-group activity around the Freeport mining corridor remain the main risks.`
        : `${name} (Indonesian West Papua) is a difficult, tightly controlled place to operate, and open reporting comes and goes. Activity ${periodWord} points to ${types || "protest and security-operation activity"}${leadArea ? ` around ${leadArea}` : ""}. The wider picture holds: highland insurgency and army and police operations set the tempo, with protest in the coastal cities and exposure around the Freeport and Tangguh corridors in the background.`,

      overview: total === 0
        ? `${name} is shaped by a long-running low-level insurgency, regular student and church-led protest over Jakarta's security and resource policy, a heavy army and police presence across the highlands, and severe geographic isolation. Nothing notable came through ${periodWord}, which reflects restricted reporting access rather than a calm picture. The risks above still set the operating picture.`
        : `${name} is shaped by a long-running low-level insurgency, regular student and church-led protest over Jakarta's security and resource policy, a heavy army and police presence across the highlands, and severe geographic isolation. The activity ${periodWord} centred on ${types || "protest and security-operation activity"}${leadArea ? ` around ${leadArea}` : ""}, which is where attention should sit now.`,

      trendSummary: total === 0
        ? `Nothing of note reached open reporting ${periodWord}. Recent months have seen protest around the Jayapura and Manokwari campuses and on key anniversary dates, security operations and armed-group clashes in the highlands, and friction along the Timika–Tembagapura (Freeport) and Bintuni (Tangguh LNG) corridors; treat these as the standing pattern rather than current events.`
        : `Reporting ${periodWord} points to ${types || "protest and security-operation activity"} in or around ${leadArea || "the named areas"}. Longer-running issues — student protest cycles, highland clashes and armed-group activity, Freeport convoy security and cross-border movement on the PNG frontier — are part of the background pattern rather than this week's news.`,

      implications: [
        "- Confirm Surat Jalan travel-permit status before any movement into the highlands; access can be withdrawn at short notice during security operations.",
        "- Plan highland and interior travel by air via Sentani, Timika, Wamena, Manokwari or Sorong; treat road travel on the Trans-Papua corridor as weather- and security-dependent.",
        "- Tighten journey planning around the Jayapura and Manokwari campuses and government sites on anniversary dates (1 May, 1 December, 19 December) and during student protest cycles.",
        "- For resource-sector sites, confirm convoy security and coordination with army, police and contracted security on the Timika–Tembagapura (Freeport) and Bintuni Bay (Tangguh LNG) corridors.",
        "- Allow for internet shutdowns and cellular blackspots; carry HF/VHF or satellite communications for highland and interior work.",
        "- Confirm out-of-province medical-evacuation arrangements (Makassar, Jakarta or Singapore); in-province specialist care is not available and highland evacuation is weather-dependent.",
        "- Treat thin weekly reporting as restricted access, not low risk; cross-check local-language and church or NGO sources before easing posture.",
      ].join("\n"),

      watchNext: [
        "- Renewed student or church-led protest out of Jayapura, Manokwari or Sorong, especially around anniversary dates.",
        "- Army or police security operations, or armed-group (TPNPB-OPM) clashes in Nduga, Intan Jaya, Puncak, Puncak Jaya or Yahukimo.",
        "- Armed-group activity or convoy incidents on the Timika–Tembagapura (Freeport Grasberg) corridor.",
        "- Labour or indigenous-rights friction around the Tangguh LNG / Bintuni Bay belt and South Papua plantation concessions.",
        "- Highland access disruption — landslide closures on the Trans-Papua corridor, weather-grounded airstrips or operation-driven district lockdowns.",
        "- Internet or communications shutdowns imposed in response to unrest.",
        "- Cross-border movement or refugee flows on the Keerom, Pegunungan Bintang or Boven Digoel frontier with Papua New Guinea.",
      ].join("\n"),

      polestarView: total === 0
        ? `${name} should be treated as a difficult, tightly controlled operating environment where a quiet week reflects limited access, not low risk. The lasting concerns — highland insurgency and security operations, protest in the coastal cities, and exposure around the Freeport and Tangguh corridors — still apply. For business travel, the priorities are travel-permit and movement discipline, flying rather than driving into the highlands, reliable communications and clear medical-evacuation plans.`
        : `${name} should be treated as a difficult, tightly controlled operating environment, and a quiet week does not mean low risk. Activity ${periodWord} points to ${types || "protest and security-operation activity"}, while highland insurgency, protest cycles and corridor exposure stay in view. For business travel, the priorities are travel-permit and movement discipline, flying rather than driving into the highlands, reliable communications and clear medical-evacuation plans.`,
    };

    return {
      executiveSummary: papua.executiveSummary,
      whatMatters,
      watchNext: papua.watchNext,
      polestarView: papua.polestarView,
      overview: papua.overview,
      trendSummary: papua.trendSummary,
      implications: papua.implications,
    };
  }

  return {
    executiveSummary: total === 0
      ? `Little came through in open reporting on ${name} ${periodWord}. That is more likely a gap in coverage than genuine calm, so the country's usual risks still apply. The brief below sets out the operating picture and what to keep watching.`
      : `Activity in ${name} ${periodWord} centred on ${types || "a mix of security and public-order events"}.${areaSentence ? ` ${areaSentence}` : ""}${sev ? ` The most serious reached ${sev}.` : ""} The brief below covers what happened, why it matters and what to watch next.`,
    whatMatters,
    watchNext,
    polestarView,
    overview,
    trendSummary,
    implications,
  };
}
