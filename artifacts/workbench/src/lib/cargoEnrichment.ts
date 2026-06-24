// Per-incident enrichment for Cargo Watch — pure, no schema, no fabrication.
//
// Derives, from an incident's OWN text + metadata only:
//   - confidence (High / Medium / Low) from source authority + corroboration,
//   - a 0-4 impact projection of the EXISTING named severity tier (the named
//     tier stays the primary display; the number is a secondary "Severity rank"),
//   - a lifecycle status (New / Ongoing / Updated / Resolved / Unconfirmed),
//   - a small set of structured fields (vessel / company / cargo type / time /
//     port-location) with a strict "not reported." fallback,
//   - an optional, category-specific recommended watch item.
//
// Nothing is invented: every field returns null (rendered as "not reported.")
// when the source does not state it. Severity is never upgraded here — Extreme
// remains fatal-only as set upstream. Both the monitor and the report consume
// THIS module so the two surfaces can never show different enrichment for the
// same record (P3 wires the rendering; this is the single derivation authority).

import {
  classifyCargoCategory,
  classifyCategory,
  cargoCategoryGroup,
  recoverCargoPortName,
  CARGO_FLOOR_LABEL,
  CARGO_NOT_RELEVANT,
  type CargoIncidentLike,
  type CargoCategoryGroup,
} from "./cargoAnalysis";
import { SEV_RANK, SEV_LABEL, sevKey } from "./pdfChrome";

// The exact fallback string every cargo field uses when the source is silent.
export const NOT_REPORTED = "not reported.";

export type CargoConfidence = "High" | "Medium" | "Low";
export type CargoStatus =
  | "New"
  | "Ongoing"
  | "Updated"
  | "Resolved"
  | "Unconfirmed";

export interface CargoEnrichmentInput extends CargoIncidentLike {
  occurredAt?: string | null;
  severity?: string | null;
  sourceUrl?: string | null;
}

export interface CargoEnrichmentContext {
  /** Records in this incident's corroboration cluster (>=1). P3 supplies the
   *  real cluster size; default 1 = a single, uncorroborated report. */
  clusterSize?: number;
  /** Reference "now" for recency. When omitted, recency is not used (status
   *  falls back to text cues / Ongoing) so a bare call stays deterministic.
   *  Callers pass the report window end (or the current date for the monitor). */
  referenceDate?: string | Date | null;
}

export interface CargoEnrichment {
  category: string;
  group: CargoCategoryGroup;
  confidence: CargoConfidence;
  /** 0-4 projection of the named tier — SECONDARY display only. */
  impactScore: number;
  /** Named severity tier — the PRIMARY display. Never upgraded to Extreme. */
  impactLabel: string;
  severityKey: string;
  status: CargoStatus;
  vessel: string | null;
  company: string | null;
  cargoType: string | null;
  incidentTime: string | null;
  portLocation: string | null;
  /** True when portLocation is a gazetteer/centroid approximation, not exact. */
  locationApproximate: boolean;
  watchItem: string | null;
}

function blob(i: CargoEnrichmentInput): string {
  return `${i.title} ${i.summary ?? ""}`;
}

// --- Source authority + corroboration ------------------------------------

// Official actors and recognised wires whose reporting is treated as
// authoritative. Scanned across the publisher name, the URL and the body so a
// "police said" / "customs seized" framing also counts even when the masthead
// is a local outlet.
const AUTHORITATIVE_RE =
  /\b(police|customs|coast ?guard|coastguard|navy|naval|maritime authority|port authority|marine department|government|ministry|interpol|recaap|imb piracy|imb|icc-ccs|immigration department|home affairs|reuters|associated press|\bap\b|afp|bloomberg)\b/i;

export function isAuthoritativeSource(i: CargoEnrichmentInput): boolean {
  const hay = `${i.source ?? ""} ${i.sourceUrl ?? ""} ${blob(i)}`;
  return AUTHORITATIVE_RE.test(hay);
}

// Hedged / speculative framing caps confidence at Low and forces the status to
// Unconfirmed — the source itself is not asserting the event as fact.
const SPECULATIVE_RE =
  /\b(alleged|allegedly|reportedly|suspected|claim(?:s|ed)?|rumou?r(?:s|ed)?|unconfirmed|purported(?:ly)?|possible|may have|appears? to|believed to)\b/i;

export function isSpeculative(i: CargoEnrichmentInput): boolean {
  return SPECULATIVE_RE.test(blob(i));
}

export function deriveConfidence(
  i: CargoEnrichmentInput,
  ctx: CargoEnrichmentContext = {},
): CargoConfidence {
  if (isSpeculative(i)) return "Low";
  const cluster = Math.max(1, ctx.clusterSize ?? 1);
  const authoritative = isAuthoritativeSource(i);
  // Multiple independent reports, or an authoritative source corroborated by at
  // least one more, give the strongest confidence.
  if (cluster >= 3 || (authoritative && cluster >= 2)) return "High";
  // A single authoritative source, or two non-authoritative reports, is medium.
  if (authoritative || cluster >= 2) return "Medium";
  return "Low";
}

// --- Impact (0-4 projection of the existing named tier) -------------------

export function deriveImpact(i: CargoEnrichmentInput): {
  impactScore: number;
  impactLabel: string;
  severityKey: string;
} {
  const key = sevKey(i.severity);
  const rank = SEV_RANK[key];
  if (rank == null) {
    // No stored tier — fall to the floor honestly rather than inventing one.
    return { impactScore: 1, impactLabel: "Low", severityKey: "low" };
  }
  // SEV_RANK is 1-5 (insignificant..extreme); the impact score is the 0-4
  // projection. The named tier remains the primary display.
  return {
    impactScore: rank - 1,
    impactLabel: SEV_LABEL[key] ?? "Low",
    severityKey: key,
  };
}

// --- Lifecycle status -----------------------------------------------------

const RESOLVED_RE =
  /\b(arrest(?:s|ed)?|detain(?:s|ed)?|charged|convict(?:s|ed)?|sentenc(?:e|ed)|jailed|recover(?:s|ed)|returned to|nabbed|apprehend(?:s|ed)?|busted|dismantl(?:e|ed)|seiz(?:e|ed) back)\b/i;
const UPDATED_RE =
  /\b(update[ds]?|latest|further|additional|new details|developing|fresh)\b/i;
const ONGOING_RE =
  /\b(continues?|ongoing|still|manhunt|search(?:ing)? for|hunt for|at large|investigation underway|probe|on the run)\b/i;

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

export function deriveStatus(
  i: CargoEnrichmentInput,
  ctx: CargoEnrichmentContext = {},
): CargoStatus {
  const text = blob(i);
  if (isSpeculative(i)) return "Unconfirmed";
  if (RESOLVED_RE.test(text)) return "Resolved";
  if (UPDATED_RE.test(text)) return "Updated";
  // Recency: only when a reference date is supplied AND the incident date parses.
  if (ctx.referenceDate != null && i.occurredAt) {
    const ref = ctx.referenceDate instanceof Date ? ctx.referenceDate : new Date(ctx.referenceDate);
    const at = new Date(i.occurredAt);
    if (!isNaN(ref.getTime()) && !isNaN(at.getTime()) && daysBetween(ref, at) <= 7) {
      return "New";
    }
  }
  if (ONGOING_RE.test(text)) return "Ongoing";
  return "Ongoing";
}

// --- Structured fields (null => "not reported.") --------------------------

const VESSEL_RE = [
  /\b(?:M\/?V|M\/?T|M\.V\.|M\.T\.)\s+([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,2})/,
  /\b(?:vessel|ship|tanker|bulk carrier|cargo ship|container ship)\s+(?:named\s+)?["“]([^"”]{2,40})["”]/i,
];

export function extractVessel(i: CargoEnrichmentInput): string | null {
  const text = blob(i);
  for (const re of VESSEL_RE) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

const COMPANY_CUE_RE =
  /\b(?:operated by|owned by|run by|belonging to|operator|consignee|shipper|logistics firm|shipping line|carrier)\s+([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})/;
const COMPANY_SUFFIX_RE =
  /\b([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3}\s+(?:Logistics|Shipping|Lines|Line|Forwarding|Transport|Transports|Haulage|Express|Carriers?|Group|Holdings|Ltd|Pte|Inc|Corp|Co)\b)/;

export function extractCompany(i: CargoEnrichmentInput): string | null {
  const text = blob(i);
  const cue = text.match(COMPANY_CUE_RE);
  if (cue && cue[1]) return cue[1].trim();
  const suf = text.match(COMPANY_SUFFIX_RE);
  if (suf && suf[1]) return suf[1].trim();
  return null;
}

export function extractCargoType(i: CargoEnrichmentInput): string | null {
  const c = classifyCategory(i);
  // "Other" carries no concrete commodity signal — report it as not stated.
  if (c === "Other") return null;
  return c;
}

const TIME_CLOCK_RE = /\b(\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?))\b/i;
const TIME_DAYPART_RE =
  /\b(overnight|early hours|pre[- ]?dawn|before dawn|at night|midnight|noon|early morning|late evening|dead of night)\b/i;

export function extractIncidentTime(i: CargoEnrichmentInput): string | null {
  const text = blob(i);
  const clock = text.match(TIME_CLOCK_RE);
  if (clock && clock[1]) return clock[1].replace(/\s+/g, "").toLowerCase();
  const part = text.match(TIME_DAYPART_RE);
  if (part && part[1]) return part[1].toLowerCase();
  return null;
}

export function derivePortLocation(i: CargoEnrichmentInput): {
  portLocation: string | null;
  locationApproximate: boolean;
} {
  const port = recoverCargoPortName(i);
  if (port) return { portLocation: port.port, locationApproximate: true };
  if (i.location && i.location.trim()) {
    return { portLocation: i.location.trim(), locationApproximate: false };
  }
  return { portLocation: null, locationApproximate: false };
}

// --- Recommended watch item (concrete, category-specific, or omitted) -----

// Concrete, category-specific actions. The cargo floor + "Not relevant" map to
// null so the report never prints a generic "monitor the situation" filler.
const WATCH_ITEMS: Record<string, string> = {
  "Truck hijacking":
    "Brief drivers on high-risk corridor stops; review convoy timing and escort options.",
  "Attack on cargo vehicle / convoy":
    "Re-route or escort convoys on the affected stretch; vary departure timing.",
  "Highway / road cargo robbery":
    "Avoid unscheduled roadside halts on the corridor; confirm secured parking.",
  "Warehouse theft":
    "Audit warehouse perimeter, CCTV coverage and after-hours access logs.",
  "Depot / yard theft":
    "Verify depot guarding and seal checks on inbound/outbound units.",
  "Container theft (inland)":
    "Tighten inland container custody handoffs and seal verification.",
  "Pilferage / seal tampering":
    "Reconcile seal numbers at every leg; flag broken or swapped seals.",
  "Fictitious pickup / fake carrier fraud":
    "Verify carrier identity and load tender against booking before release.",
  "Cargo diversion / misrouting":
    "Confirm delivery geofencing and exception alerts on the lane.",
  "Insider / driver collusion theft":
    "Review driver vetting and dual-control on high-value dispatch.",
  "Cargo documentation fraud":
    "Cross-check bills of lading and manifests against the consignee of record.",
  "Cargo theft in transit":
    "Track high-value loads in real time; secure overnight staging points.",
  "Port armed robbery":
    "Review armed-guard coverage and night-gate access controls at the named port.",
  "Anchorage robbery / theft":
    "Reinforce anchor watch and deck patrols during anchorage waits.",
  "Vessel boarding (robbery)":
    "Raise watch level and harden access points while alongside or at anchor.",
  "Theft from vessel at port":
    "Secure stores and deck equipment; log shore-side visitor access.",
  "Theft from container at port / terminal":
    "Spot-check seals and reconcile terminal custody for the affected lane.",
  "Port intrusion / trespass":
    "Inspect perimeter fencing and unmanned access points at the terminal.",
  "Stowaway incident":
    "Run stowaway searches before sailing; secure container and void spaces.",
  "Port-linked cargo smuggling":
    "Increase risk-based container scanning on the implicated route.",
  "Narcotics seizure (cargo / port)":
    "Apply enhanced screening to containers from the implicated origin.",
  "Weapons / contraband seizure (cargo / port)":
    "Flag the implicated shipper/route for enhanced inspection.",
  "Port sabotage / arson":
    "Review fire watch, surveillance and critical-asset protection at the port.",
  "Suspicious activity near port":
    "Log and report loitering/surveillance; brief gate and quay staff.",
  "Port-access blockade (cargo disruption)":
    "Plan alternate gates/routing; monitor access-road status before dispatch.",
  "Port labour unrest (cargo risk)":
    "Track industrial-action notices; pre-position priority cargo where possible.",
  "Truck park / access-road crime":
    "Use secured truck parks only; avoid the affected approach roads after dark.",
  "Arrest of cargo crime group":
    "Note the disrupted group/method; watch for displacement to nearby routes.",
};

export function deriveWatchItem(category: string): string | null {
  if (category === CARGO_FLOOR_LABEL || category === CARGO_NOT_RELEVANT) return null;
  return WATCH_ITEMS[category] ?? null;
}

// --- Top-level enrichment -------------------------------------------------

export function enrichCargoIncident(
  i: CargoEnrichmentInput,
  ctx: CargoEnrichmentContext = {},
): CargoEnrichment {
  const category = classifyCargoCategory(i);
  const group = cargoCategoryGroup(category);
  const impact = deriveImpact(i);
  const { portLocation, locationApproximate } = derivePortLocation(i);
  return {
    category,
    group,
    confidence: deriveConfidence(i, ctx),
    impactScore: impact.impactScore,
    impactLabel: impact.impactLabel,
    severityKey: impact.severityKey,
    status: deriveStatus(i, ctx),
    vessel: extractVessel(i),
    company: extractCompany(i),
    cargoType: extractCargoType(i),
    incidentTime: extractIncidentTime(i),
    portLocation,
    locationApproximate,
    watchItem: deriveWatchItem(category),
  };
}

// Render helper: a field's value or the strict "not reported." fallback.
export function displayCargoField(v: string | null | undefined): string {
  return v != null && v.trim() !== "" ? v : NOT_REPORTED;
}
