// Cargo Watch auto-derived analyst prose.
//
// Two reads are generated from the in-window cargo incidents and slotted
// into the report between Fast Facts and the editor-authored sections:
//
//   1. Cargo Security Read — hijack, truck/container theft, raid,
//      pilferage and route-side cargo loss.
//   2. Logistics Hub Read — warehouse, depot, terminal, yard, customs
//      bond store and similar logistics-hub incidents.
//
// Forbidden idioms (also banned from Fuel and Shipping prose):
//   - "X records sit in window"
//   - "Activity concentrates"
//   - "Most recent"
//   - "The leading patterns are"
//   - "The usable signal is"
//   - "Detail sits"
//   - "The reporting window is noisy"
// Every line is analyst-style: tells the reader what to take from the
// data, not just how many records there were.

import { format, parseISO } from "date-fns";

export interface CargoNarrativeIncident {
  id?: number | string;
  topic: string;
  title: string;
  severity: string;
  occurredAt: string;
  country?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
}

const CARGO_SECURITY_RE = /\b(hijack|hijacked|hijacking|truck (theft|robbery|raid|hijack)|container (theft|stolen|raid)|cargo (theft|loss|robbery|stolen)|convoy (attack|raid|hit)|pilferage|seal (broken|tamper|tampering)|in[- ]transit (theft|loss|robbery))\b/i;
const LOGISTICS_HUB_RE = /\b(warehouse|depot|distribution centre|distribution center|fulfilment centre|fulfillment center|yard|terminal|customs bond|bonded warehouse|freight (terminal|yard)|inland container depot|icd|cold[- ]chain (facility|warehouse))\b/i;

function recordDate(i: CargoNarrativeIncident): Date | null {
  try {
    const d = parseISO(i.occurredAt);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function topCountries(rows: CargoNarrativeIncident[], n: number): { country: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const c = (r.country ?? "").trim();
    if (!c) continue;
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function joinCountries(rows: { country: string; count: number }[]): string {
  if (rows.length === 0) return "";
  const parts = rows.map((r) => `${r.country} (${r.count})`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function leadEntry(rows: CargoNarrativeIncident[]): CargoNarrativeIncident | null {
  if (rows.length === 0) return null;
  // Prefer the most recent operational entry — gives the reader something
  // concrete and current to anchor the section on.
  const dated = rows
    .map((r) => ({ r, d: recordDate(r) }))
    .filter((x): x is { r: CargoNarrativeIncident; d: Date } => x.d !== null);
  if (dated.length === 0) return rows[0];
  dated.sort((a, b) => b.d.getTime() - a.d.getTime());
  return dated[0].r;
}

export function buildCargoSecurityRead(windowIncidents: CargoNarrativeIncident[]): string {
  const matches = windowIncidents.filter((i) => {
    const text = `${i.title} ${i.summary ?? ""}`;
    return CARGO_SECURITY_RE.test(text);
  });
  if (matches.length === 0) {
    return `No qualifying truck-hijack, container theft, in-transit loss, pilferage or convoy-attack records reached the file in this cycle. Cargo-security reporting tends to be lumpy and a quiet window should be treated as a coverage gap rather than confirmation that route-side risk has eased.\n\nWatch insurance underwriter bulletins, transport-association advisories and any operator decisions on convoying or rerouting. Those signals usually move ahead of headline crime reporting on the routes that matter.`;
  }
  const lead = leadEntry(matches)!;
  const leadDate = recordDate(lead);
  const countries = topCountries(matches, 3);
  const countryLine = countries.length > 0
    ? `Country attribution in the window is led by ${joinCountries(countries)}.`
    : `Country attribution is sparse this cycle and limits the geographic read.`;
  const intro = `Route-side and convoy cargo risk shows up across ${matches.length} qualifying record${matches.length === 1 ? "" : "s"} this cycle, covering truck hijack, container theft, in-transit loss and similar operational crime. The lead entry is "${lead.title}"${leadDate ? `, filed ${format(leadDate, "dd MMM yyyy")}` : ""}.`;
  const watch = `Watch for clustering on specific corridors, repeat operator names in the same week and any escalation from pilferage to coordinated hijack. Insurance loss bulletins and transport-association advisories are the cleanest early signals that route-side risk is firming.`;
  return `${intro} ${countryLine}\n\n${watch}`;
}

// --- Cargo analyst auto-prose for the four standard sections ---------------
// Editor-authored text always wins; these builders provide Fuel-Watch-level
// substance when the analyst leaves a section blank. Inventory loss,
// fulfilment impact, insurance exposure, repeat corridors, depot controls,
// driver / yard staff vetting, route security, seal integrity and high-value
// cargo moves are the anchor concepts.

interface CargoAutoCtx {
  windowIncidents: CargoNarrativeIncident[];
  securityMatches: CargoNarrativeIncident[];
  hubMatches: CargoNarrativeIncident[];
}

function buildCargoAutoCtx(windowIncidents: CargoNarrativeIncident[]): CargoAutoCtx {
  const securityMatches = windowIncidents.filter((i) =>
    CARGO_SECURITY_RE.test(`${i.title} ${i.summary ?? ""}`),
  );
  const hubMatches = windowIncidents.filter((i) =>
    LOGISTICS_HUB_RE.test(`${i.title} ${i.summary ?? ""}`),
  );
  return { windowIncidents, securityMatches, hubMatches };
}

export function buildCargoWhatMatters(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  const countries = topCountries(ctx.windowIncidents, 3);
  const parts: string[] = [];
  if (ctx.securityMatches.length === 0 && ctx.hubMatches.length === 0) {
    return `No qualifying truck-hijack, container theft, in-transit loss or logistics-hub logistics incident reached the file this cycle. Cargo-crime reporting is lumpy and a blank window should be read as a coverage gap rather than confirmation that route-side or depot-side risk has eased. Treat the underlying inventory-loss, fulfilment and insurance-exposure picture as unchanged until at least two clean cycles in a row.`;
  }
  parts.push(
    `What this cycle changes for cargo owners and operators is concentrated in two places: route-side incidents (${ctx.securityMatches.length} qualifying record${ctx.securityMatches.length === 1 ? "" : "s"}) that translate directly into inventory loss, fulfilment slippage and insurance-claim exposure; and logistics-hub losses (${ctx.hubMatches.length} qualifying record${ctx.hubMatches.length === 1 ? "" : "s"}) that test warehouse and depot controls, driver and yard-staff vetting, and seal and handover integrity.`,
  );
  if (countries.length > 0) {
    parts.push(
      `Country-level concentration in the window is led by ${joinCountries(countries)}. Repeat hits in the same country across consecutive cycles are the cleanest early signal that a specific corridor or operator is being worked by an organised crew — that is the point at which insurance bulletins and police alerts typically follow.`,
    );
  }
  parts.push(
    `For high-value cargo moves the implication is to assume route-side risk has not eased even on a quiet week. Pre-route security reviews, seal and lock integrity checks at handover, and driver-vetting on contracted hauliers are the cheapest mitigation; they only get expensive after a loss.`,
  );
  return parts.join("\n\n");
}

export function buildCargoImplications(_windowIncidents: CargoNarrativeIncident[]): string {
  // Fixed-shape bullet set covering route review, escort use, depot
  // and warehouse access control, driver and yard-staff vetting,
  // seal / lock checks at handover, insurance cover on repeat
  // corridors and incident reporting / recovery procedures. Order
  // runs from operational (route, escort) through facility controls
  // (depot, vetting, seals) to commercial / process (insurance,
  // reporting).
  void _windowIncidents;
  const bullets: string[] = [
    `Run a fresh route review on repeat-loss corridors and re-baseline expected transit risk before the next high-value move.`,
    `Use escort or convoy cover on high-value loads through known-hot lanes; the cost only looks high until a single loss prices it in.`,
    `Tighten depot and warehouse access control — visitor logs, after-hours staffing, CCTV blind spots and perimeter integrity at named hubs.`,
    `Re-baseline driver and yard-staff vetting on contracted hauliers; insider involvement is the consistent thread behind larger losses.`,
    `Enforce seal and lock checks at every handover, with photographic evidence captured and matched at origin and destination.`,
    `Review insurance cover and deductibles on repeat corridors; expect underwriter response within one to two cycles on lanes with recurring activity.`,
    `Confirm incident-reporting and recovery procedures end-to-end — police notification, insurer notification, internal escalation and stock-recovery actions — so the response is rehearsed, not improvised.`,
  ];
  return bullets.map((b) => `- ${b}`).join("\n");
}

export function buildCargoWatchNext(_windowIncidents: CargoNarrativeIncident[]): string {
  // Fixed-shape watch indicators per spec: repeat losses on the same
  // corridor, copycat theft within two weeks, insider involvement,
  // depot access failures, seal / lock failures, fresh arrests or
  // recoveries, route displacement to weaker depots, and insurance
  // or police alerts.
  void _windowIncidents;
  const bullets: string[] = [
    `Repeat losses on the same corridor across consecutive cycles — clearest sign an organised crew is working a specific lane.`,
    `Copycat theft within two weeks of a publicised hijack — one event commonly draws three or four imitators.`,
    `Insider involvement signals — out-of-hours loading, driver or yard-staff turnover coinciding with a loss, seal or lock anomalies.`,
    `Depot access failures, after-hours entries and CCTV outages on the same shift — facility-side organisation rather than opportunistic pilferage.`,
    `Seal or lock failures at handover — leading indicator of a compromised driver, agent or yard handler.`,
    `Fresh arrests, recoveries or charge-sheet filings on prior losses — tells you whether the law-enforcement response is firming or stalling.`,
    `Route displacement away from controlled depots toward weaker ones under cost pressure — common precursor to a fresh loss cycle.`,
    `Insurance underwriter bulletins, transport-association advisories and police-alert circulars on affected corridors — the cleanest market-side signal.`,
  ];
  return bullets.map((b) => `- ${b}`).join("\n");
}

export function buildCargoPolestarView(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  // Country picture is split deliberately: overall total leader (drives
  // the Fast Facts "Most Affected Country" card) vs the logistics-hub
  // leader. If they differ, the prose calls that out instead of letting
  // the report appear self-contradictory.
  const overallTop = topCountries(ctx.windowIncidents, 3);
  const hubTop = topCountries(ctx.hubMatches, 1);
  const securityTop = topCountries(ctx.securityMatches, 1);
  const parts: string[] = [];

  // 1. Judgement: larger losses driven by route familiarity and
  // likely insider knowledge.
  parts.push(
    `Our read on the cycle is that the larger cargo losses on the file are being driven by route familiarity and likely insider knowledge rather than opportunistic crime. The pattern across hijack reports, depot raids and seal-failure entries is too consistent to read as chance — repeat corridors, named depots and the same modus operandi recur.`,
  );

  // 2. Country split: name the main operating geographies and
  // distinguish total-record leader from logistics-hub leader if they
  // differ, so the Fast Facts card and the prose do not contradict.
  if (overallTop.length > 0) {
    const overallList = joinCountries(overallTop);
    const hub = hubTop[0]?.country ?? null;
    const sec = securityTop[0]?.country ?? null;
    const split = hub && sec && hub !== sec
      ? ` ${sec} leads route-side cargo-security reporting on the file while ${hub} leads logistics-hub and warehouse exposure — different lanes of the same problem, not separate issues.`
      : "";
    parts.push(
      `The main operating geographies this cycle are ${overallList}.${split}`,
    );
  }

  // 3. Route-side and hub-side risk are linked — treat them as one
  // exposure picture, not two separate buckets.
  parts.push(
    `Route-side hijack risk and logistics-hub theft should be treated as linked exposures rather than separate problems. Inventory that survives the road can still be lost at the depot, and crews working a corridor are often the same crews working a yard at the other end of it.`,
  );

  // 4. Where business users should actually focus.
  parts.push(
    `For business users the focus should sit on four controls: handover discipline (seals, locks, photographic evidence at origin and destination); driver and yard-staff vetting on contracted hauliers; depot discipline on access, staffing and after-hours integrity; and routing that treats repeat-loss corridors as live exposure rather than a default lane choice. These are the controls that hold up across cycles regardless of how loud or quiet any single week looks.`,
  );

  return parts.join("\n\n");
}

// Auto-prose for the Situation section. The Fast Facts "Most Affected
// Country" card uses a raw total-records leader; this builder mirrors
// the same logic so the headline figure and the prose cannot disagree.
// When the logistics-hub leader differs from the overall leader, both
// are named so the country split is explicit, not contradictory.
export function buildCargoSituation(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  if (ctx.windowIncidents.length === 0) {
    return `Warehouse, depot and road-corridor exposure persists regardless of how quiet the reporting window looks. Cargo-crime reporting is lumpy and a blank window should be read as a coverage gap, not confirmation that route-side or hub-side risk has eased.`;
  }
  const overallTop = topCountries(ctx.windowIncidents, 1);
  const hubTop = topCountries(ctx.hubMatches, 1);
  const overall = overallTop[0]?.country ?? null;
  const hub = hubTop[0]?.country ?? null;
  const focus = `Warehouse, depot and road corridors hold the live exposure this cycle, with route familiarity and insider risk as the persistent drivers.`;
  const where = overall && hub && overall !== hub
    ? ` ${overall} leads total reporting on the file, while ${hub} leads logistics-hub and warehouse risk — both sit inside the same operating picture.`
    : overall
      ? ` ${overall} sits at the centre of the recurring geography on this cycle.`
      : "";
  return `${focus}${where}`;
}

export function buildLogisticsHubRead(windowIncidents: CargoNarrativeIncident[]): string {
  const matches = windowIncidents.filter((i) => {
    const text = `${i.title} ${i.summary ?? ""}`;
    return LOGISTICS_HUB_RE.test(text);
  });
  if (matches.length === 0) {
    return `No qualifying warehouse, depot, terminal or yard incidents reached the file in this cycle. Logistics-hub losses often go unreported until insurance claims are filed, so a blank window does not redefine the underlying picture on storage and last-mile facilities.\n\nKeep tracking facility-security bulletins, insurer loss notices and any operator commentary on staffing or perimeter changes. Those are the early indicators that hub-side risk is firming on a specific corridor.`;
  }
  const lead = leadEntry(matches)!;
  const leadDate = recordDate(lead);
  const countries = topCountries(matches, 3);
  const countryLine = countries.length > 0
    ? `The country picture in this cycle is led by ${joinCountries(countries)}.`
    : `Country attribution is sparse this cycle and limits the geographic read.`;
  const intro = `Logistics hub risk across warehouses, depots, distribution centres, terminals and bonded storage appears across ${matches.length} qualifying record${matches.length === 1 ? "" : "s"} this cycle. The lead entry is "${lead.title}"${leadDate ? `, filed ${format(leadDate, "dd MMM yyyy")}` : ""}.`;
  const watch = `Watch for repeat incidents at the same facility or operator, escalation from pilferage to organised raids, and any insurance-premium movement on affected corridors. Hub-side losses typically precede a hardening of underwriting terms by one to two cycles.`;
  return `${intro} ${countryLine}\n\n${watch}`;
}
