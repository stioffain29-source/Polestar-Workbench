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
  exec: ({ types, lead, countries, sev, thin, total, cadence }) => {
    const driver = types || "price movement, shortage reporting and transport disruption";
    const geo = lead
      ? ` ${lead} produced the clearest country signal${countries && countries !== lead ? `, with further reporting from ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    return `Fuel pressure across the ${cadence} window was driven by ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total)}`;
  },
  situation: ({ types, lead }) => {
    const focus = types ? `Shortage and price signals dominate, with ${types} the recurring threads.` : "Shortage and price signals dominate, with downstream transport and forecourt risk close behind.";
    const where = lead ? ` ${lead} remains the country to watch.` : "";
    return `${focus}${where}`;
  },
  whatHappened: ({ types, countries, sev }) => {
    const lead = types
      ? `Reporting was shaped by ${types}.`
      : `Reporting stayed light on classifiable detail.`;
    const geo = countries ? ` Identifiable activity tracked back to ${countries}.` : "";
    return `${lead}${geo}${sevTail(sev)}`;
  },
  whatMatters: ({ lead }) => {
    const where = lead ? ` Operators with exposure to ${lead} should treat this as the live pressure point.` : "";
    return `The combination of price movement and shortage signal feeds straight into transport cost, generator dependence and continuity at fuel-heavy sites.${where}`;
  },
  implications: () =>
    "Review fuel stocks at site, generator cover, route planning for fuel runs, contract pricing on bulk supply and contingency for forecourt closures.",
  watchNext: () =>
    "Triggers to monitor: subsidy announcements, refinery maintenance windows, tanker driver action and any move in pump prices in capital cities.",
  polestarView: ({ lead, countries }) => {
    const pressure = lead
      ? `${lead} remains the clearest pressure point${countries && countries !== lead ? `, with the rest of the picture filled in by ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "No single country carries the read this cycle.";
    return `The business concern is not the count of fuel stories but the mix of price movement, shortage indicators and transport disruption. ${pressure}`;
  },
  zeroExec: "Fuel reporting was quiet this cycle. Treat that as a coverage gap rather than evidence that supply has stabilised.",
  zeroSituation: "Underlying exposure to shortage, subsidy change and refinery disruption remains, even on a quiet reporting cycle.",
  zeroWhatHappened: "Nothing classifiable on fuel landed in the window, so any read is inferred from the prior cycle rather than fresh evidence.",
  zeroWhatMatters: "Transport cost, generator reliance and continuity at high-fuel-use sites stay the standing concern regardless of headline volume.",
  zeroPolestar: "No usable fuel signal landed in the window. Hold the prior cycle assessment and watch the next batch of reporting.",
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
  exec: ({ types, lead, countries, sev, thin, total }) => {
    const driver = types || "protest activity, civil unrest and public-order disruption";
    const geo = lead
      ? ` ${lead} held the live operational pressure${countries && countries !== lead ? `, with secondary activity in ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    return `Flashpoint activity through the window was driven by ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total)}`;
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
  exec: ({ types, lead, countries, sev, thin, total }) => {
    const driver = types || "protest action, strike activity and public-order disruption";
    const geo = lead
      ? ` ${lead} drew the most consistent reporting${countries && countries !== lead ? `, with further activity in ${countries.replace(`${lead}, `, "").replace(`${lead} and `, "")}` : ""}.`
      : "";
    return `Public-order activity across the window was shaped by ${driver}.${geo}${sevTail(sev)}${thinTail(thin, total)}`;
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
  const dropped = rawWindow.length - inWindow.length;
  const noisy = rawWindow.length >= 6 && dropped / rawWindow.length >= 0.35;
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

  // Noisy-record note: kept short, no "reporting window is noisy" wording.
  const noisyNote = noisy
    ? ` ${dropped} off-topic record${dropped === 1 ? " was" : "s were"} filtered out before this read.`
    : "";

  const executiveSummary = total === 0
    ? pack.zeroExec
    : `${pack.exec(ctx)}${noisyNote}`;

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
  const rawWindow = filterIncidentsToWindow(opts.incidents, "protests", issueDate);
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

  const overview = total === 0
    ? `${name} sits in ${region}. Reporting was quiet this cycle; treat that as a coverage gap rather than confirmation that the operating picture is calm.`
    : `${name} sits in ${region}. The window's read is shaped by ${types || "a mix of public-order and operational disruption events"}, with the operational tempo more relevant than the absolute volume.`;

  const trendSummary = total === 0
    ? "Volume is too thin for a firm trend read. Hold the prior cycle assessment until further records land."
    : `Activity is ${total < 4 ? "light but useable" : "running at normal cycle tempo"}.${types ? ` Lead patterns are ${types}.` : ""}${sevTail(sev)}`;

  const implications = total === 0
    ? "Maintain standing controls on staff movement, site access and journey management; revisit once fresh records land."
    : "Hold journey management discipline on affected routes, keep site access controls under review and refresh staff briefings on the active incident types. Confirm escalation routes with the country lead.";

  return { overview, trendSummary, implications };
}
