// Cargo Watch auto-derived analyst prose.
//
// Two reads are generated from the in-window cargo incidents and slotted
// into the report between Fast Facts and the editor-authored sections:
//
//   1. Cargo Security Read — hijack, truck/container theft, raid,
//      pilferage and route-side cargo loss.
//   2. Logistics Node Read — warehouse, depot, terminal, yard, customs
//      bond store and similar fixed-node incidents.
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
const LOGISTICS_NODE_RE = /\b(warehouse|depot|distribution centre|distribution center|fulfilment centre|fulfillment center|yard|terminal|customs bond|bonded warehouse|freight (terminal|yard)|inland container depot|icd|cold[- ]chain (facility|warehouse))\b/i;

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
  nodeMatches: CargoNarrativeIncident[];
}

function buildCargoAutoCtx(windowIncidents: CargoNarrativeIncident[]): CargoAutoCtx {
  const securityMatches = windowIncidents.filter((i) =>
    CARGO_SECURITY_RE.test(`${i.title} ${i.summary ?? ""}`),
  );
  const nodeMatches = windowIncidents.filter((i) =>
    LOGISTICS_NODE_RE.test(`${i.title} ${i.summary ?? ""}`),
  );
  return { windowIncidents, securityMatches, nodeMatches };
}

export function buildCargoWhatMatters(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  const countries = topCountries(ctx.windowIncidents, 3);
  const parts: string[] = [];
  if (ctx.securityMatches.length === 0 && ctx.nodeMatches.length === 0) {
    return `No qualifying truck-hijack, container theft, in-transit loss or fixed-node logistics incident reached the file this cycle. Cargo-crime reporting is lumpy and a blank window should be read as a coverage gap rather than confirmation that route-side or depot-side risk has eased. Treat the underlying inventory-loss, fulfilment and insurance-exposure picture as unchanged until at least two clean cycles in a row.`;
  }
  parts.push(
    `What this cycle changes for cargo owners and operators is concentrated in two places: route-side incidents (${ctx.securityMatches.length} qualifying record${ctx.securityMatches.length === 1 ? "" : "s"}) that translate directly into inventory loss, fulfilment slippage and insurance-claim exposure; and fixed-node losses (${ctx.nodeMatches.length} qualifying record${ctx.nodeMatches.length === 1 ? "" : "s"}) that test warehouse and depot controls, driver and yard-staff vetting, and seal and handover integrity.`,
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
  const parts: string[] = [];
  parts.push(
    `For cargo owners the immediate consequence is inventory-loss exposure on affected corridors and fulfilment slippage where re-supply has to be ordered against the lost stock. Insurance underwriters typically respond to a clustered loss pattern within one to two cycles; expect deductibles, route exclusions or premium movement on lanes that show repeat activity.`,
  );
  if (ctx.securityMatches.length > 0) {
    parts.push(
      `For hauliers and 3PL operators the route-side picture argues for tightening driver and crew vetting on the affected corridors, reviewing rest-stop and refuelling discipline, and instituting hard rules on convoying or escorts for high-value loads. A single insider-enabled loss is enough to invalidate an entire route-security posture, so the controls have to assume the threat is internal as well as external.`,
    );
  }
  if (ctx.nodeMatches.length > 0) {
    parts.push(
      `For warehouse and depot operators the fixed-node picture argues for an immediate review of perimeter controls, after-hours staffing, CCTV coverage at known blind spots, and seal-and-lock integrity at every handover. Yard-staff vetting and visitor controls are the lowest-cost wins and tend to be the first thing to slip during operator turnover.`,
    );
  }
  parts.push(
    `For finance and procurement the implication is to assume insurance and freight-cost exposure on affected corridors will firm before the next renewal, and to write loss-mitigation clauses into near-term contracts rather than rely on standard cover.`,
  );
  return parts.join("\n\n");
}

export function buildCargoWatchNext(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  const lines: string[] = [];
  lines.push(
    `Watch for repeat losses on the same corridor across consecutive cycles — repeats are the single clearest sign an organised crew is working a specific lane, and they typically appear before any police or insurance bulletin is issued. Copycat theft patterns after a publicised incident are the second pattern to watch; one well-covered hijack often draws three or four imitators within a fortnight.`,
  );
  lines.push(
    `Track insider-involvement indicators: cargo loaded out of normal hours, driver or yard-staff turnover that coincides with a loss, and seal or lock failures that do not match the documented handover sequence. Depot access failures, broken seals, lock tampering and CCTV outages on the same shift cluster are the operational tells.`,
  );
  lines.push(
    `Monitor insurance underwriter bulletins, transport-association advisories, police-alert circulars and any operator announcements on route displacement. Displacement of loads from a controlled depot to a weaker one — usually under cost pressure — is a common precursor to a fresh loss cycle. Premium movement on the affected lanes is the cleanest lagging confirmation that the operational signal has firmed into a commercial one.`,
  );
  if (ctx.nodeMatches.length > 0) {
    lines.push(
      `On fixed-node risk specifically: watch for facility-access incidents, perimeter breaches, after-hours staffing changes and any escalation from pilferage to organised raiding at the same facility.`,
    );
  }
  return lines.join("\n\n");
}

export function buildCargoPolestarView(windowIncidents: CargoNarrativeIncident[]): string {
  const ctx = buildCargoAutoCtx(windowIncidents);
  const parts: string[] = [];
  parts.push(
    `Our read on cargo risk this cycle is that the underlying loss picture remains structurally elevated even when the weekly file is quiet. Cargo-crime reporting under-counts the true loss rate; what reaches the public file is typically the subset that produced a police report, an insurance claim large enough to trigger underwriter contact, or a media-worthy hijack. Operational losses on smaller corridors continue between cycles.`,
  );
  parts.push(
    `Practically, that means cargo owners should plan against a baseline of route-side and node-side loss exposure rather than treat quiet cycles as a green light. Convoying or escort for high-value moves, seal-and-lock integrity at every handover, driver and yard-staff vetting on contracted hauliers, and depot perimeter discipline are the controls that hold up across cycles.`,
  );
  if (ctx.securityMatches.length + ctx.nodeMatches.length > 0) {
    parts.push(
      `We expect the same corridors and facility types to set the tempo through the next reporting window. A return to elevated public reporting is usually visible first in insurance underwriter circulars and transport-association advisories — that is the signal to tighten posture, not the headline-loss event itself.`,
    );
  }
  return parts.join("\n\n");
}

export function buildLogisticsNodeRead(windowIncidents: CargoNarrativeIncident[]): string {
  const matches = windowIncidents.filter((i) => {
    const text = `${i.title} ${i.summary ?? ""}`;
    return LOGISTICS_NODE_RE.test(text);
  });
  if (matches.length === 0) {
    return `No qualifying warehouse, depot, terminal or yard incidents reached the file in this cycle. Fixed-node losses often go unreported until insurance claims are filed, so a blank window does not redefine the underlying picture on storage and last-mile facilities.\n\nKeep tracking facility-security bulletins, insurer loss notices and any operator commentary on staffing or perimeter changes. Those are the early indicators that node-side risk is firming on a specific corridor.`;
  }
  const lead = leadEntry(matches)!;
  const leadDate = recordDate(lead);
  const countries = topCountries(matches, 3);
  const countryLine = countries.length > 0
    ? `The country picture in this cycle is led by ${joinCountries(countries)}.`
    : `Country attribution is sparse this cycle and limits the geographic read.`;
  const intro = `Fixed-node logistics risk — warehouses, depots, distribution centres, terminals and bonded storage — shows up across ${matches.length} qualifying record${matches.length === 1 ? "" : "s"} this cycle. The lead entry is "${lead.title}"${leadDate ? `, filed ${format(leadDate, "dd MMM yyyy")}` : ""}.`;
  const watch = `Watch for repeat incidents at the same facility or operator, escalation from pilferage to organised raids, and any insurance-premium movement on affected corridors. Node-side losses typically precede a hardening of underwriting terms by one to two cycles.`;
  return `${intro} ${countryLine}\n\n${watch}`;
}
