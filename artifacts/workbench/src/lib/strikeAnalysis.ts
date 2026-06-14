// Single source of truth for the Missile Strike Tracker's client-side
// breakdowns. Extracted from Strikes.tsx so the dashboard AND the Infographic
// Card Builder bucket strikes by target / weapon / country identically and can
// never drift. The strikes table leaves ~77% of target/infrastructure as
// `unknown`, so these helpers derive from the DB enums (when meaningful) plus
// the incident-descriptive text, exactly as the dashboard does.

import {
  hasMilitaryTargetSignal, hasVesselSignal,
  OILGAS_SIG, POWER_SIG, PORT_SIG, AIRPORT_SIG,
  GOVT_SIG, CIVIL_SIG, INDUSTRIAL_SIG,
} from "@workspace/strike-targets";

export interface StrikeLike {
  country: string;
  location?: string | null;
  munition: string;
  targetCategory: string;
  infrastructure: string;
  casualties?: number | null;
  summary?: string | null;
  analystNotes?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
}

// Incident-descriptive text only. The outlet `source` and the base64
// `sourceUrl` slug are intentionally excluded — they carry no target/impact
// signal and corrupt the regex matching.
export function strikeText(s: StrikeLike): string {
  return [
    s.summary ?? "",
    s.analystNotes ?? "",
    s.location ?? "",
  ].join(" ").toLowerCase();
}

export const UNKNOWN_TARGET = "Unknown / unattributed";

// Text fallback, only consulted when the DB category is "unknown". Order is
// precedence. Military is handled separately above. Every signal comes from the
// shared rulebook — a single edit there covers ingest and the dashboard.
const TARGET_TEXT: { label: string; test: (t: string) => boolean }[] = [
  { label: "Oil & Gas", test: (t) => OILGAS_SIG.test(t) },
  { label: "Power / Grid", test: (t) => POWER_SIG.test(t) },
  { label: "Maritime", test: (t) => hasVesselSignal(t) || PORT_SIG.test(t) },
  { label: "Aviation", test: (t) => AIRPORT_SIG.test(t) },
  { label: "Government", test: (t) => GOVT_SIG.test(t) },
  { label: "Civilian", test: (t) => CIVIL_SIG.test(t) },
  { label: "Industrial", test: (t) => INDUSTRIAL_SIG.test(t) },
];

// Map the DB `target_category` / `infrastructure` enums onto display labels.
// Prefer the more specific `target_category`; fall back to `infrastructure`.
function mapDbTarget(targetCategory: string, infrastructure: string): string | null {
  const tc = (targetCategory ?? "").toLowerCase();
  const inf = (infrastructure ?? "").toLowerCase();
  const energy = inf === "oil_gas" ? "Oil & Gas" : inf === "power" ? "Power / Grid" : "Energy";
  switch (tc) {
    case "military_site": return "Military";
    case "airport_aviation": return "Aviation";
    case "vessel":
    case "port_maritime": return "Maritime";
    case "energy_infrastructure": return energy;
    case "civilian_area": return "Civilian";
    case "government_facility": return "Government";
  }
  switch (inf) {
    case "military": return "Military";
    case "airport": return "Aviation";
    case "power": return "Power / Grid";
    case "oil_gas": return "Oil & Gas";
    case "civilian_residential": return "Civilian";
    case "government": return "Government";
    case "port": return "Maritime";
  }
  return null;
}

export function deriveTarget(s: StrikeLike): string {
  const text = strikeText(s);
  // 1. Military / US-forces air bases beat everything — fixes the old
  //    "airbase -> civil Aviation" mis-bucketing. Role-aware: a US force that
  //    only fired/responded does not count as the struck target.
  if (hasMilitaryTargetSignal(text)) return "Military";
  // 2. Trust the DB category when it carries a real value.
  const db = mapDbTarget(s.targetCategory, s.infrastructure);
  if (db) return db;
  // 3. Text fallback for the rows the DB left as "unknown".
  for (const t of TARGET_TEXT) if (t.test(text)) return t.label;
  // 4. No genuine target signal — unattributed, never a catch-all "Other".
  return UNKNOWN_TARGET;
}

export function deriveWeapon(s: StrikeLike): string {
  // Spec weapon vocabulary: Drone | Ballistic missile | Cruise missile | Unknown.
  // "Combined" / "mixed" describes the attack context, not the weapon family,
  // so mixed records collapse to Unknown here and are surfaced via deriveContext.
  const m = (s.munition ?? "").toLowerCase();
  if (m === "drone") return "Drone";
  if (m === "ballistic_missile") return "Ballistic missile";
  if (m === "cruise_missile") return "Cruise missile";
  if (m === "mixed") return "Unknown";
  // Fall back to text parsing only when DB value is unknown.
  const text = strikeText(s);
  if (/\bdrone|uav|loiter|shahed\b/.test(text)) return "Drone";
  if (/\bballistic\b/.test(text)) return "Ballistic missile";
  if (/\bcruise missile\b/.test(text)) return "Cruise missile";
  return "Unknown";
}

export function groupCount<T>(arr: T[], key: (x: T) => string): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of arr) { const k = key(x); m.set(k, (m.get(k) ?? 0) + 1); }
  return Array.from(m.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}
