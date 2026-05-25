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
