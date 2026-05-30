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

import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { classifyIncidentType, type ClassifiableIncident } from "./incidentClassifier";
import { isTopicRelevant, isCountryRelevant } from "./topicRelevance";

export interface DraftableIncident extends ClassifiableIncident {
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
  return topic === "cargo_watch" ? "monthly" : "weekly";
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
  return sev ? ` Severity peaked at ${sev}.` : "";
}

function thinTail(thin: boolean, total: number): string {
  if (!thin || total === 0) return "";
  return " Volume is light, so the read is directional rather than firm.";
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
      ? ` ${lead} produced the clearest country signal${countries && countries !== lead ? `, with further reporting from ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    const para1 = `Fuel risk this ${cadence} cycle reads as a cost-and-continuity issue rather than a single dramatic event. Pressure across the window was driven by ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total)}`;
    const para2 = `Cost indicators are holding above easy-budget levels, and the incident picture adds operational stress — shortages, forecourt disruption, subsidy moves and route pressure where they appear — rather than relief.`;
    const para3 = `For business users, the headline is straightforward: protect fuel-dependent operations from short-notice price or availability shocks. That means live attention to fuel stock cover, generator runtime, road transport exposure and supplier resilience while this picture holds.`;
    return `${para1}\n\n${para2}\n\n${para3}`;
  },
  // Situation: short — current operating picture, why the cycle
  // matters. No section cross-references, no meta-report wording.
  situation: ({ lead }) => {
    const where = lead ? ` ${lead} is the country carrying the most weight.` : "";
    return `Fuel cost is holding above easy-budget levels while availability and policy pressure remain live downstream. The cycle matters because the cost shock and the access shock are arriving together, which is when contract economics and operational continuity stop being separate problems.${where}`;
  },
  // What Happened: short — what changed or was reported. No
  // cross-references to Market Read / Operational Read, no "table
  // below" language.
  whatHappened: ({ types, countries, sev, lead }) => {
    if (!types) {
      return `Classifiable fuel reporting was light this cycle, with no single pattern dominating the window.${sevTail(sev)}`;
    }
    const secondaries = countries && countries !== lead
      ? countries.replace(`${lead}, `, "").replace(`${lead} and `, "")
      : "";
    const geo = lead
      ? ` concentrated on ${lead}${secondaries ? `, with secondary reporting from ${secondaries}` : ""}`
      : "";
    return `Reporting this cycle was led by ${types}${geo}.${sevTail(sev)}`;
  },
  // What Matters: two analytical paragraphs connecting prices, jet movement,
  // shortage / route pressure and business continuity.
  whatMatters: ({ lead }) => {
    const where = lead ? ` Exposure to ${lead} is the live pressure point for fleet, generator and field operations.` : "";
    const para1 = `Elevated crude and a jet fuel series that is not retreating tell the cost side of the story: fuel-linked invoices stay heavy. The incident layer then tells the availability side: shortages, rationing and route pressure are the points where price stops being the only problem and physical access becomes the issue.${where}`;
    const para2 = `Where the two reinforce each other — high prices meeting tight supply or chokepoint disruption — the operational impact compounds. Freight rates lift, surcharge clauses fire, generator runtime decisions get made on tighter stocks, and supplier conversations turn into renegotiations rather than confirmations. That is the picture worth planning against this cycle.`;
    return `${para1}\n\n${para2}`;
  },
  // Implications for Business: practical and client-useful, explaining why
  // each action matters rather than listing a generic checklist.
  implications: () => {
    const para1 = `On the cost side, revisit contract pricing on bulk fuel and any surcharge pass-through clauses in freight and logistics agreements — elevated indicators usually mean the next invoice cycle reflects this, not the current one. Forward-cover the bulk and aviation lines you depend on rather than waiting for the spot move to be confirmed.`;
    const para2 = `On the continuity side, check fuel stock at site, generator runtime assumptions and the fuel routes you rely on for resupply. Rationing reports and forecourt disruption should pull commercial-allocation conversations forward with suppliers, and escalation triggers (queues, allocation cuts, station closures) should be agreed in advance so they fire automatically rather than after the fact. Where Gulf or Red Sea routing matters, treat route diversification as a live mitigation, not a future option.`;
    return `${para1}\n\n${para2}`;
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
      : " No single country carries the read this cycle.";
    return `Fuel Watch is flagging a cost-and-continuity risk this cycle, not simply a rise in fuel headlines. The market indicators show elevated fuel costs holding rather than easing, while the incident picture shows operational stress around shortages, route pressure and policy intervention. For business users, the priority is to protect movement, backup power and fuel-dependent operations from short-notice price or availability shocks.${pressure}`;
  },
  zeroExec: "Fuel reporting was quiet this cycle. Treat that as a coverage gap rather than evidence that supply has stabilised. The market indicators in the Fast Facts and Jet Fuel Price Trajectory still carry the cost-side read; the incident layer simply has less to say this window. For business users, the standing exposures — fuel stock cover, generator runtime, road transport exposure and supplier resilience — remain the operational focus until fresh reporting lands.",
  zeroSituation: "Underlying exposure to shortage, subsidy change and refinery disruption remains, even on a quiet reporting cycle.",
  zeroWhatHappened: "Nothing classifiable on fuel landed in the window, so any read is inferred from the prior cycle rather than fresh evidence.",
  zeroWhatMatters: "Transport cost, generator reliance and continuity at high-fuel-use sites stay the standing concern regardless of headline volume. With no fresh incident reporting this cycle, the market indicators above carry the read on their own; treat them as the cost floor for any forward planning.",
  zeroPolestar: "No usable fuel signal landed in the incident window this cycle, so the read leans on the market indicators above. Hold the prior cycle assessment, keep standing fuel-resilience measures live, and revisit the picture once the next batch of reporting arrives.",
  thinNote: "Fuel reporting in this window is thin. Treat as a coverage gap, not as evidence that supply has stabilised.",
};

// ---------------------------------------------------------------------------
// Fertiliser Watch
// ---------------------------------------------------------------------------
const FERTILISER: ReportPack = {
  exec: ({ types, lead, countries, sev, thin, total }) => {
    const driver = types || "pricing, export controls and production disruption";
    const geo = lead
      ? ` ${lead} carried the strongest country signal${countries && countries !== lead ? `, supported by ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    return `Fertiliser pressure was led by ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total)}`;
  },
  situation: ({ types }) => {
    const focus = types ? `Supply, price and export decisions stay front of mind, currently expressed through ${types}.` : "Supply, price and export decisions stay front of mind, with farmer access and planting timing the operational concern.";
    return `${focus} The chain runs from input price into farm output and onward food cost.`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `Activity centred on ${types}.` : `Activity was light, with little classifiable detail.`;
    const geo = countries ? ` Reporting clustered around ${countries}.` : "";
    return `${lead}${geo}${sevTail(sev)}`;
  },
  whatMatters: ({ lead }) => {
    const where = lead ? ` Exposure to ${lead} matters most for forward stock cover and supplier conversations.` : "";
    return `Movement in fertiliser pricing and supply rolls forward into planting decisions, farm input cost and the wider food security read.${where}`;
  },
  implications: () =>
    "Walk through supplier diversification, forward stock cover, exposure to single-source urea and potash, and contingency for export-ban announcements.",
  watchNext: () =>
    "Keep eyes on export restrictions, plant maintenance and outage announcements, farmer protest activity and any government subsidy moves.",
  polestarView: ({ lead }) => {
    const tail = lead ? ` ${lead} is the country to watch when planning forward cover.` : "";
    return `The standing concern is supply continuity rather than the volume of headlines.${tail}`;
  },
  zeroExec: "Fertiliser reporting was quiet this cycle. Treat that as a coverage gap rather than proof of market calm.",
  zeroSituation: "Supply, price and export decisions remain the operating concern even when headline volume is light.",
  zeroWhatHappened: "Few classifiable fertiliser items landed, so the picture rests on the prior cycle rather than fresh reporting.",
  zeroWhatMatters: "Farm input cost, planting decisions and downstream food price pressure stay live exposures whatever the window count.",
  zeroPolestar: "No usable fertiliser signal landed in the window. Hold the prior cycle assessment until fresh records arrive.",
  thinNote: "Fertiliser reporting in this window is thin. Treat as a coverage gap, not as proof of supply stability.",
};

// ---------------------------------------------------------------------------
// Cargo Watch
// ---------------------------------------------------------------------------
const CARGO: ReportPack = {
  exec: ({ types, lead, countries, sev, thin, total }) => {
    const driver = types || "theft, pilferage and warehouse loss";
    const geo = lead
      ? ` ${lead} carried the most consistent reporting${countries && countries !== lead ? `, alongside ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    return `Cargo loss across the window was shaped by ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total)}`;
  },
  situation: ({ types, lead }) => {
    const focus = types ? `Warehouse, depot and road corridors hold the live exposure, currently visible in ${types}.` : "Warehouse, depot and road corridors hold the live exposure, with route knowledge and insider risk as the persistent drivers.";
    const where = lead ? ` ${lead} sits at the centre of the recurring geography.` : "";
    return `${focus}${where}`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `The dominant patterns were ${types}.` : `Few classifiable cargo events surfaced.`;
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
  zeroExec: "Cargo reporting was quiet this cycle. Treat that as a coverage gap, not proof that the problem is absent.",
  zeroSituation: "Warehouse, depot and road-corridor exposure persists regardless of how quiet the reporting window looks.",
  zeroWhatHappened: "Few classifiable cargo events surfaced, so the read defers to the prior cycle rather than this window.",
  zeroWhatMatters: "Insider knowledge and route familiarity continue to sit behind the larger losses whether or not new reporting lands.",
  zeroPolestar: "No usable cargo signal landed in the window. Hold the prior cycle assessment and revisit once fresh reporting arrives.",
  thinNote: "Cargo reporting in this window is thin. That should be treated as a coverage gap, not proof that the problem is absent.",
};

// ---------------------------------------------------------------------------
// Shipping Watch
// ---------------------------------------------------------------------------
const SHIPPING: ReportPack = {
  exec: ({ types, lead, countries, sev, thin, total }) => {
    const driver = types || "chokepoint exposure, vessel risk and freight-side pressure";
    const geo = lead
      ? ` ${lead} produced the strongest identifiable signal${countries && countries !== lead ? `, with lower volumes from ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : " Country attribution is sparse, with several records lacking a precise incident location.";
    return `Maritime reporting was centred on ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total)}`;
  },
  situation: ({ types }) => {
    const focus = types ? `Chokepoints and major ports remain the standing pressure points, currently expressed through ${types}.` : "Chokepoints and major ports remain the standing pressure points, with vessel and freight-side risk close behind.";
    return `${focus} Records without a precise incident location stay in totals but out of country charts.`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `Maritime activity was shaped by ${types}.` : `Maritime activity was light on classifiable detail.`;
    const geo = countries ? ` Identifiable reporting tracked back to ${countries}.` : "";
    return `${lead}${geo}${sevTail(sev)}`;
  },
  whatMatters: () =>
    "Pressure here feeds straight into transit time, freight cost and war-risk premium exposure across the wider region. A small shift on any one chokepoint usually shows up in the freight and insurance read soon after.",
  implications: () =>
    "Re-walk routing options around affected chokepoints, port-call sequencing, bunker planning and war-risk premium exposure. Confirm crew-change and advisory triggers with operators.",
  watchNext: () =>
    "Next cycle hinges on a handful of triggers: fresh port closures or strikes, naval movement near Hormuz, Bab-el-Mandeb or the Malacca approaches, new maritime advisories, and visible moves in war-risk premiums or freight indices.",
  polestarView: () =>
    "Chokepoint exposure remains the dominant operational concern, supported by freight and insurance pressure and a thinner layer of commercial disruption. Iran carries the strongest identifiable signal, with lower volumes linked to China and South Korea.",
  zeroExec: "Maritime reporting was quiet this cycle. Treat that as a coverage gap rather than proof of calm at sea.",
  zeroSituation: "Chokepoint, vessel and freight-side exposure persists even when the reporting cycle is light.",
  zeroWhatHappened: "No classifiable maritime activity surfaced, leaving the read directional rather than firm.",
  zeroWhatMatters: "Underlying pressure on transit time, freight cost and war-risk premium remains, regardless of window count.",
  zeroPolestar: "No usable maritime signal landed in the window. Standing exposure to chokepoint, vessel and freight risk remains.",
  thinNote: "Shipping reporting in this window is thin. Treat as a coverage gap, not proof that disruption has eased.",
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
      : "no single country carries the read this cycle";
    const sevClause = sev
      ? ` Worst-case reporting reached the ${sev.toLowerCase()} tier, so the cycle cannot be read as routine.`
      : "";
    const thinClause = thin && total > 0
      ? " Volume is light, so the read is directional rather than firm."
      : "";
    const para1 = `Flashpoint risk this cycle reads as an operational-tempo issue rather than a single headline event. The window was shaped by ${driver}, and ${geoLead}.${sevClause}${thinClause}`;
    const para2 = `What the incident layer adds is speed: these events move from notice to road closure, transport halt or site-access disruption inside a working day. The pattern is short-cycle escalation against a standing baseline, not isolated flare-ups.`;
    const para3 = `For business users the implication is straightforward: protect staff movement, site access and continuity comms against short-notice disruption on the named cities. Standing readiness — refreshed journey-management, agreed escalation triggers and live country-lead routing — does more work this cycle than headline-severity tracking.`;
    return `${para1}\n\n${para2}\n\n${para3}`;
  },
  situation: ({ types }) => {
    const focus = types ? `Short-cycle events on streets, transport hubs and central business districts shape the picture, with ${types} the visible drivers.` : "Short-cycle events on streets, transport hubs and central business districts shape the picture, with rapid escalation the standing risk.";
    return `${focus} Operational impact lands quickly when these surface.`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `Disruption centred on ${types}.` : `Few classifiable flashpoint events surfaced.`;
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
    return `The story this cycle is operational tempo rather than headline severity. Standing readiness on affected cities is what protects continuity.${tail}`;
  },
  zeroExec: "Flashpoint reporting was quiet this cycle. Treat that as a coverage gap, not proof that the streets are calm.",
  zeroSituation: "Short-cycle disruption risk on transport hubs and central business districts persists whether or not new reporting lands.",
  zeroWhatHappened: "No classifiable flashpoint events surfaced, so the operating read draws on prior-cycle exposure.",
  zeroWhatMatters: "Speed of escalation continues to set the operational concern; staff movement and site access stay the live points.",
  zeroPolestar: "No usable flashpoint signal landed in the window. Maintain standing readiness on previously affected cities.",
  thinNote: "Flashpoint reporting in this window is thin. Treat as a coverage gap, not as proof of calm.",
};

// ---------------------------------------------------------------------------
// Energy Watch
// ---------------------------------------------------------------------------
const ENERGY: ReportPack = {
  exec: ({ types, lead, countries, sev, thin, total }) => {
    const driver = types || "outage events, load shedding and generation shortfall";
    const geo = lead
      ? ` ${lead} carried the most visible grid strain${countries && countries !== lead ? `, alongside ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    return `Power and grid pressure through the window was led by ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total)}`;
  },
  situation: ({ types }) => {
    const focus = types ? `Capacity strain shows through ${types}, with fuel-to-power supply the underlying weakness.` : "Capacity strain remains the background condition, with fuel-to-power supply the underlying weakness.";
    return `${focus} Industrial continuity sits squarely in the firing line when outages run long.`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `Grid reporting was shaped by ${types}.` : `Grid reporting was thin on classifiable detail.`;
    const geo = countries ? ` Visible stress tracked back to ${countries}.` : "";
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
    const tail = lead ? ` ${lead} is where backup and continuity spend earn their keep this cycle.` : "";
    return `The grid story is one of standing fragility rather than a single dramatic event.${tail}`;
  },
  zeroExec: "Grid reporting was quiet this cycle. Treat that as a coverage gap rather than evidence that the grid is stable.",
  zeroSituation: "Capacity strain and fuel-to-power supply weakness remain the background condition whether or not new reporting lands.",
  zeroWhatHappened: "No classifiable grid stress surfaced, so the read carries forward from the prior cycle.",
  zeroWhatMatters: "Site uptime, generator load and continuity spend stay the operational concern on regional grids.",
  zeroPolestar: "No usable grid signal landed in the window. Underlying capacity gaps on most regional grids remain.",
  thinNote: "Energy reporting in this window is thin. Treat as a coverage gap, not as proof that the grid is stable.",
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
      : "no single country carries the read this cycle";
    const sevClause = sev
      ? ` Worst-case reporting reached the ${sev.toLowerCase()} tier, so the cycle cannot be read as routine.`
      : "";
    const thinClause = thin && total > 0
      ? " Volume is light, so the read is directional rather than firm."
      : "";
    const para1 = `Public-order risk this cycle reads as an operational-tempo issue rather than a single headline event. The window was shaped by ${driver}, and ${geoLead}.${sevClause}${thinClause}`;
    const para2 = `What the incident layer adds is speed: these events move from notice to road closure, transit halt or site-access disruption inside a working day. The pattern is short-cycle escalation against a standing baseline of unrest, not isolated flare-ups.`;
    const para3 = `For business users the implication is straightforward: protect staff movement, site access and continuity comms against short-notice disruption on the named cities. Refreshed journey-management plans, agreed escalation triggers and live country-lead routing do more work this cycle than headline-severity tracking.`;
    return `${para1}\n\n${para2}\n\n${para3}`;
  },
  situation: ({ types }) => {
    const focus = types ? `Most events touch transport, access and central business districts, with ${types} the active patterns.` : "Most events touch transport, access and central business districts, with rapid disruption the standing risk.";
    return `${focus}`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types ? `Reporting centred on ${types}.` : `Reporting carried little classifiable detail.`;
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
    return `Operational tempo, not headline severity, is the read this cycle.${tail}`;
  },
  zeroExec: "Public-order reporting was quiet this cycle. Treat that as a coverage gap rather than calm streets.",
  zeroSituation: "Standing risk to transport, access and central business districts persists whether or not new reporting lands.",
  zeroWhatHappened: "No classifiable public-order events surfaced, leaving the read carried forward from the prior cycle.",
  zeroWhatMatters: "Staff movement and site access remain the operational concern when these events do appear.",
  zeroPolestar: "No usable public-order signal landed in the window.",
  thinNote: "Public order reporting in this window is thin. Treat as a coverage gap, not as proof of calm.",
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
  const rawWindow = filterIncidentsToWindow(incidents, topic, issueDate, { byTopic: true });
  const inWindow = rawWindow.filter((i) =>
    isTopicRelevant(topic, {
      topic: i.topic,
      title: i.title ?? "",
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: null,
      location: null,
    }),
  );
  // Off-topic filter counts are internal Workbench bookkeeping and must
  // never surface to the client. The executive summary is a judgement
  // for the reader; "N off-topic records were filtered out before this
  // read" is meta-commentary about the build pipeline.
  void (rawWindow.length - inWindow.length);
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
// Country report draft (weekly window applied)
// ---------------------------------------------------------------------------

export function draftCountryReportProse(opts: {
  countryName: string;
  region: string;
  incidents: DraftableIncident[];
  issueDate?: string;
}): CountryReportProse {
  const name = opts.countryName || "this country";
  const region = opts.region || "the region";
  const issueDate = opts.issueDate ?? new Date().toISOString().slice(0, 10);
  // Use the country pseudo-topic window (7-day default, 10-day cap) — the
  // country builder must never depend on another topic's cadence.
  const rawWindow = filterIncidentsToWindow(opts.incidents, "country", issueDate);
  const inWindow = rawWindow.filter((i) =>
    isCountryRelevant({
      topic: i.topic,
      title: i.title ?? "",
      summary: i.summary ?? null,
      source: i.source ?? null,
    }),
  );
  const total = inWindow.length;
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
      ? `${leadArea} and ${secondArea} carry the clearest operational signal this cycle.`
      : `${leadArea} carries the clearest operational signal this cycle.`
    : "";

  // Situation — operating environment framing, not a count.
  const overview = total === 0
    ? `${name} sits in ${region}. Reporting was quiet across the weekly window; treat the silence as a coverage gap rather than a clean operating picture.`
    : `${name} sits in ${region}. The cycle's reporting is shaped by ${types || "a mix of operational and public-order events"}, and the tempo of activity matters more than the headline volume.${areaSentence ? ` ${areaSentence}` : ""}`;

  // What Happened — pattern read, no "Polestar holds..." opener.
  const trendSummary = total === 0
    ? "No fresh records landed in the weekly window. The prior cycle assessment stands until new reporting comes through."
    : total < 4
      ? `Reporting is light but workable. ${types ? `The activity that did land points to ${types}` : "The events on file point to a mixed operational picture"}, and a small sample limits how firmly any single pattern can be read.${sevTail(sev)}`
      : `Activity is running at normal cycle tempo. ${types ? `Lead patterns are ${types}.` : "The mix is broad enough that no single pattern dominates."}${sevTail(sev)}`;

  // What Matters — implications for visibility and source confidence; not
  // a metric restatement.
  const whatMatters = total === 0
    ? "The absence of records does not mean an absence of activity. Source coverage in this window was thin, so any forward read should treat the operating picture as unconfirmed rather than calm."
    : total < 4
      ? `Even a small record set sharpens the operating picture for ${name}. Treat the named locations as where to focus access, movement and security-coordination checks, while accepting that the broader pattern needs more reporting to firm up.`
      : `The pattern is broad enough to act on. ${areaSentence ? `${areaSentence} ` : ""}Use it to prioritise journey management, site-access checks and pre-movement coordination in the affected sub-regions before broader posture changes.`;

  // Implications for Business
  const implications = total === 0
    ? "Hold standing controls on staff movement, site access and journey management. Revisit posture as soon as fresh records land."
    : `Keep journey management discipline on routes touching the affected areas, hold site-access controls under active review and refresh staff briefings on the live incident types. Confirm escalation routes with the in-country lead before any movement plan is locked in.`;

  // Watch Next — concrete, no "Watch for..." opener.
  const watchNext = total === 0
    ? "Track whether reporting volume recovers next cycle. A second quiet window would shift this from coverage gap to a substantive read."
    : `Track whether the activity in ${leadArea || name} firms into a sustained pattern or fades back to baseline. The next cycle's reporting will decide whether posture needs to tighten or hold.`;

  // Polestar View — short analyst judgement, not a count.
  const polestarView = total === 0
    ? `${name} reads as quiet for now, but the absence of records is the read worth challenging. Keep posture conservative until reporting returns.`
    : `${name} warrants steady-state monitoring with a tighter brief for staff and contractors moving through the affected areas. Adjust posture if the next cycle escalates rather than easing.`;

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
    const currentSentence = total === 0
      ? "No fresh records landed in the 7-day window."
      : total === 1
        ? "The 7-day window holds one record."
        : `The 7-day window holds ${total} records.`;

    const png = {
      executiveSummary: total === 0
        ? `Papua New Guinea is a low-volume but high-friction operating environment. No relevant incidents were recorded in the 7-day window. Urban violent crime in Port Moresby and Lae, route security, Highlands instability and resource-sector exposure remain the standing operating risks; these are carried in the 30-day and 90-day context sections below as background pattern, not as fresh weekly activity. Reporting volume on PNG is genuinely thin most weeks, so a zero weekly count should be read as a coverage gap rather than calm.`
        : `Papua New Guinea is a low-volume but high-friction operating environment. ${currentSentence} The current-cycle reporting is dominated by urban violent-crime indicators out of Port Moresby and Lae, which is the practical concern for any staff or contractor footprint in the two main cities. The 30-day and 90-day context sections widen the lookback to keep route security, Highlands instability and resource-sector exposure in view; treat them as background risk rather than as live events. Reporting volume on PNG is genuinely thin most weeks, so the weekly count should not be read as a measure of risk.`,

      overview: total === 0
        ? `Papua New Guinea is shaped by urban opportunistic crime in Port Moresby and Lae, inter-clan violence in the highlands, recurring resource-sector disputes and severe interior infrastructure limits — these are the standing operating picture, not this week's events. No relevant incidents were recorded in the 7-day window; treat the silence as a reporting-coverage feature of PNG rather than a clean operating picture. The named risks above and anything older than seven days sit in the 30 / 90-day context sections below and should not be read as current activity.`
        : `Papua New Guinea is shaped by urban opportunistic crime in Port Moresby and Lae, inter-clan violence in the highlands, recurring resource-sector disputes and severe interior infrastructure limits. The current cycle's read is the 7-day window only. ${currentSentence} Treat these as the active operational signal. Anything older than seven days sits in the 30 / 90-day context sections below and should not be read as current activity.`,

      trendSummary: total === 0
        ? `Nothing fresh landed in the current 7-day window. The 30-day and 90-day context sections below carry the wider pattern — including any election-cycle unrest, fuel or port disruption, and Madang / Lae corridor incidents — but those are background, not current activity. Treat them as standing-risk reference, not as something that happened this week.`
        : `The current 7-day window points to ${types || "urban violent-crime activity"} in or around Port Moresby and Lae. That is the active signal. Anything beyond this week — including election-cycle unrest, fuel or port disruption, Highlands Highway incidents and Madang / Lae corridor events — sits in the 30 / 90-day context sections and should be read as background pattern rather than current activity.`,

      implications: [
        "- Review movement plans for Port Moresby and Lae and refresh pre-movement briefings on the current incident types.",
        "- Avoid predictable travel patterns around cash-handling sites, ATMs and end-of-shift cash runs.",
        "- Check local security support is in place for any commercial site visit, including arrival / departure windows.",
        "- Confirm journey management for staff and contractors, with a named on-call contact and a clear escalation path.",
        "- Review road movement assumptions outside the main urban areas; default to air where the Highlands Highway is in play.",
        "- Maintain flexible routing and a tolerance for delay; closures and protests can land at short notice.",
        "- Confirm medical and evacuation arrangements for remote work, including the Cairns / Brisbane / Singapore medevac chain.",
      ].join("\n"),

      watchNext: [
        "- Repeat armed-robbery or violent-crime activity in Port Moresby or Lae.",
        "- Copycat or cluster activity around commercial premises, banks and cash-handling sites.",
        "- Police response, arrests or any visible RPNGC posture change in the affected districts.",
        "- Movement disruption near markets, main roads or cash-handling points in the two cities.",
        "- Any shift from urban opportunistic crime to route or corridor incidents.",
        "- Highlands Highway or Lae corridor deterioration — ambush, landslide, tribal-fight closure or strike action.",
        "- Fuel, port or road disruption surfacing in the 30-day context that could spill into the current cycle.",
      ].join("\n"),

      polestarView: total === 0
        ? `PNG should be treated as a low-volume but high-friction operating environment. A quiet week does not equal low risk. No relevant incidents were recorded in the 7-day window; the standing concerns — urban violent crime in Port Moresby and Lae, route security, Highlands instability and resource-sector exposure — sit in the 30 / 90-day context as background pattern, not current activity. Business users should focus on movement discipline, local security support, and clear escalation triggers for any staff or contractor travel.`
        : `PNG should be treated as a low-volume but high-friction operating environment. A quiet week does not equal low risk. The current incidents point to urban violent crime in Port Moresby and Lae, while the 30 / 90-day context keeps route security, Highlands instability and resource-sector exposure in view. Business users should focus on movement discipline, local security support, and clear escalation triggers for any staff or contractor travel.`,
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
  // tightly controlled, so a thin or empty 7-day window is the norm and the
  // generic country template reads as a placeholder. Name the standing
  // operating signature and lean explicitly on the 30 / 90-day context
  // sections rather than inventing bland country prose.
  const isPapua = /\bpapua\b/i.test(name);
  if (isPapua) {
    const currentSentence = total === 0
      ? "No relevant incidents were recorded in the 7-day window."
      : total === 1
        ? "The 7-day window holds one record."
        : `The 7-day window holds ${total} records.`;

    const papua = {
      executiveSummary: total === 0
        ? `${name} (Indonesian West Papua) is a restricted-reporting, high-friction operating environment spanning the six provinces of the Indonesian half of New Guinea. ${currentSentence} That is normal for a region where foreign press and NGO access is tightly controlled — read it as a coverage gap, not a calm operating picture. The standing operational signature — student and church-led protest out of Jayapura and Manokwari, TNI/POLRI security operations in the central highlands, TPNPB-OPM armed-group activity around Nduga, Intan Jaya and the Freeport Grasberg corridor at Timika, and severe highland access constraints — is carried in the 30-day and 90-day context sections below as background pattern, not as fresh weekly activity.`
        : `${name} (Indonesian West Papua) is a restricted-reporting, high-friction operating environment spanning the six provinces of the Indonesian half of New Guinea. ${currentSentence} The current-cycle reporting points to ${types || "protest and security-operation activity"}, which is the practical concern for any footprint in the coastal cities or the resource corridors. The 30-day and 90-day context sections widen the lookback to keep highland insurgency, commemoration-date protest cycles and resource-sector exposure in view; treat them as background risk rather than live events. Reporting access in Papua is genuinely constrained, so the weekly count should not be read as a measure of risk.`,

      overview: total === 0
        ? `${name} is shaped by a long-running low-intensity insurgency, recurring student and church-led protest over Jakarta's security and resource policy, heavy TNI/POLRI deployment across the highlands, and extreme geographic isolation — these are the standing operating picture, not this week's events. ${currentSentence} Treat the silence as a feature of restricted reporting access rather than a clean operating picture. The named risks above and anything older than seven days sit in the 30 / 90-day context sections below and should not be read as current activity.`
        : `${name} is shaped by a long-running low-intensity insurgency, recurring student and church-led protest over Jakarta's security and resource policy, heavy TNI/POLRI deployment across the highlands, and extreme geographic isolation. The current cycle's read is the 7-day window only. ${currentSentence} Treat these as the active operational signal.${areaSentence ? ` ${areaSentence}` : ""} Anything older than seven days sits in the 30 / 90-day context sections below and should not be read as current activity.`,

      trendSummary: total === 0
        ? `Nothing fresh landed in the current 7-day window. The 30-day and 90-day context sections below carry the wider pattern — protest activity around Jayapura and Manokwari campuses and commemoration dates, highland security operations and TPNPB-OPM clashes, and resource-corridor friction around the Timika–Tembagapura (Freeport) and Bintuni (Tangguh LNG) belts — but those are background, not current activity. Treat them as standing-risk reference, not as something that happened this week.`
        : `The current 7-day window points to ${types || "protest and security-operation activity"} in or around ${leadArea || "the named areas"}. That is the active signal. Anything beyond this week — student protest cycles, highland clashes and TPNPB-OPM activity, Freeport convoy security and cross-border movement on the PNG frontier — sits in the 30 / 90-day context sections and should be read as background pattern rather than current activity.`,

      implications: [
        "- Confirm Surat Jalan / travel-permit status before any movement into the highlands; access can be withdrawn at short notice during security operations.",
        "- Plan highland and interior travel by air via Sentani, Timika, Wamena, Manokwari or Sorong; treat road movement on the Trans-Papua corridor as weather- and security-dependent.",
        "- Hold heightened journey management around Jayapura and Manokwari campuses and government sites on commemoration dates (1 May, 1 December, 19 December) and during student protest cycles.",
        "- For resource-sector footprints, confirm convoy security and TNI/POLRI and contracted-security coordination on the Timika–Tembagapura (Freeport) and Bintuni Bay (Tangguh LNG) corridors.",
        "- Build in tolerance for internet shutdowns and cellular blackspots; carry HF/VHF or satellite comms for highland and interior work.",
        "- Confirm out-of-province medevac arrangements (Makassar / Jakarta / Singapore); in-province tier-1 care is not available and highland evacuation is weather-dependent.",
        "- Treat thin weekly reporting as restricted access, not low risk; cross-check local-language and church / NGO sources before standing down posture.",
      ].join("\n"),

      watchNext: [
        "- Renewed student or church-led protest out of Jayapura, Manokwari or Sorong, especially around commemoration dates.",
        "- TNI/POLRI security operations or TPNPB-OPM clashes in Nduga, Intan Jaya, Puncak, Puncak Jaya or Yahukimo.",
        "- Armed-group activity or convoy incidents on the Timika–Tembagapura (Freeport Grasberg) corridor.",
        "- Labour or indigenous-rights friction around the Tangguh LNG / Bintuni Bay belt and South Papua plantation concessions.",
        "- Highland access disruption — landslide closures on the Trans-Papua corridor, weather-grounded airstrips or operation-driven district lockdowns.",
        "- Internet or communications shutdowns imposed in response to unrest.",
        "- Cross-border movement or refugee flows on the Keerom / Pegunungan Bintang / Boven Digoel frontier with Papua New Guinea.",
      ].join("\n"),

      polestarView: total === 0
        ? `${name} should be treated as a restricted-reporting, high-friction operating environment where a quiet week reflects access limits, not low risk. ${currentSentence} The standing concerns — highland insurgency and security operations, protest cycles in the coastal cities, and resource-corridor exposure at Freeport and Tangguh — sit in the 30 / 90-day context as background pattern, not current activity. Business users should focus on permit and movement discipline, air-first highland travel, resilient communications and clear out-of-province medevac triggers.`
        : `${name} should be treated as a restricted-reporting, high-friction operating environment. A quiet week does not equal low risk. The current incidents point to ${types || "protest and security-operation activity"}, while the 30 / 90-day context keeps highland insurgency, protest cycles and resource-corridor exposure in view. Business users should focus on permit and movement discipline, air-first highland travel, resilient communications and clear out-of-province medevac triggers.`,
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
      ? `${name} reporting is light across the weekly window. The page captures what is on file, but the gap itself is the most important read — coverage rather than calm.`
      : `${name} reporting for the weekly window is shaped by ${types || "a mix of operational events"}.${areaSentence ? ` ${areaSentence}` : ""} The brief below covers the operating picture, what changed, why it matters and what to watch next.`,
    whatMatters,
    watchNext,
    polestarView,
    overview,
    trendSummary,
    implications,
  };
}
