// Draft prose generator for every report builder.
//
// Goal: when a new report is opened, each narrative section is prefilled
// with short operational prose derived from the records in the report
// window. The user edits this prose; nothing is auto-saved.
//
// Voice rules (strict):
//   - plain spoken, direct, operational
//   - normal sentences, commas and full stops only
//   - no em dashes, no decorative language, no AI-style filler
//   - no "robust", "comprehensive", "dynamic threat landscape"
//   - no "It is important to note", "In today's complex environment",
//     "This highlights the need"
//   - never use product names (Cargo Watch, Flashpoint, Shipping, Fuel,
//     Fertiliser, Energy, Protests) as incident type labels
//   - if data is thin, say so plainly

import { resolveReportWindow, filterIncidentsToWindow } from "./reportWindow";
import { classifyIncidentType, type ClassifiableIncident } from "./incidentClassifier";

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

function topCountriesText(rows: DraftableIncident[]): string {
  const counts = countBy(rows, (r) => (r.country ?? "").trim()).filter(([k]) => k);
  if (counts.length === 0) return "";
  const top = counts.slice(0, 3).map(([c, n]) => `${c} (${n})`);
  return joinList(top);
}

// Strip product-family words from a classifier label so the type phrase
// reads as the event itself, not as the product bucket. The topic context
// is already established by the surrounding sentence, so a fuel report
// should read "shortages and price increases", not "fuel shortage and
// fuel price increase".
const PRODUCT_WORDS = /\b(fuel|fertiliser|fertilizer|energy|cargo|shipping|maritime|flashpoint|protest|protests|civil)\b/gi;

// Direct remaps for known classifier outputs whose stripped form would read
// awkwardly. Applied AFTER product-word stripping.
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
  // Drop bare "other ... incident" buckets; they add no signal.
  if (/^other .* incident$/.test(s)) return "";
  // Strip product-family words.
  s = s.replace(PRODUCT_WORDS, " ");
  // Tidy connector residue: stray slashes, doubled spaces, leading/trailing punctuation.
  s = s.replace(/\s*\/\s*/g, " / ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[\/,\-\s]+/, "").trim();
  s = s.replace(/[\/,\-\s]+$/, "").trim();
  // Collapse "word / word" where one side is empty after stripping.
  s = s.replace(/^\/ ?/, "").replace(/ ?\/$/, "").trim();
  // Apply remap.
  if (TYPE_REMAP[s]) s = TYPE_REMAP[s];
  // Reject one-word fragments that classifier never intended as standalone.
  if (/^(to|of|for|and|or|the|a)$/.test(s)) return "";
  // Reject anything too short to read as a phrase.
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
  return topic === "cargo_watch" ? "monthly window" : "weekly window";
}

// ---------------------------------------------------------------------------
// Topic-specific framing
// ---------------------------------------------------------------------------

interface TopicFraming {
  family: string;        // e.g. "cargo theft"
  situationLine: (rows: DraftableIncident[]) => string;
  mattersLine:   (rows: DraftableIncident[]) => string;
  implicationsLine: (rows: DraftableIncident[]) => string;
  watchLine:     (rows: DraftableIncident[]) => string;
  polestarLine:  (rows: DraftableIncident[]) => string;
  thinDataNote:  string;
}

const FRAMINGS: Record<string, TopicFraming> = {
  cargo_watch: {
    family: "cargo theft, hijack, pilferage and warehouse loss",
    situationLine: (rows) => {
      const types = topTypesText(rows);
      return types
        ? `The dominant patterns in the window are ${types}. Warehouse and depot risk sits alongside truck and container loss on the same corridors.`
        : `Cargo movement across APAC and the Middle East continues to face theft, hijack and pilferage risk across warehouse, depot and road corridors.`;
    },
    mattersLine: (rows) => {
      const cs = topCountriesText(rows);
      return cs
        ? `Repeat geography in ${cs} points to known modus operandi rather than isolated events. Insider involvement and route knowledge remain the common factors behind larger losses.`
        : `Even with a quiet window, the pattern points to route knowledge and insider risk as the persistent drivers of loss.`;
    },
    implicationsLine: () =>
      `Review routing, escort use on high value moves, depot access controls, seal and lock checks at handover, and insurance cover for repeat corridors. Cross check supplier vetting on yard staff and contracted drivers.`,
    watchLine: () =>
      `Watch for copycat incidents on the same corridor within two weeks of any reported loss, fresh arrests or recoveries, and route shifts that quietly push volume through weaker depots.`,
    polestarLine: (rows) => {
      if (rows.length === 0) return `Coverage in the window is thin. Treat this as a reporting gap, not as confirmation that activity has dropped.`;
      return `The window reads as continued operational pressure rather than a step change. The pattern is consistent with previous cycles.`;
    },
    thinDataNote: `Cargo reporting in this window is thin. That should be treated as a coverage gap, not proof that the problem is absent.`,
  },
  shipping: {
    family: "vessel, port and route disruption",
    situationLine: (rows) => {
      const types = topTypesText(rows);
      return types
        ? `Activity in the window centres on ${types}. Chokepoints and major ports remain the pressure points for any client moving cargo by sea.`
        : `Sea movement through APAC and the Middle East remains exposed to vessel attack, port disruption and chokepoint risk.`;
    },
    mattersLine: (rows) => {
      const cs = topCountriesText(rows);
      return cs
        ? `Concentration in ${cs} drives transit time, freight cost and insurance exposure across the wider region.`
        : `Even a quiet window does not remove the underlying pressure on transit times, freight cost and war risk premiums.`;
    },
    implicationsLine: () =>
      `Review routing options around affected chokepoints, port call sequencing, fuel and bunker planning, and war risk premium exposure. Confirm crew change and advisory triggers with operators.`,
    watchLine: () =>
      `Watch for further port closures or strikes, naval movement near chokepoints, fresh maritime advisories and any move in war risk rates.`,
    polestarLine: (rows) => {
      if (rows.length === 0) return `Maritime reporting in this window is light. Treat that as a coverage gap rather than calm conditions.`;
      return `The window is consistent with the wider pattern of intermittent disruption. No structural shift on routing in the data.`;
    },
    thinDataNote: `Shipping reporting in this window is thin. Treat as a coverage gap, not proof that disruption has eased.`,
  },
  fuel: {
    family: "fuel supply, price and refinery pressure",
    situationLine: (rows) => {
      const types = topTypesText(rows);
      return types
        ? `Fuel pressure in the window shows ${types}. Shortages and price moves are the leading indicators ahead of unrest.`
        : `Fuel supply across APAC and the Middle East remains sensitive to shortage, subsidy change and refinery disruption.`;
    },
    mattersLine: (rows) => {
      const cs = topCountriesText(rows);
      return cs
        ? `Pressure in ${cs} feeds through to transport cost, business continuity and the risk of fuel related public order incidents.`
        : `Even a quiet window does not remove the underlying exposure to sudden shortage or a subsidy decision.`;
    },
    implicationsLine: () =>
      `Review fuel stocks at site, generator cover, route planning for fuel runs, contract pricing on bulk supply and contingency for forecourt closures.`,
    watchLine: () =>
      `Watch for subsidy announcements, refinery maintenance windows, tanker driver action and any move in pump prices in capital cities.`,
    polestarLine: (rows) =>
      rows.length === 0
        ? `Fuel reporting in the window is thin. That is a coverage gap, not a sign that pressure has eased.`
        : `Pressure remains operational rather than acute. The pattern matches recent cycles.`,
    thinDataNote: `Fuel reporting in this window is thin. Treat as a coverage gap, not as evidence that supply has stabilised.`,
  },
  fertiliser: {
    family: "fertiliser supply, price and production pressure",
    situationLine: (rows) => {
      const types = topTypesText(rows);
      return types
        ? `Fertiliser pressure in the window shows ${types}. Supply, price and export decisions remain the main signal.`
        : `Fertiliser markets across APAC continue to face supply and price pressure, with export controls and production disruption as the recurring drivers.`;
    },
    mattersLine: (rows) => {
      const cs = topCountriesText(rows);
      return cs
        ? `Concentration in ${cs} feeds into farm input cost, planting decisions and the wider food security picture.`
        : `Even a quiet window does not remove the underlying exposure to export controls and production cuts.`;
    },
    implicationsLine: () =>
      `Review supplier diversification, forward stock cover, exposure to single source urea and potash, and contingency for export ban announcements.`,
    watchLine: () =>
      `Watch for export restrictions, plant maintenance and outage announcements, farmer protest activity and any government subsidy moves.`,
    polestarLine: (rows) =>
      rows.length === 0
        ? `Fertiliser reporting in the window is thin. Treat as a coverage gap rather than market calm.`
        : `Activity is consistent with the wider supply pressure cycle. No structural break in the data.`,
    thinDataNote: `Fertiliser reporting in this window is thin. Treat as a coverage gap, not as proof of supply stability.`,
  },
  energy: {
    family: "power, grid and generation issues",
    situationLine: (rows) => {
      const types = topTypesText(rows);
      return types
        ? `Power and grid pressure in the window shows ${types}. Outages and load shedding remain the leading symptoms of capacity strain.`
        : `Grid stability across APAC remains exposed to outages, load shedding and generation shortfall, with fuel to power risk in the background.`;
    },
    mattersLine: (rows) => {
      const cs = topCountriesText(rows);
      return cs
        ? `Stress in ${cs} affects site uptime, generator load and cost of business continuity.`
        : `Even a calm window does not remove the underlying capacity gap on most regional grids.`;
    },
    implicationsLine: () =>
      `Review backup generator cover, fuel stock for extended outage, UPS run time on critical sites and any single source dependency on the public grid.`,
    watchLine: () =>
      `Watch for fresh load shedding schedules, substation incidents, fuel to power supply moves and weather events that pressure peak demand.`,
    polestarLine: (rows) =>
      rows.length === 0
        ? `Energy reporting in the window is thin. Treat as a coverage gap rather than grid stability.`
        : `Pressure remains chronic rather than acute. The pattern is consistent with recent reporting.`,
    thinDataNote: `Energy reporting in this window is thin. Treat as a coverage gap, not as proof that the grid is stable.`,
  },
  protests: {
    family: "civil protest and public order activity",
    situationLine: (rows) => {
      const types = topTypesText(rows);
      return types
        ? `Public order activity in the window centres on ${types}. Most events affect transport, access and central business districts.`
        : `Civil protest activity across the region remains routine, with disruption to transport, access and public order as the standing risks.`;
    },
    mattersLine: (rows) => {
      const cs = topCountriesText(rows);
      return cs
        ? `Concentration in ${cs} drives the operational risk for staff movement, site access and business continuity.`
        : `Even a quiet window does not change the underlying risk of fast moving public order events.`;
    },
    implicationsLine: () =>
      `Review staff movement plans, journey management for affected cities, site access controls and standing crisis communication triggers.`,
    watchLine: () =>
      `Watch for planned protest dates, university and union calls to action, police deployment notices and any escalation in arrest numbers.`,
    polestarLine: (rows) =>
      rows.length === 0
        ? `Public order reporting in the window is thin. Treat as a coverage gap rather than calm streets.`
        : `Activity is consistent with the seasonal pattern. No clear sign of a sharper escalation in the data.`,
    thinDataNote: `Public order reporting in this window is thin. Treat as a coverage gap, not as proof of calm.`,
  },
  flashpoint: {
    family: "flashpoint level civil disruption",
    situationLine: (rows) => {
      const types = topTypesText(rows);
      return types
        ? `Flashpoint activity in the window centres on ${types}. These are short cycle events with rapid operational impact.`
        : `Flashpoint level activity remains the standing risk across the region, with rapid public order events affecting transport and access.`;
    },
    mattersLine: (rows) => {
      const cs = topCountriesText(rows);
      return cs
        ? `Repeat activity in ${cs} drives the live operational risk on staff movement, site access and crisis comms.`
        : `Even a quiet window does not remove the standing risk of fast moving disruption.`;
    },
    implicationsLine: () =>
      `Hold journey management at short notice, refresh shelter in place and lockdown procedures, and confirm escalation routes with country leads.`,
    watchLine: () =>
      `Watch for planned political dates, calls to mobilise, security force deployments and any sign of cross city escalation.`,
    polestarLine: (rows) =>
      rows.length === 0
        ? `Flashpoint reporting in the window is thin. Treat as a coverage gap, not as proof that the risk has cooled.`
        : `The window reads as live operational pressure. Maintain standing readiness on affected cities.`,
    thinDataNote: `Flashpoint reporting in this window is thin. Treat as a coverage gap, not as proof of calm.`,
  },
};

function framingFor(topic: string): TopicFraming {
  return FRAMINGS[topic] ?? FRAMINGS.protests;
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
  const inWindow = filterIncidentsToWindow(incidents, topic, issueDate, { byTopic: true });
  const f = framingFor(topic);
  const period = periodPhrase(topic, issueDate);
  const cadence = cadenceWord(topic);
  const total = inWindow.length;
  const countries = topCountriesText(inWindow);
  const types = topTypesText(inWindow);
  const sev = highestSeverity(inWindow);

  const thinData = total < 3;

  const execLead = total === 0
    ? `${f.thinDataNote} The ${period} ${cadence} carried no records on file at time of writing.`
    : `${total} records sit in the ${period} ${cadence}.${countries ? ` Activity concentrates in ${countries}.` : ""}${types ? ` The leading patterns are ${types}.` : ""}${sev ? ` Highest severity in the window is ${sev}.` : ""}`;

  const execTail = thinData && total > 0
    ? ` Volume is light, so the read is directional rather than firm.`
    : ``;

  const whatHappened = total === 0
    ? `No records were captured in the window. ${f.thinDataNote}`
    : `${total} records sit in the window.${countries ? ` Most activity is in ${countries}.` : ""}${types ? ` The recurring incident types are ${types}.` : ""}${sev ? ` The most serious entry reaches ${sev} severity.` : ""} Detail sits in the related incidents table below.`;

  return {
    executiveSummary: `${execLead}${execTail}`,
    situation: f.situationLine(inWindow),
    whatHappened,
    whatMatters: f.mattersLine(inWindow),
    implications: f.implicationsLine(inWindow),
    watchNext: f.watchLine(inWindow),
    polestarView: f.polestarLine(inWindow),
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
  // Country reports follow the weekly window cap.
  const issueDate = opts.issueDate ?? new Date().toISOString().slice(0, 10);
  const inWindow = filterIncidentsToWindow(opts.incidents, "protests", issueDate);
  const period = periodPhrase("protests", issueDate);
  const total = inWindow.length;
  const types = topTypesText(inWindow);
  const sev = highestSeverity(inWindow);

  const overview = total === 0
    ? `${name} in ${region}. No records sit in the ${period} weekly window. Treat that as a coverage gap rather than confirmation that the operating picture is quiet.`
    : `${name} in ${region}. ${total} records sit in the ${period} weekly window.${types ? ` The recurring patterns are ${types}.` : ""} The picture is operational rather than acute.`;

  const trendSummary = total === 0
    ? `Window volume is too thin for a firm trend read. Hold the prior cycle assessment until further records land.`
    : `Activity is ${total < 4 ? "light but useable" : "running at normal cycle volume"}.${types ? ` The lead types are ${types}.` : ""}${sev ? ` Severity peaks at ${sev}.` : ""} No structural shift in the window relative to recent cycles.`;

  const implications = total === 0
    ? `Maintain standing controls on staff movement, site access and journey management. Re visit once fresh records land.`
    : `Hold journey management discipline on affected routes, keep site access controls under review and refresh staff briefings on the active incident types. Confirm escalation routes with the country lead.`;

  return { overview, trendSummary, implications };
}
