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

export function buildCargoImplications(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  const bullets: string[] = [
    `Treat affected corridors as live inventory-loss exposure and order re-supply against lost stock without delay.`,
    `Expect underwriter response within one to two cycles — deductibles, route exclusions or premium moves on lanes with repeat activity.`,
  ];
  if (ctx.securityMatches.length > 0) {
    bullets.push(
      `Tighten driver and crew vetting on affected corridors and enforce convoy or escort rules on high-value loads.`,
    );
    bullets.push(
      `Review rest-stop, refuelling and handover discipline; assume the threat is insider as well as external.`,
    );
  }
  if (ctx.hubMatches.length > 0) {
    bullets.push(
      `Review depot perimeter, after-hours staffing, CCTV blind spots and seal-and-lock integrity at every handover.`,
    );
    bullets.push(
      `Re-baseline yard-staff vetting and visitor controls — lowest-cost wins and first to slip during operator turnover.`,
    );
  }
  bullets.push(
    `Write loss-mitigation clauses into near-term freight and insurance contracts rather than rely on standard cover.`,
  );
  return bullets.map((b) => `- ${b}`).join("\n");
}

export function buildCargoWatchNext(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  const bullets: string[] = [
    `Repeat losses on the same corridor across consecutive cycles: clearest sign an organised crew is working a specific lane.`,
    `Copycat theft after a publicised hijack: one event often draws three or four imitators within a fortnight.`,
    `Insider tells — out-of-hours loading, driver or yard-staff turnover coinciding with a loss, seal or lock failures: trigger handover audit.`,
    `Depot access failures, broken seals and CCTV outages on the same shift: signal organised facility-side activity, not pilferage.`,
    `Insurance underwriter bulletins, transport-association advisories and police-alert circulars: leading market signal.`,
    `Operator route displacement under cost pressure (controlled depot to weaker one): common precursor to a fresh loss cycle.`,
    `Premium movement on affected lanes: cleanest lagging confirmation the operational signal has firmed commercially.`,
  ];
  if (ctx.hubMatches.length > 0) {
    bullets.push(
      `Facility-access incidents and perimeter breaches at named hubs: watch for escalation from pilferage to organised raiding.`,
    );
  }
  return bullets.map((b) => `- ${b}`).join("\n");
}

export function buildCargoPolestarView(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  const parts: string[] = [];
  parts.push(
    `Our read on cargo risk this cycle is that the underlying loss picture remains structurally elevated even when the weekly file is quiet. Cargo-crime reporting under-counts the true loss rate; what reaches the public file is typically the subset that produced a police report, an insurance claim large enough to trigger underwriter contact, or a media-worthy hijack. Operational losses on smaller corridors continue between cycles.`,
  );
  parts.push(
    `Practically, that means cargo owners should plan against a baseline of route-side and hub-side loss exposure rather than treat quiet cycles as a green light. Convoying or escort for high-value moves, seal-and-lock integrity at every handover, driver and yard-staff vetting on contracted hauliers, and depot perimeter discipline are the controls that hold up across cycles.`,
  );
  if (ctx.securityMatches.length + ctx.hubMatches.length > 0) {
    parts.push(
      `We expect the same corridors and facility types to set the tempo through the next reporting window. A return to elevated public reporting is usually visible first in insurance underwriter circulars and transport-association advisories — that is the signal to tighten posture, not the headline-loss event itself.`,
    );
  }
  return parts.join("\n\n");
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
  const intro = `Logistics-hub logistics risk — warehouses, depots, distribution centres, terminals and bonded storage — shows up across ${matches.length} qualifying record${matches.length === 1 ? "" : "s"} this cycle. The lead entry is "${lead.title}"${leadDate ? `, filed ${format(leadDate, "dd MMM yyyy")}` : ""}.`;
  const watch = `Watch for repeat incidents at the same facility or operator, escalation from pilferage to organised raids, and any insurance-premium movement on affected corridors. Hub-side losses typically precede a hardening of underwriting terms by one to two cycles.`;
  return `${intro} ${countryLine}\n\n${watch}`;
}
