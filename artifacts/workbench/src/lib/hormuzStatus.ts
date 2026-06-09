// Strait of Hormuz — Chokepoint Status layer.
//
// The shipping dashboard previously read Hormuz status only from confirmed
// kinetic incidents (Attack / Seized / Near miss). That hides the elevated
// operating posture that surrounds the Strait even on quiet weeks — reduced
// transits, loitering tankers, GNSS/AIS interference, naval boarding and
// hailing, war-risk insurance moves, US-Iran framework talk, oil/LNG price
// reactions explicitly linked to Hormuz.
//
// This module classifies records under six indicator categories. The
// dashboard renders ALL six and only reports "No activity" if every category
// is empty. If kinetic is empty but traffic disruption is present, the
// status line shifts to the user-specified High-risk-environment wording.
//
// Keyword scope (per product brief):
//   Strait of Hormuz, Hormuz, SOH, Arabian Gulf, Persian Gulf, Gulf of Oman,
//   Sirik, Ras al-Hadd, Khorfakkan, Bandar Abbas, Hormozgan, IRGC,
//   GNSS / AIS interference, blockade, escort, war risk insurance, mine risk.

import { differenceInDays, parseISO } from "date-fns";
import {
  classifyVesselIncident,
  isLowCredibilityShippingRecord,
  type MaritimeRecordLike,
} from "./shippingAnalysis";

// --- Geographic / contextual scope -----------------------------------------
// A record is "Hormuz context" if it mentions a Hormuz-area location OR a
// contextual indicator that, on its own, places the record in the Hormuz
// theatre (IRGC, war risk insurance, mine risk). These last three were
// called out by the user explicitly.
export const HORMUZ_CONTEXT_RE =
  /\b(strait of hormuz|hormuz strait|hormuz|s\.?o\.?h\.?|arabian gulf|persian gulf|gulf of oman|sirik|ras al[- ]?hadd|khor[- ]?fakkan|bandar abbas|hormozgan|qeshm|larak|jask|fujairah|musandam|irgc(?:[- ]navy)?|war risk insurance|mine risk)\b/i;

function blob(i: MaritimeRecordLike): string {
  return `${i.title ?? ""} ${i.summary ?? ""} ${i.location ?? ""}`;
}

export function isHormuzContext(i: MaritimeRecordLike): boolean {
  return HORMUZ_CONTEXT_RE.test(blob(i));
}

// --- Six indicator categories ----------------------------------------------

export type HormuzCategoryKey =
  | "kinetic"
  | "traffic"
  | "navigation"
  | "posture"
  | "market"
  | "diplomatic";

export interface HormuzCategoryDef {
  key: HormuzCategoryKey;
  label: string;
  description: string;
  // Pattern applied after Hormuz-context has been established.
  pattern: RegExp;
}

export const HORMUZ_CATEGORIES: HormuzCategoryDef[] = [
  {
    key: "kinetic",
    label: "Confirmed kinetic incidents",
    description: "UKMTO / JMIC / IMO confirmed attack, near miss, seizure or boarding.",
    // Hostile-act pattern only. Bare UKMTO/JMIC/IMO advisory tokens are
    // deliberately excluded here — a routine UKMTO warning is operational
    // posture, not a confirmed kinetic incident, and would otherwise
    // suppress the "no new kinetic incident" headline. The full filter
    // (categoryMatches) additionally requires either a hostile vessel
    // classification OR explicit confirmation phrasing.
    pattern:
      /\b(hit|struck|attack(ed|s)?|missile|drone|fired (upon|at|on)|near miss|projectile|gunfire|seiz(ed|ure)|hijack(ed|ing)?|board(ed|ing) (by|of)|detained .{0,20}(vessel|tanker|ship|crew))\b/i,
  },
  {
    key: "traffic",
    label: "Traffic disruption",
    description: "Reduced transits, loitering vessels, anchorage congestion, delayed crossings.",
    // Operational-traffic anchors only. Generic "waiting" / "queue" without a
    // maritime object are intentionally excluded to avoid lifting non-traffic
    // commentary into the constrained-headline path.
    pattern:
      /\b(reduced transit|transit (down|drop|fall|decline|disrupt|disrupted|slowed|delayed|halted|paused|suspended)|loiter(ing)? (tankers?|vessels?|ships?|carriers?|vlccs?)|anchorage congestion|congestion (at|in) (anchorage|port|fujairah|khor[- ]?fakkan)|delayed crossing|delay(ed|s)? .{0,40}(transit|crossing|hormuz)|tanker queue|queue (at|of) (anchorage|tankers?|vlccs?|vessels?|ships?)|throughput (down|drop|fall|cut)|fewer .{0,20}transits?|traffic (slowed|halted|paused|suspended|down|reduced|constrained)|skipped .{0,20}hormuz|avoid(ing|ed) .{0,20}hormuz|reroute .{0,20}hormuz|diverting .{0,20}hormuz|tankers? (idl(e|ing)|loitering|waiting (off|outside|near) .{0,30}(hormuz|fujairah|khor[- ]?fakkan|anchorage)))\b/i,
  },
  {
    key: "navigation",
    label: "Navigation interference",
    description: "GNSS / GPS / AIS spoofing, jamming or outage; mine risk; signal disruption.",
    pattern:
      /\b(gnss (interference|spoof(ing)?|jam(ming)?|disrupt(ion)?|outage)|gps (jam(ming)?|spoof(ing)?|interfer(ence|ed)?|disrupt(ion)?|outage)|ais (interference|spoof(ing)?|jam(ming)?|disrupt(ion)?|outage|offline|dark|gap)|navigation (interference|disruption)|signal jam(ming)?|electronic warfare|spoof(ed|ing) (track|position|signal)|mine risk|mines? (in|near|threat|laid|sighted|drifting))\b/i,
  },
  {
    key: "posture",
    label: "Naval / security posture",
    description: "Blockade, escort, hailing, boarding, detention or threat reports.",
    pattern:
      /\b(blockad(e|ing|ed)|escort(s|ed|ing)?|hail(ed|ing|s)|board(ed|ing)|detain(ed|ing|ment)?|warning shot|threat (report|to shipping)|us navy|fifth fleet|combined task force|ctf[- ]?15[23]|naval patrol|coast guard|warship|irgc (navy|forces|patrol|speedboat|fast boat|seized|boarded|hailed)|guardship|maritime security (alert|advisory|threat|crisis)|maritime advisory|force protection|project freedom|us[- ]flagged escort|convoy escort)\b/i,
  },
  {
    key: "market",
    label: "Market indicators",
    description: "Oil, LNG, gas, freight or war-risk insurance moves explicitly linked to Hormuz.",
    pattern:
      /\b(brent|wti|crude (price|prices|futures?) (jumped|rose|fell|surged|spiked|up|down|climb)|oil (price|prices|futures?) (jumped|rose|fell|surged|spiked|up|down|climb)|lng (price|prices|futures?|cargo|spot|shipment)|gas (price|prices|futures?)|war risk (premium|insurance|zone|rate|surcharge)|insurance (premium|cost|surcharge|rate) .{0,40}(hormuz|tanker|gulf|persian|arabian)|freight (rate|cost) .{0,40}(hormuz|gulf|tanker|vlcc)|vlcc (rate|freight|charter|earnings|prices?)|tanker (rate|freight|earnings)|hull premium|p&i (club|premium) .{0,40}(hormuz|gulf|tanker))\b/i,
  },
  {
    key: "diplomatic",
    label: "Diplomatic indicators",
    description: "Ceasefire, reopening, escort, blockade or US-Iran framework reports.",
    pattern:
      /\b(ceasefire|reopen(ing|ed)?|nuclear (talks|deal|framework|negotiation)|jcpoa|us[- ]iran (talks|framework|deal|negotiation|backchannel|diplomacy)|sanction(s)? (lift|relief|waiver|imposed|tightened|snap[- ]?back)|de[- ]?escalation|escalation (warning|risk)|state department .{0,40}(iran|hormuz|gulf)|foreign minister .{0,40}(iran|hormuz|gulf|oman|qatar)|envoy .{0,40}(iran|hormuz|gulf)|qatar mediation|oman mediation|backchannel .{0,40}(iran|hormuz|gulf)|hostage (deal|release|swap) .{0,40}(iran|hormuz|gulf)|framework (agreement|deal) .{0,40}(iran|hormuz|gulf)|talks .{0,40}(iran|hormuz|gulf)|deal (reached|agreed) .{0,40}(iran|hormuz|gulf))\b/i,
  },
];

// --- Classification --------------------------------------------------------

type HormuzRecord = MaritimeRecordLike & {
  id?: string | number;
  occurredAt?: string | null;
  severity?: string | null;
  source?: string | null;
};

function isKineticConfirmed(i: HormuzRecord): boolean {
  // Kinetic requires either:
  //   (a) the strict hostile vessel classifier returns Attack / Near miss /
  //       Seized — that classifier already excludes commercial noise and
  //       diplomatic follow-up; or
  //   (b) the text contains an explicit confirmation phrasing (UKMTO/JMIC
  //       reports a NEW incident, vessel actually hit/struck/attacked).
  // Generic UKMTO / JMIC advisories or warnings on their own do NOT count —
  // those are operational posture, not a confirmed kinetic incident, and
  // would otherwise overwrite the "no new kinetic incident in the latest
  // reporting window" headline that the brief explicitly calls for.
  const v = classifyVesselIncident(i);
  if (v === "Attack" || v === "Near miss" || v === "Seized") return true;
  const text = blob(i);
  return /\b((ukmto|jmic) (reports?|confirms?) .{0,40}(incident|attack|seizure|hijack|board(ing|ed)|struck|hit)|confirmed (attack|seizure|hijack|boarding) .{0,40}(vessel|tanker|ship|carrier|dhow)|(vessel|tanker|ship|carrier) (hit|struck) by (missile|drone|projectile|gunfire))\b/i.test(text);
}

function categoryMatches(i: HormuzRecord, def: HormuzCategoryDef): boolean {
  if (!def.pattern.test(blob(i))) return false;
  if (def.key === "kinetic") return isKineticConfirmed(i);
  return true;
}

export interface HormuzCategoryResult {
  key: HormuzCategoryKey;
  label: string;
  description: string;
  count: number;
  recent: HormuzRecord[]; // up to 5, most recent first
  latest: HormuzRecord | null;
  latestDate: Date | null;
}

export type HormuzStatusTone =
  | "kinetic"      // new confirmed kinetic event in the window
  | "constrained"  // no kinetic but traffic is disrupted
  | "elevated"     // no kinetic, no traffic, but other indicators are active
  | "no-activity"; // all six categories empty

export interface HormuzStatus {
  windowDays: number;          // window used for the kinetic headline check
  categories: HormuzCategoryResult[];
  anyActivity: boolean;
  hasKineticInWindow: boolean;
  hasTraffic: boolean;
  tone: HormuzStatusTone;
  headline: string;            // short banner line
  detail: string;              // longer descriptive line
  activeCategoryLabels: string[];
}

export interface HormuzStatusOptions {
  // Window (days) used to decide whether the kinetic headline reads
  // "new kinetic incident" or "no new kinetic incident in the latest
  // reporting window". Records older than this are still listed under each
  // category (we want operating context, not just last-week noise) — but
  // they do not trigger the kinetic headline.
  kineticWindowDays?: number;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  try {
    const d = parseISO(v);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Score a dataset of maritime records and produce the Hormuz Chokepoint
 * Status object consumed by the dashboard.
 *
 * Pass the same list that feeds the rest of the shipping page (do NOT
 * pre-filter to APAC/Middle East — generic FT/Reuters market commentary
 * mentioning Hormuz often has no country or a US/UK byline country and
 * would otherwise be dropped).
 */
export function computeHormuzStatus(
  records: HormuzRecord[],
  opts: HormuzStatusOptions = {},
): HormuzStatus {
  const windowDays = opts.kineticWindowDays ?? 7;
  const now = new Date();

  // Drop repatriation / crew-return / social-handle / speculative-claim
  // records before scoring any of the six indicator categories. Without
  // this filter, the `posture` pattern (which includes "detained") and the
  // `kinetic` pattern (which includes "seized") would both fire on
  // "US-seized vessels repatriated"-style follow-ups and contradict the
  // "no new kinetic incident" headline.
  const credible = records.filter((r) => !isLowCredibilityShippingRecord(r));
  const scoped = credible.filter((r) => isHormuzContext(r));

  const categories: HormuzCategoryResult[] = HORMUZ_CATEGORIES.map((def) => {
    const matches = scoped.filter((r) => categoryMatches(r, def));
    const sorted = [...matches].sort((a, b) => {
      const da = parseDate(a.occurredAt)?.getTime() ?? 0;
      const db = parseDate(b.occurredAt)?.getTime() ?? 0;
      return db - da;
    });
    const latest = sorted[0] ?? null;
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      count: sorted.length,
      recent: sorted.slice(0, 5),
      latest,
      latestDate: latest ? parseDate(latest.occurredAt) : null,
    };
  });

  const byKey = (k: HormuzCategoryKey) => categories.find((c) => c.key === k)!;
  const kinetic = byKey("kinetic");
  const traffic = byKey("traffic");

  const hasKineticInWindow = kinetic.recent.some((r) => {
    const d = parseDate(r.occurredAt);
    if (!d) return false;
    return differenceInDays(now, d) <= windowDays;
  });

  const activeCategoryLabels = categories.filter((c) => c.count > 0).map((c) => c.label);
  const anyActivity = activeCategoryLabels.length > 0;
  const hasTraffic = traffic.count > 0;

  let tone: HormuzStatusTone;
  let headline: string;
  let detail: string;

  if (!anyActivity) {
    tone = "no-activity";
    headline = "No activity.";
    detail = "No records in any of the six Hormuz indicator categories in the loaded window.";
  } else if (hasKineticInWindow) {
    tone = "kinetic";
    const n = kinetic.count;
    headline = "Active kinetic environment.";
    detail = `${n} confirmed kinetic record${n === 1 ? "" : "s"} in the Hormuz theatre, with ${activeCategoryLabels.length} of six indicator categories active. Treat the chokepoint as live.`;
  } else if (hasTraffic) {
    tone = "constrained";
    headline = "High-risk operating environment.";
    detail = "No new confirmed attack in the latest reporting period, but traffic remains constrained and security and insurance conditions remain abnormal.";
  } else {
    tone = "elevated";
    headline = "Elevated chokepoint signal.";
    const others = activeCategoryLabels.join("; ");
    detail = `No new attack or traffic restriction in the latest period, but ${others} indicator${activeCategoryLabels.length === 1 ? " is" : "s are"} active. Standing exposure to the Strait remains.`;
  }

  return {
    windowDays,
    categories,
    anyActivity,
    hasKineticInWindow,
    hasTraffic,
    tone,
    headline,
    detail,
    activeCategoryLabels,
  };
}

// Brand palette only. Subdued red #A33232 is reserved for kinetic-active
// (mirrors the "Extreme" tier convention). Other tones cycle through the
// approved Midnight / Electric / Dusk colours.
export const HORMUZ_TONE_COLOR: Record<HormuzStatusTone, string> = {
  kinetic: "#A33232",
  constrained: "#0B0B3D",
  elevated: "#4655FF",
  "no-activity": "#303030",
};
