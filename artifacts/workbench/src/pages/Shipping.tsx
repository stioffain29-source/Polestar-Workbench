import { useMemo, useState } from "react";
import {
  useListIncidents,
  useListLatestMaritimeMovement,
  useListMaritimeSecurityEvents,
  createMaritimeMovement,
  getListLatestMaritimeMovementQueryKey,
  getListMaritimeMovementQueryKey,
} from "@workspace/api-client-react";
import type { Incident, MaritimeMovementInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { format, differenceInDays, parseISO, startOfDay } from "date-fns";
import {
  BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  LineChart, Line, LabelList,
} from "recharts";
import { severityBadgeStyle, ratingColor, SEVERITY_LEVELS, SEVERITY_LABELS } from "@/lib/topics";
import { deriveIncidentCountry, deriveFlagState, LOCATION_NOT_IDENTIFIED } from "@/lib/shippingCountry";
import {
  CHOKEPOINTS, detectChokepoints, classifyPiracy,
  type PiracyAct,
  classifyRegion, REGION_COLOR, type Region,
  classifyIssue, ISSUE_PALETTE,
  classifyVesselIncident, type VesselIncidentType, VESSEL_ACCENT,
  TRANSIT_ISSUES, COMMERCIAL_ISSUES,
  isLowCredibilityShippingRecord, isCapabilityContext,
} from "@/lib/shippingAnalysis";
import { computeHormuzStatus, HORMUZ_TONE_COLOR, type HormuzCategoryResult, type HormuzStatusTone } from "@/lib/hormuzStatus";
import { dedupeShippingMonitorRows } from "@/lib/shippingReportDataset";
import { RangeToggle } from "@/components/RangeToggle";
import { RANGE_DAYS, RANGE_LABEL, type RangeKey } from "@/lib/dateRange";
import { ExternalLink } from "lucide-react";
import { incidentSourceUrl } from "@/lib/incidentSourceUrl";
import VesselMap from "@/components/VesselMap";
import {
  buildMaritimeIntelligence,
  formatMovementSummary,
  MARITIME_RISK_COLOR,
  type MaritimeRiskLevel,
  type MaritimeIntelligence,
  type ChokepointCard,
  type LatestIncident,
} from "@/lib/maritimeIntelligence";
import {
  buildMaritimeSecuritySummary,
  maritimeTypeColor,
  MARITIME_SECURITY_SOURCE_LABEL,
  MARITIME_SECURITY_SOURCE_PAGE,
} from "@/lib/maritimeSecurity";

const NOT_IDENTIFIED = LOCATION_NOT_IDENTIFIED;

// Region / issue / vessel classifiers are now imported from
// `@/lib/shippingAnalysis` so the Shipping page and the Shipping report PDF
// share one source of truth and never drift.

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};

const FILL_OPACITY = 0.78;
const STROKE_WIDTH = 1.5;

// --- Methodology --------------------------------------------------------------
// Plain-language definitions for every term the dashboard asserts, derived
// directly from the shared classifiers in shippingAnalysis.ts / hormuzStatus.ts
// so the stated methodology and the computed numbers can never drift.
const SHIPPING_DEFINITIONS: { term: string; def: string }[] = [
  {
    term: "Shipping record",
    def: "One de-duplicated maritime news item scoped to APAC or the Middle East that passes the credibility screen. Social-media handles, repatriation / crew-welfare follow-ups, speculative or unverified claims, pure commentary, rhetorical closure threats and media-packaging headlines are excluded. Syndicated copies are collapsed: identical headlines merge regardless of date, reworded copies of one event merge within a date-and-keyword signature, and re-reports of a single vessel event cluster across a few days — keeping the most severe / most recent version.",
  },
  {
    term: "Significant incident",
    def: "The most recent record rated High or Extreme; if none is on file, the most recent credible record. Repatriation, social-handle, speculative-claim and capability / procurement / exercise items are filtered out before the pick, so none can become the significant incident.",
  },
  {
    term: "Chokepoint risk",
    def: "A record naming one of six tracked chokepoints (Strait of Hormuz, Gulf of Oman, Arabian / Persian Gulf, Red Sea, Bab el-Mandeb, Malacca). The Strait of Hormuz additionally requires an operational maritime term, so a bare 'Hormuz' mention in a price or policy headline does not qualify; the other five match on a named mention.",
  },
  {
    term: "Vessel attack / seizure",
    def: "A confirmed hostile act against a specific vessel — attack, near miss, or seizure / hijack — per the strict vessel classifier. Commercial, finance, regulatory and diplomatic-follow-up items are excluded. This counts a confirmed event, not a claim of one.",
  },
  {
    term: "Piracy / armed robbery",
    def: "Hostile activity against vessels or crew at sea or at anchorage: piracy, armed robbery, boarding or attempted boarding, suspicious or small-craft approach, hijacking, crew threat, and theft from a vessel. Land and warehouse cargo theft is tracked under Cargo Watch, not here.",
  },
  {
    term: "Active kinetic environment",
    def: "A status reserved for one or more confirmed kinetic incidents (attack, near miss, seizure or boarding — by the strict vessel classifier or explicit UKMTO / JMIC confirmation) in the Strait of Hormuz theatre within the last 7 days. Routine advisories, naval posture, market, insurance and diplomatic reporting never trigger it.",
  },
];

// Status thresholds for the Strait of Hormuz banner. The banner tone is chosen
// strictly by these rules — no strong language is shown unless its threshold is
// met. Mirrors the branching in computeHormuzStatus().
const HORMUZ_STATUS_THRESHOLDS: { tone: HormuzStatusTone; label: string; rule: string }[] = [
  { tone: "kinetic", label: "Active kinetic environment", rule: "≥1 confirmed kinetic incident in the last 7 days." },
  { tone: "constrained", label: "High-risk operating environment", rule: "No kinetic incident in the last 7 days, but traffic disruption is on file." },
  { tone: "elevated", label: "Elevated chokepoint signal", rule: "No kinetic incident or traffic disruption, but ≥1 other indicator (navigation, posture, market, diplomatic) is active." },
  { tone: "no-activity", label: "No activity", rule: "All six indicator categories are empty in the loaded window." },
];

// Hormuz indicator categories split into confirmed incidents vs context.
const HORMUZ_CONFIRMED_KEYS = new Set(["kinetic"]);

function darken(hex: string, amount = 0.18): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export default function Shipping() {
  const { data: incidents = [], isLoading } = useListIncidents({ topic: "shipping" });
  // Movement (AIS) CONTEXT — latest snapshot per theatre. Empty until a
  // licensed-provider row is uploaded; the board degrades to "movement data
  // unavailable" rather than inventing numbers.
  const { data: movement = [] } = useListLatestMaritimeMovement();
  // ICC CCS / IMB maritime-security events — a STANDALONE reference source
  // (current calendar year). These rows live in their own table and are NEVER
  // mixed into the incident pool above, so they can never inflate any count.
  const { data: maritimeSecurityEvents = [] } = useListMaritimeSecurityEvents({
    limit: 500,
  });

  // Date-range window. Defaults to the widest option so the first load shows the
  // full record set; the analyst narrows the whole dashboard from the header.
  const [range, setRange] = useState<RangeKey>("2y");
  const windowDays = RANGE_DAYS[range];
  const now = useMemo(() => new Date(), []);

  // Maritime Intelligence board — ONE shared deterministic dataset (also used by
  // the Shipping Watch report). Always a 7-day weekly assessment regardless of
  // the range toggle above, so the BLUF/risk read as a current weekly picture.
  // Movement is CONTEXT only; it never becomes or inflates an incident here.
  const maritimeBoard = useMemo(
    () => buildMaritimeIntelligence({ incidents, movement, windowDays: 7, asOf: now }),
    [incidents, movement, now],
  );

  // Scope: APAC + Middle East only. Records that classify to a country outside
  // those regions are dropped from this view. Records with no identifiable
  // country are kept and surfaced as "Country not identified".
  const allEnriched = useMemo(
    () => incidents.map((i) => {
      const incidentCountry = deriveIncidentCountry(i);
      const flagState = deriveFlagState(i);
      return {
        ...i,
        incidentCountry,
        flagState,
        // Region is classified from the *incident* country, not from the raw
        // `country` field, so flag-state-only records do not get bucketed into
        // the wrong region.
        region: classifyRegion(incidentCountry),
        issue: classifyIssue(i),
        occurredDate: (() => { try { return parseISO(i.occurredAt); } catch { return new Date(NaN); } })(),
      };
    }),
    [incidents],
  );
  const outOfScopeCount = allEnriched.filter((i) => i.region === "Out of scope").length;

  // The monitor renders the SAME cleaned + deduplicated dataset the Shipping
  // report produces, so the two surfaces can never disagree. Pipeline:
  //   1. scope to APAC + Middle East (drop Out of scope);
  //   2. drop noise via `isLowCredibilityShippingRecord` (social handles,
  //      repatriation / crew-return, speculative claims, generic commentary);
  //   3. collapse syndication via `dedupeShippingMonitorRows` — the same wire
  //      story republished under five or six headlines on the same day becomes
  //      a single row, keeping the most severe / most recent version.
  // Every count and card on this page is therefore one-event-one-row, not raw
  // wire volume, and a single event can never show as both Extreme and Low.
  const inScopeClean = useMemo(
    () =>
      allEnriched
        .filter((i) => i.region !== "Out of scope")
        .filter((i) => !isLowCredibilityShippingRecord(i)),
    [allEnriched],
  );
  // All-time cleaned + deduped in-scope set (pre-window). Windowing is applied
  // on top of this so the dedupe always runs over the full record set first.
  const enrichedAll = useMemo(
    () => dedupeShippingMonitorRows(inScopeClean),
    [inScopeClean],
  );
  // `enriched` is the windowed working set that drives every range-scoped
  // surface (KPIs, charts, region/issue/country mixes, chokepoint, vessel,
  // piracy, map, table). No lower bound so the widest default never hides a
  // record the all-time view used to show.
  const enriched = useMemo(
    () =>
      enrichedAll.filter(
        (i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= windowDays,
      ),
    [enrichedAll, windowDays, now],
  );
  // `cleanEnriched` is retained as an alias so the analyst-narrative surfaces
  // (Latest Significant Incident, Chokepoint Watch, Vessel / Piracy tables)
  // keep their names; cleaned + deduped + windowed is the single base.
  const cleanEnriched = enriched;
  // Pre-region-filter clean + deduped set — feeds the Strait of Hormuz status
  // indicators, which intentionally read across regions (FT / Reuters US
  // bylines etc.) rather than the APAC + ME scope. Also windowed so the banner
  // reflects the selected range.
  const cleanAllEnriched = useMemo(
    () =>
      dedupeShippingMonitorRows(
        allEnriched.filter((i) => !isLowCredibilityShippingRecord(i)),
      ).filter(
        (i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= windowDays,
      ),
    [allEnriched, windowDays, now],
  );

  const total = enriched.length;

  // `last7`/`last30` are FIXED-PERIOD deltas (the caption literally says "in the
  // past 7/30 days"), so they read the all-time `enrichedAll`, NOT the windowed
  // `enriched`. Otherwise a 24h/7d selection would cap "past 30 days" at the
  // narrower window and the caption would lie.
  const last7 = useMemo(
    () => enrichedAll.filter((i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= 7).length,
    [enrichedAll, now],
  );
  const last30 = useMemo(
    () => enrichedAll.filter((i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= 30).length,
    [enrichedAll, now],
  );

  // Region chart shows only the two real theatres. "Country not identified"
  // is excluded — it was an unlabelled bar that dwarfed the meaningful regions
  // and told the analyst nothing about where activity was occurring; the
  // unattributed count is surfaced as a caption under the chart instead.
  const byRegion = useMemo(() => {
    const m = new Map<Region, number>([
      ["Middle East", 0],
      ["APAC", 0],
    ]);
    enriched.forEach((i) => {
      if (i.region !== "Middle East" && i.region !== "APAC") return;
      m.set(i.region, (m.get(i.region) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([region, count]) => ({ region, count }));
  }, [enriched]);

  const byIssue = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((i) => m.set(i.issue, (m.get(i.issue) ?? 0) + 1));
    return Array.from(m.entries()).map(([issue, count]) => ({ issue, count })).sort((a, b) => b.count - a.count);
  }, [enriched]);

  const notIdentifiedCount = useMemo(
    () => enriched.filter((i) => i.incidentCountry === null).length,
    [enriched],
  );

  const byCountry = useMemo(() => {
    // Uses the incident-location country only. Flag state is never counted
    // here — that would mis-attribute a Greek-flagged tanker hit in the Gulf
    // of Oman to Greece.
    const m = new Map<string, number>();
    enriched.forEach((i) => {
      if (i.incidentCountry === null) return;
      m.set(i.incidentCountry, (m.get(i.incidentCountry) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [enriched]);

  const bySeverity = useMemo(() => SEVERITY_LEVELS.map((s) => ({
    severity: s,
    label: SEVERITY_LABELS[s] ?? s,
    count: enriched.filter((i) => i.severity === s).length,
  })), [enriched]);

  const withCoords = enriched.filter((i) => i.latitude != null && i.longitude != null);

  // Timeline — bucket by day for the last 30 days that have records, fall back
  // to grouping the whole dataset by day if there aren't enough recent rows.
  const timeline = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((i) => {
      if (isNaN(i.occurredDate.getTime())) return;
      const d = startOfDay(i.occurredDate);
      const k = format(d, "yyyy-MM-dd");
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([date, count]) => ({ date, label: format(parseISO(date), "dd MMM"), count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [enriched]);

  // Fast Facts — short narrative-style cards.
  const meCount = byRegion.find((r) => r.region === "Middle East")?.count ?? 0;
  const apCount = byRegion.find((r) => r.region === "APAC")?.count ?? 0;

  const mainRegion = useMemo(() => {
    // Only rank real regions — "Country not identified" is excluded because
    // it tells the reader nothing about where the activity is occurring.
    const ranked = byRegion
      .filter((r) => r.region === "Middle East" || r.region === "APAC")
      .sort((a, b) => b.count - a.count);
    const top = ranked[0];
    if (!top || top.count === 0) return null;
    return top;
  }, [byRegion]);

  // Concrete location data — the single most-affected incident country
  // (not the coarse APAC/Middle East bucket). "Country not identified" is
  // already excluded by byCountry, so this only surfaces real attribution.
  const mainCountry = byCountry[0] ?? null;

  const mainIssue = byIssue[0] ?? null;

  const highestSev = useMemo(() => {
    let key = "";
    let rank = 0;
    enriched.forEach((i) => {
      const r = SEV_RANK[i.severity] ?? 0;
      if (r > rank) { rank = r; key = i.severity; }
    });
    return key;
  }, [enriched]);

  const highestSevCount = highestSev ? enriched.filter((i) => i.severity === highestSev).length : 0;

  const latestSignificant = useMemo(() => {
    // Strict exclusion: repatriation / crew-return / social-handle /
    // speculative-claim records are never eligible. If the cleaned pool
    // is empty the card reads "—" rather than silently surfacing a
    // human-interest follow-up.
    const sortedClean = [...cleanEnriched]
      .filter((i) => !isNaN(i.occurredDate.getTime()))
      .filter((i) => !isCapabilityContext(i))
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
    return (
      sortedClean.find((i) => i.severity === "extreme" || i.severity === "high")
      ?? sortedClean[0]
      ?? null
    );
  }, [cleanEnriched]);

  // Vessels Attacked — derive from the cleaned in-scope list so social-media
  // handles and human-interest follow-ups can never surface as hostile
  // vessel incidents. (classifyVesselIncident already rejects repatriation
  // / crew-return text; this drop also catches handle-style titles whose
  // text alone would otherwise pass the regex.)
  const vesselIncidents = useMemo(() => {
    return cleanEnriched
      .map((i) => ({ ...i, vesselType: classifyVesselIncident(i) }))
      .filter((i): i is typeof i & { vesselType: VesselIncidentType } => i.vesselType !== null)
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
  }, [cleanEnriched]);
  const vesselCounts = useMemo(() => {
    const c: Record<VesselIncidentType, number> = { Attack: 0, "Near miss": 0, Seized: 0, Threat: 0 };
    for (const v of vesselIncidents) c[v.vesselType]++;
    return c;
  }, [vesselIncidents]);

  // Daily Intelligence Summary derivations.
  // Source: the same `enriched` array that feeds the rest of the Shipping
  // page (charts, vessel attacks, recent incidents). No artificial 7-day
  // narrowing here — when no shipping records arrived in the last week the
  // buckets were going blank even though matching records were visible
  // elsewhere on the page.
  const sortedEnriched = useMemo(
    () =>
      [...enriched]
        .filter((i) => !isNaN(i.occurredDate.getTime()))
        .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime()),
    [enriched],
  );
  // Cleaned + date-sorted version. Used by Chokepoint Watch ("latest"
  // record per chokepoint must not be a repatriation row) and by Piracy.
  const sortedCleanEnriched = useMemo(
    () =>
      [...cleanEnriched]
        .filter((i) => !isNaN(i.occurredDate.getTime()))
        .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime()),
    [cleanEnriched],
  );

  // TRANSIT_ISSUES / COMMERCIAL_ISSUES come from shippingAnalysis.ts so the
  // Shipping page and the Shipping report PDF share one vocabulary.
  const transitRecords = sortedEnriched.filter(
    (i) => TRANSIT_ISSUES.has(i.issue) || detectChokepoints(i).length > 0,
  );
  const commercialRecords = sortedEnriched.filter((i) => COMMERCIAL_ISSUES.has(i.issue));

  // --- Chokepoint Watch ---------------------------------------------------
  // For each chokepoint: count, highest severity, latest incident, short
  // operational read. We do NOT invent rows — if a chokepoint has nothing on
  // file in the window the row reads "No current records in selected window".
  const chokepointRows = useMemo(() => {
    return CHOKEPOINTS.map((cp) => {
      const records = sortedCleanEnriched.filter((i) => detectChokepoints(i).includes(cp));
      if (records.length === 0) {
        return { key: cp, count: 0, highestSev: "", latest: null as typeof records[0] | null, records };
      }
      let hk = "";
      let hr = 0;
      records.forEach((r) => {
        const rank = SEV_RANK[r.severity] ?? 0;
        if (rank > hr) { hr = rank; hk = r.severity; }
      });
      return { key: cp, count: records.length, highestSev: hk, latest: records[0], records };
    });
  }, [sortedEnriched]);

  const mainChokepoint = useMemo(() => {
    const ranked = chokepointRows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
    return ranked[0] ?? null;
  }, [chokepointRows]);

  // --- Strait of Hormuz Chokepoint Status ---------------------------------
  // Reads from `allEnriched` (pre-region-filter) so generic market or
  // diplomatic commentary tagged with a non-APAC/Middle-East country (FT,
  // Reuters US byline, etc.) still feeds the market / diplomatic indicators.
  // The kinetic headline uses a 7-day window so "no new kinetic incident in
  // the latest reporting window" reflects the active week, while category
  // counts cover the entire loaded window.
  const hormuzStatus = useMemo(
    () => computeHormuzStatus(cleanAllEnriched, { kineticWindowDays: Math.min(7, windowDays) }),
    [cleanAllEnriched, windowDays],
  );

  // --- Piracy and Armed Robbery -------------------------------------------
  // classifyPiracy already rejects repatriation/crew-return text; we also
  // drop social-handle / speculative-claim records up front via the cleaned
  // pool so this surface stays symmetric with Vessel Attacks.
  const piracyIncidents = useMemo(() => {
    return sortedCleanEnriched
      .map((i) => ({ ...i, piracyAct: classifyPiracy(i) }))
      .filter((i): i is typeof i & { piracyAct: PiracyAct } => i.piracyAct !== null);
  }, [sortedCleanEnriched]);

  // Vessel attack / seizure count (excludes piracy — that has its own count).
  const vesselAttackOrSeizureCount = useMemo(
    () => vesselIncidents.filter((v) => v.vesselType === "Attack" || v.vesselType === "Seized").length,
    [vesselIncidents],
  );

  // ICC CCS / IMB maritime-security events for the current window. Standalone
  // reference layer — windowed by the same range toggle as the rest of the page
  // for consistency, but it never feeds any incident count.
  const maritimeSecurity = useMemo(() => {
    const windowStart =
      windowDays === null
        ? null
        : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    return buildMaritimeSecuritySummary(maritimeSecurityEvents, {
      windowStart,
      limit: 40,
    });
  }, [maritimeSecurityEvents, windowDays]);

  // Page render
  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* 1. Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Shipping</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1 max-w-4xl">
            Port disruption, chokepoint risk, vessel attacks, route diversion, shipping delays, insurance pressure, naval advisories, port strikes and cargo movement disruption. APAC and the Middle East only — records from other regions are excluded. Cargo theft and pilferage are tracked under Cargo Watch.
          </p>
        </div>
        <RangeToggle range={range} onChange={setRange} />
      </div>

      {/* 1a. Maritime Intelligence board — shared with the Shipping Watch report */}
      <MaritimeIntelligenceBoard board={maritimeBoard} />

      {/* 1a-i. Admin-gated manual upload for movement (AIS) context. */}
      <MaritimeMovementUploadForm hasMovement={movement.length > 0} />

      {outOfScopeCount > 0 && (
        <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-sm px-3 py-2">
          {outOfScopeCount} shipping record{outOfScopeCount === 1 ? "" : "s"} from outside APAC and the Middle East (e.g. North America, Europe, Africa, South America) are excluded from this view.
        </div>
      )}

      {/* 1b. Methodology & Definitions */}
      <Section title="Methodology & Definitions">
        <details className="bg-white border border-border rounded-sm">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-sans text-primary">
            How this monitor defines its terms, windows, categories and status thresholds.
          </summary>
          <div className="px-4 pb-4 pt-1 space-y-4">
            {/* Definitions */}
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">Definitions</div>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {SHIPPING_DEFINITIONS.map((d) => (
                  <div key={d.term}>
                    <dt className="font-serif font-bold text-sm text-primary">{d.term}</dt>
                    <dd className="text-[12px] text-foreground/80 font-sans leading-snug mt-0.5">{d.def}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Category model: exclusive vs overlapping */}
            <div className="border-t border-border pt-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">Category model</div>
              <p className="text-[12px] text-foreground/80 font-sans leading-snug">
                <span className="font-semibold text-primary">Mutually exclusive</span> — each record carries exactly one
                Issue Type, one Region and one Severity tier. These totals are additive and sum to the record count.
              </p>
              <p className="text-[12px] text-foreground/80 font-sans leading-snug mt-1.5">
                <span className="font-semibold text-primary">Overlapping by design</span> — Vessel Attacks, Piracy / Armed
                Robbery, the per-chokepoint counts and the six Strait of Hormuz indicators are lenses over the same records,
                so one incident can appear in more than one (a tanker attack in Hormuz shows under Vessel Attacks, the
                Hormuz confirmed-kinetic indicator and the Hormuz chokepoint row). Counts across these lenses are
                therefore not additive with the Issue Type totals.
              </p>
            </div>

            {/* Confirmed vs contextual */}
            <div className="border-t border-border pt-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">Confirmed incidents vs contextual indicators</div>
              <p className="text-[12px] text-foreground/80 font-sans leading-snug">
                <span className="font-semibold text-primary">Confirmed incidents</span> — vessel attacks / seizures,
                piracy / armed robbery, and confirmed kinetic events. <span className="font-semibold text-primary">Contextual
                indicators (not incidents)</span> — traffic disruption, navigation interference, naval / security posture,
                market moves, insurance pressure, and diplomatic / advisory reporting. Strong status language is driven
                only by confirmed incidents crossing a stated threshold below; context can raise the posture but never, on
                its own, declares an active kinetic environment.
              </p>
            </div>

            {/* Status thresholds */}
            <div className="border-t border-border pt-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">Strait of Hormuz status thresholds</div>
              <ul className="space-y-1">
                {HORMUZ_STATUS_THRESHOLDS.map((t) => (
                  <li key={t.label} className="text-[12px] font-sans leading-snug">
                    <span className="font-semibold text-primary">{t.label}</span>
                    <span className="text-foreground/80"> — {t.rule}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Confidence & sources */}
            <div className="border-t border-border pt-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">Confidence & sources</div>
              <p className="text-[12px] text-foreground/80 font-sans leading-snug">
                Every displayed record passes the credibility screen and links to its source where one is available;
                items without a source link are marked. Severity tiers are assigned automatically from the report text,
                with Extreme reserved for confirmed mass-casualty or major physical-disruption events. Where no value can
                be derived (location, flag state, severity), the monitor states it plainly rather than inventing one.
              </p>
            </div>
          </div>
        </details>
      </Section>

      {/* 2. Fast Facts */}
      <Section title="Fast Facts">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <FastFactCard
            label="Total Shipping Records"
            value={String(total)}
            note={`${last7} in the past 7 days · ${last30} in the past 30 days.`}
            accent="#465bff"
            window={`Last ${RANGE_LABEL[range]}`}
          />
          <FastFactCard
            label="Highest Severity On File"
            value={highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"}
            note={
              highestSev
                ? `${highestSevCount} record${highestSevCount === 1 ? "" : "s"} at this rating in the window.`
                : "No severity recorded."
            }
            accent={highestSev ? ratingColor(highestSev) : "#B8C2CC"}
            window={`Last ${RANGE_LABEL[range]}`}
          />
          <FastFactCard
            label="Main Affected Country"
            value={mainCountry ? mainCountry.country : "—"}
            note={
              mainCountry
                ? `${mainCountry.count} of ${total} shipping records map to this country${mainRegion ? ` (${mainRegion.region})` : ""}.`
                : "No country-level attribution available."
            }
            accent={mainCountry ? REGION_COLOR[classifyRegion(mainCountry.country)] : "#B8C2CC"}
            window={`Last ${RANGE_LABEL[range]}`}
          />
          <FastFactCard
            label="Main Issue Type"
            value={mainIssue ? mainIssue.issue : "—"}
            note={
              mainIssue
                ? `${mainIssue.count} record${mainIssue.count === 1 ? "" : "s"} classified as ${mainIssue.issue.toLowerCase()}.`
                : "No issue classification available."
            }
            accent="#0b0a3d"
            window={`Last ${RANGE_LABEL[range]}`}
          />
          <FastFactCard
            label="Latest Significant Incident"
            value={latestSignificant ? format(latestSignificant.occurredDate, "dd MMM yyyy") : "—"}
            note={
              latestSignificant
                ? `${latestSignificant.title} (${latestSignificant.incidentCountry ?? NOT_IDENTIFIED}).`
                : "No significant shipping incident on record."
            }
            accent={latestSignificant ? ratingColor(latestSignificant.severity) : "#B8C2CC"}
            window="Most recent High/Extreme"
          />
        </div>
      </Section>

      {/* 3. Key Metrics */}
      <Section title="Key Metrics">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Total Records" value={total} accent="#0b0a3d" window={`Last ${RANGE_LABEL[range]}`} />
          <Kpi
            label="Highest Severity"
            value={highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"}
            accent={highestSev ? ratingColor(highestSev) : "#B8C2CC"}
            small
            window={`Last ${RANGE_LABEL[range]}`}
          />
          <Kpi
            label="Main Affected Chokepoint"
            value={mainChokepoint ? mainChokepoint.key : (mainRegion?.region ?? "—")}
            accent={mainChokepoint ? "#0b0a3d" : (mainRegion ? REGION_COLOR[mainRegion.region] : "#B8C2CC")}
            small
            window={`Last ${RANGE_LABEL[range]}`}
          />
          <Kpi label="Vessel Attacks / Seizures" value={vesselAttackOrSeizureCount} accent="#C0392B" window={`Confirmed · last ${RANGE_LABEL[range]}`} />
          <Kpi label="Piracy / Armed Robbery" value={piracyIncidents.length} accent="#E67E22" window={`Confirmed · last ${RANGE_LABEL[range]}`} />
          <Kpi
            label="Latest Significant Incident"
            value={latestSignificant ? format(latestSignificant.occurredDate, "dd MMM yyyy") : "—"}
            accent={latestSignificant ? ratingColor(latestSignificant.severity) : "#B8C2CC"}
            small
            window="Most recent High/Extreme"
          />
        </div>
      </Section>

      {/* 3a-pre. Strait of Hormuz — Chokepoint Status (six-indicator layer) */}
      <Section title="Strait of Hormuz — Chokepoint Status">
        <p className="text-xs text-muted-foreground font-sans -mt-1 mb-3">
          Layered read across six indicator categories. The chokepoint can read elevated even when no new attacks land in the latest week — traffic disruption, navigation interference, naval posture, market reaction and diplomatic signal all count.
        </p>
        <div
          className="rounded-sm border p-4 mb-3"
          style={{
            backgroundColor: "#FFFFFF",
            borderColor: HORMUZ_TONE_COLOR[hormuzStatus.tone],
            borderLeftWidth: 4,
          }}
        >
          <div
            className="font-serif font-bold text-base mb-1"
            style={{ color: HORMUZ_TONE_COLOR[hormuzStatus.tone] }}
          >
            {hormuzStatus.headline}
          </div>
          <div className="text-sm font-sans" style={{ color: "#303030" }}>
            {hormuzStatus.detail}
          </div>
          {hormuzStatus.anyActivity && (
            <div className="text-[11px] font-sans uppercase tracking-wider mt-2" style={{ color: "#303030" }}>
              {hormuzStatus.activeCategoryLabels.length} of 6 categories active
              {hormuzStatus.hasKineticInWindow
                ? " · new kinetic incident in last 7 days"
                : " · no new kinetic incident in last 7 days"}
            </div>
          )}
          <div className="text-[11px] font-sans mt-2 pt-2 border-t" style={{ color: "#303030", borderColor: "#E2E2E2" }}>
            <span className="uppercase tracking-wider font-semibold">Trigger</span>{" "}
            {HORMUZ_STATUS_THRESHOLDS.find((t) => t.tone === hormuzStatus.tone)?.rule
              ?? "Status derived from the loaded indicator window."}{" "}
            Thresholds are listed in Methodology &amp; Definitions above.
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">
          Confirmed incidents
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {hormuzStatus.categories
            .filter((cat) => HORMUZ_CONFIRMED_KEYS.has(cat.key))
            .map((cat) => (
              <HormuzCategoryCard key={cat.key} cat={cat} />
            ))}
        </div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">
          Contextual indicators — not confirmed incidents
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {hormuzStatus.categories
            .filter((cat) => !HORMUZ_CONFIRMED_KEYS.has(cat.key))
            .map((cat) => (
              <HormuzCategoryCard key={cat.key} cat={cat} />
            ))}
        </div>
      </Section>

      {/* 3a. Chokepoint Watch */}
      <Section title="Chokepoint Watch">
        <p className="text-xs text-muted-foreground font-sans -mt-1 mb-2">
          Operational read by chokepoint. Counts, highest severity and latest record are derived directly from the loaded shipping window. Rows with nothing on file are marked plainly and not invented.
        </p>
        <div className="bg-white border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-2 font-sans font-medium w-[200px]">Chokepoint</th>
                <th className="text-left p-2 font-sans font-medium w-[80px]">Records</th>
                <th className="text-left p-2 font-sans font-medium w-[120px]">Highest Severity</th>
                <th className="text-left p-2 font-sans font-medium w-[140px]">Latest</th>
                <th className="text-left p-2 font-sans font-medium">Operational Read</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {chokepointRows.map((row) => (
                <tr key={row.key} className="hover:bg-muted/30 align-top">
                  <td className="p-2 font-serif font-bold text-primary">{row.key}</td>
                  <td className="p-2 font-mono">{row.count}</td>
                  <td className="p-2">
                    {row.highestSev ? (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(row.highestSev)}>
                        {SEVERITY_LABELS[row.highestSev] ?? row.highestSev}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="p-2 text-xs font-mono whitespace-nowrap">
                    {row.latest && !isNaN(row.latest.occurredDate.getTime())
                      ? format(row.latest.occurredDate, "dd MMM yyyy")
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-xs text-foreground/80">
                    {row.count === 0
                      ? <span className="italic text-muted-foreground">No current records in selected window.</span>
                      : `Latest item: ${row.latest!.title}. (${row.count} record${row.count === 1 ? "" : "s"} in window.)`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 3b. Vessel Attacks — strict hostile-only subset */}
      <Section title="Vessel Attacks">
        <p className="text-xs text-muted-foreground font-sans -mt-1 mb-2">
          Hostile maritime incidents affecting vessels in the Strait of Hormuz, Arabian Gulf and Gulf of Oman. Limited to attacks, near misses, seizures and credible threats — general freight, port congestion, finance, partnerships and cargo theft are excluded. Cargo theft and pilferage remain in Cargo Watch.
        </p>
        {vesselIncidents.length === 0 ? (
          <div className="bg-white border border-border rounded-sm p-6 text-sm text-muted-foreground italic">
            No hostile vessel incidents currently on file in the shipping dataset.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="Total vessel incidents" value={vesselIncidents.length} accent="#0b0a3d" window={`Confirmed · last ${RANGE_LABEL[range]}`} />
              <Kpi label="Attacks" value={vesselCounts.Attack} accent={VESSEL_ACCENT.Attack} window={`Confirmed · last ${RANGE_LABEL[range]}`} />
              <Kpi label="Near miss" value={vesselCounts["Near miss"]} accent={VESSEL_ACCENT["Near miss"]} window={`Confirmed · last ${RANGE_LABEL[range]}`} />
              <Kpi label="Seized" value={vesselCounts.Seized} accent={VESSEL_ACCENT.Seized} window={`Confirmed · last ${RANGE_LABEL[range]}`} />
            </div>
            <div
              className="flex gap-3 mt-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1"
              style={{ scrollbarWidth: "thin" }}
              role="region"
              aria-label="Vessel attack incidents carousel"
            >
              {vesselIncidents.slice(0, 24).map((v) => (
                <div
                  key={v.id}
                  className="snap-start shrink-0 w-[280px] md:w-[300px] xl:w-[320px]"
                >
                  <VesselCard
                    title={v.title}
                    date={isNaN(v.occurredDate.getTime()) ? null : format(v.occurredDate, "dd MMM yyyy")}
                    country={v.incidentCountry}
                    flagState={v.flagState}
                    location={v.location && !/^unknown$/i.test(v.location.trim()) ? v.location : null}
                    severity={v.severity}
                    type={v.vesselType}
                    summary={v.summary ?? null}
                    sourceUrl={incidentSourceUrl(v)}
                  />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground italic mt-2">
              Showing latest vessel attack/threat incidents. Full records remain available in the incident table.
            </p>
          </>
        )}
      </Section>

      {/* 3c. Piracy and Armed Robbery */}
      <Section title="Piracy and Armed Robbery">
        <p className="text-xs text-muted-foreground font-sans -mt-1 mb-2">
          Hostile activity directed at vessels and crew: piracy, armed robbery at sea, boarding, attempted boarding, suspicious approach, small craft approach, hijacking, crew threat and theft from a vessel at anchorage. Land cargo theft remains under Cargo Watch.
        </p>
        {piracyIncidents.length === 0 ? (
          <div className="bg-white border border-border rounded-sm p-6 text-sm text-muted-foreground italic">
            No current piracy or armed-robbery records in the selected window.
          </div>
        ) : (
          <div className="bg-white border border-border rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-sans font-medium w-[130px]">Date</th>
                  <th className="text-left p-2 font-sans font-medium w-[180px]">Act</th>
                  <th className="text-left p-2 font-sans font-medium">Title</th>
                  <th className="text-left p-2 font-sans font-medium w-[150px]">Location</th>
                  <th className="text-left p-2 font-sans font-medium w-[100px]">Severity</th>
                  <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {piracyIncidents.slice(0, 30).map((i) => (
                  <tr key={i.id} className="hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs whitespace-nowrap">
                      {isNaN(i.occurredDate.getTime()) ? "—" : format(i.occurredDate, "dd MMM yyyy")}
                    </td>
                    <td className="p-2 text-xs uppercase tracking-wider font-sans text-primary">{i.piracyAct}</td>
                    <td className="p-2 font-medium">{i.title}</td>
                    <td className="p-2 text-xs">{i.incidentCountry ?? NOT_IDENTIFIED}</td>
                    <td className="p-2">
                      <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(i.severity)}>
                        {SEVERITY_LABELS[i.severity] ?? i.severity}
                      </span>
                    </td>
                    <td className="p-2">
                      {incidentSourceUrl(i) ? (
                        <a href={incidentSourceUrl(i)!} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 3d. Maritime Security — ICC CCS / IMB Piracy Reporting Centre */}
      <Section title="Maritime Security — ICC CCS / IMB Piracy Reporting Centre">
        <p className="text-xs text-muted-foreground font-sans -mt-1 mb-2">
          Reported piracy and armed-robbery-at-sea events from the{" "}
          <a href={MARITIME_SECURITY_SOURCE_PAGE} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            {MARITIME_SECURITY_SOURCE_LABEL}
          </a>{" "}
          live piracy map (current calendar year). This is a standalone reference
          source: it is shown alongside the monitor but is never added to the
          shipping incident counts above.
        </p>
        {maritimeSecurity.byType.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {maritimeSecurity.byType.map((t) => (
              <span
                key={t.type}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm text-[11px] font-sans bg-white border border-border"
              >
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} />
                <span className="text-primary font-medium">{t.type}</span>
                <span className="text-muted-foreground font-mono">{t.count}</span>
              </span>
            ))}
          </div>
        )}
        {maritimeSecurity.rows.length === 0 ? (
          <div className="bg-white border border-border rounded-sm p-6 text-sm text-muted-foreground italic">
            No ICC/IMB maritime-security events in the selected window. (Source
            may be pending external network validation — see Source Health.)
          </div>
        ) : (
          <div className="bg-white border border-border rounded-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-sans font-medium w-[110px]">Date</th>
                  <th className="text-left p-2 font-sans font-medium w-[70px]">Ref</th>
                  <th className="text-left p-2 font-sans font-medium w-[150px]">Type</th>
                  <th className="text-left p-2 font-sans font-medium">Description</th>
                  <th className="text-left p-2 font-sans font-medium w-[150px]">Location</th>
                  <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {maritimeSecurity.rows.map((r) => (
                  <tr key={r.eventKey} className="hover:bg-muted/30 align-top">
                    <td className="p-2 font-mono text-xs whitespace-nowrap">
                      {r.date ? format(r.date, "dd MMM yyyy") : "—"}
                    </td>
                    <td className="p-2 font-mono text-xs whitespace-nowrap">{r.incidentNumber ?? "—"}</td>
                    <td className="p-2 text-xs font-sans">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-sm" style={{ background: maritimeTypeColor(r.type) }} />
                        {r.type}
                      </span>
                    </td>
                    <td className="p-2 text-xs text-foreground/80">{r.narrative ?? "—"}</td>
                    <td className="p-2 text-xs">{r.country ?? r.location ?? NOT_IDENTIFIED}</td>
                    <td className="p-2">
                      {r.sourceUrl ? (
                        <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 4. Regional Split */}
      <Section title="Regional Split">
        <div className="bg-white border border-border rounded-sm p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <RegionRow label="Middle East" count={meCount} total={total} accent={REGION_COLOR["Middle East"]} />
            <RegionRow label="APAC" count={apCount} total={total} accent={REGION_COLOR["APAC"]} />
            <RegionRow label={NOT_IDENTIFIED} count={notIdentifiedCount} total={total} accent={REGION_COLOR["Country not identified"]} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Country reflects where the incident occurred, derived from the event location text. Vessel flag state is shown separately on vessel cards and is never counted in the country charts. Records with no identifiable incident location are kept in totals but separated from the country charts. Records outside APAC and the Middle East are excluded entirely.
          </p>
        </div>
      </Section>

      {/* 5. Issue Type Breakdown */}
      <Section title="Issue Type Breakdown">
        <ChartCard title="Incidents by Issue Type" height={320}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byIssue} layout="vertical" margin={{ left: 24, right: 16 }}>
              <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} />
              <YAxis dataKey="issue" type="category" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} width={200} />
              <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                {byIssue.map((_, idx) => {
                  const c = ISSUE_PALETTE[idx % ISSUE_PALETTE.length];
                  return <Cell key={idx} fill={c} stroke={darken(c)} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Section>

      {/* 6. Daily Intelligence Summary */}
      <Section title="Daily Intelligence Summary">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <IntelCard
            label="Chokepoint / Route Activity"
            body={
              transitRecords.length > 0
                ? `Chokepoint reporting was led by ${transitRecords[0].title}, with the wider set covering chokepoint risk, route diversion and maritime advisories (${transitRecords.length} record${transitRecords.length === 1 ? "" : "s"} in window).`
                : null
            }
          />
          <IntelCard
            label="Vessel Threat / Piracy"
            body={
              vesselIncidents.length + piracyIncidents.length > 0
                ? `Hostile maritime activity was led by ${vesselIncidents[0]?.title ?? piracyIncidents[0]?.title ?? "—"}, split across ${vesselAttackOrSeizureCount} vessel attack or seizure record${vesselAttackOrSeizureCount === 1 ? "" : "s"} and ${piracyIncidents.length} piracy or armed-robbery record${piracyIncidents.length === 1 ? "" : "s"}.`
                : null
            }
          />
          <IntelCard
            label="Commercial Impact"
            body={
              commercialRecords.length > 0
                ? `Commercial pressure was led by ${commercialRecords[0].title}, covering port disruption, freight and insurance pressure and wider commercial shipping disruption (${commercialRecords.length} record${commercialRecords.length === 1 ? "" : "s"} in window).`
                : null
            }
          />
        </div>
      </Section>

      {/* 7. Shipping Map */}
      <Section title="Shipping Map">
        <div className="bg-white border border-border rounded-sm overflow-hidden">
          {withCoords.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No geocoded shipping records available for this view.
            </div>
          ) : (
            <div className="h-[420px]">
              <MapContainer center={[15, 60]} zoom={3} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
                <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {withCoords.map((i) => {
                  const c = ratingColor(i.severity);
                  return (
                    <CircleMarker
                      key={i.id}
                      center={[i.latitude!, i.longitude!]}
                      radius={6}
                      pathOptions={{ fillColor: c, color: darken(c), fillOpacity: FILL_OPACITY, weight: STROKE_WIDTH }}
                    >
                      <LeafletTooltip>
                        <div className="text-xs">
                          <div className="font-bold">{i.title}</div>
                          <div>{i.incidentCountry ?? NOT_IDENTIFIED} · {i.region} · {i.issue}</div>
                        </div>
                      </LeafletTooltip>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>
          )}
        </div>
      </Section>

      {/* 8. Charts */}
      <Section title="Charts">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Incident Timeline">
            {timeline.length === 0 ? (
              <EmptyChart message="No timeline data available." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeline} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} interval="preserveStartEnd" />
                  <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Line type="monotone" dataKey="count" stroke="#0b0a3d" strokeWidth={2} dot={{ r: 3, stroke: "#0b0a3d", strokeWidth: 1.5, fill: "#465bff", fillOpacity: FILL_OPACITY }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Incidents by Region">
            <div className="flex flex-col h-full">
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byRegion} layout="vertical" margin={{ left: 24, right: 40 }}>
                    <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                    <XAxis type="number" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                    <YAxis dataKey="region" type="category" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} width={100} />
                    <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                    <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                      <LabelList dataKey="count" position="right" fill="#0b0a3d" fontSize={12} fontWeight={700} />
                      {byRegion.map((d) => {
                        const c = REGION_COLOR[d.region as Region];
                        return <Cell key={d.region} fill={c} stroke={darken(c)} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {notIdentifiedCount > 0 && (
                <p className="text-[11px] text-muted-foreground font-sans mt-2 shrink-0 leading-snug">
                  Based on {meCount + apCount} record{meCount + apCount === 1 ? "" : "s"} with an identified incident location.
                  A further {notIdentifiedCount} credible record{notIdentifiedCount === 1 ? "" : "s"} could not be tied to a
                  specific country and {notIdentifiedCount === 1 ? "is" : "are"} omitted from this chart.
                </p>
              )}
            </div>
          </ChartCard>

          <ChartCard title="Incidents by Country (Top 12)">
            {byCountry.length === 0 ? (
              <EmptyChart message="No identified countries in shipping records." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCountry} margin={{ left: 8, right: 16, bottom: 40 }}>
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                  <XAxis dataKey="country" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={60} />
                  <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#465bff" stroke={darken("#465bff")} strokeWidth={STROKE_WIDTH} fillOpacity={FILL_OPACITY}>
                    <LabelList dataKey="count" position="top" fill="#0b0a3d" fontSize={11} fontWeight={700} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Severity Distribution">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySeverity}>
                <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} />
                <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                  <LabelList dataKey="count" position="top" fill="#0b0a3d" fontSize={11} fontWeight={700} />
                  {bySeverity.map((d) => {
                    const c = ratingColor(d.severity);
                    return <Cell key={d.severity} fill={c} stroke={darken(c)} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </Section>

      {/* 9. Recent Incidents */}
      <Section title="Recent Shipping Incidents">
        <div className="bg-white border border-border rounded-sm">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : !enriched.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No shipping incidents recorded.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-sans font-medium w-[140px]">Date</th>
                    <th className="text-left p-2 font-sans font-medium">Title</th>
                    <th className="text-left p-2 font-sans font-medium w-[140px]">Country</th>
                    <th className="text-left p-2 font-sans font-medium w-[110px]">Region</th>
                    <th className="text-left p-2 font-sans font-medium w-[180px]">Issue Type</th>
                    <th className="text-left p-2 font-sans font-medium w-[100px]">Severity</th>
                    <th className="text-left p-2 font-sans font-medium w-[60px]">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {enriched
                    .slice()
                    .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime())
                    .map((i) => {
                      const countryDisplay = i.incidentCountry ?? NOT_IDENTIFIED;
                      return (
                        <tr key={i.id} className="hover:bg-muted/30">
                          <td className="p-2 font-mono text-xs whitespace-nowrap">
                            {isNaN(i.occurredDate.getTime()) ? "—" : format(i.occurredDate, "dd MMM yyyy")}
                          </td>
                          <td className="p-2 font-medium">{i.title}</td>
                          <td className="p-2 text-xs">{countryDisplay}</td>
                          <td className="p-2 text-xs">{i.region}</td>
                          <td className="p-2 text-xs">{i.issue}</td>
                          <td className="p-2">
                            <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(i.severity)}>
                              {SEVERITY_LABELS[i.severity] ?? i.severity}
                            </span>
                          </td>
                          <td className="p-2">
                            {incidentSourceUrl(i) ? (
                              <a href={incidentSourceUrl(i)!} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs" aria-label="Open source">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      {/* 10. Data quality note */}
      <div className="bg-white border border-border rounded-sm p-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">Data Quality</div>
          <div className="text-sm text-primary font-sans mt-1">
            Records with incident location not identified: <span className="font-bold">{notIdentifiedCount}</span>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground max-w-md text-right">
          Kept in totals; excluded from country-level charts. Source records show <span className="font-semibold">{LOCATION_NOT_IDENTIFIED}</span> when no event-country can be derived. Vessel flag state, when present, is surfaced on vessel cards only.
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-serif font-bold uppercase text-primary text-base tracking-wide border-b-2 border-accent pb-1 inline-block">
        {title}
      </h2>
      {children}
    </section>
  );
}

function HormuzCategoryCard({ cat }: { cat: HormuzCategoryResult }) {
  const active = cat.count > 0;
  const accent = active ? "#4655FF" : "#E2E2E2";
  return (
    <div
      className="rounded-sm border bg-white p-3"
      style={{ borderColor: "#E2E2E2", borderLeftColor: accent, borderLeftWidth: 4 }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-serif font-bold text-sm" style={{ color: "#0B0B3D" }}>
          {cat.label}
        </div>
        <div className="font-mono text-sm" style={{ color: active ? "#0B0B3D" : "#303030" }}>
          {cat.count}
        </div>
      </div>
      <div className="text-[11px] font-sans mt-0.5" style={{ color: "#303030" }}>
        {cat.description}
      </div>
      {active ? (
        <ul className="mt-2 space-y-1">
          {cat.recent.slice(0, 3).map((r, idx) => (
            <li key={`${r.id ?? ""}-${idx}`} className="text-xs font-sans" style={{ color: "#303030" }}>
              <span className="font-mono mr-1.5" style={{ color: "#303030" }}>
                {r.occurredAt
                  ? (() => {
                      try { return format(parseISO(r.occurredAt), "dd MMM"); } catch { return "—"; }
                    })()
                  : "—"}
              </span>
              {r.title}
            </li>
          ))}
          {cat.count > 3 && (
            <li className="text-[11px] font-sans italic" style={{ color: "#303030" }}>
              +{cat.count - 3} more in window
            </li>
          )}
        </ul>
      ) : (
        <div className="text-xs font-sans italic mt-2" style={{ color: "#303030" }}>
          Nothing on file for this category in the loaded window.
        </div>
      )}
    </div>
  );
}

function WindowBadge({ window, className }: { window: string; className?: string }) {
  return (
    <div className={"text-[9px] uppercase tracking-widest font-sans " + (className ?? "")} style={{ color: "#465bff" }}>
      Window: {window}
    </div>
  );
}

function FastFactCard({ label, value, note, accent, window }: { label: string; value: string; note: string; accent: string; window: string }) {
  return (
    <div className="bg-white border border-border rounded-sm p-3 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: accent }} />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mt-1">{label}</div>
      <div className="font-serif font-bold text-primary leading-tight mt-1 text-xl">{value}</div>
      <WindowBadge window={window} className="mt-1" />
      <div className="text-[11px] text-muted-foreground font-sans mt-2 leading-snug">{note}</div>
    </div>
  );
}

function Kpi({ label, value, accent, small, window }: { label: string; value: string | number; accent: string; small?: boolean; window: string }) {
  return (
    <div className="bg-white border border-border rounded-sm p-3 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: accent }} />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans pl-2">{label}</div>
      <div className={"font-serif font-bold leading-none text-primary mt-2 pl-2 " + (small ? "text-lg" : "text-2xl")}>{value}</div>
      <WindowBadge window={window} className="pl-2 mt-1.5" />
    </div>
  );
}

function RegionRow({ label, count, total, accent }: { label: string; count: number; total: number; accent: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-sans">{label}</div>
        <div className="text-[11px] text-muted-foreground font-mono">{pct}%</div>
      </div>
      <div className="text-2xl font-serif font-bold text-primary leading-none">{count}</div>
      <div className="h-1.5 bg-muted rounded-sm overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, background: accent, opacity: FILL_OPACITY }} />
      </div>
    </div>
  );
}

function IntelCard({ label, body }: { label: string; body: string | null }) {
  return (
    <div className="bg-white border border-border rounded-sm p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-accent" />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mt-1">{label}</div>
      <p className="text-sm text-primary font-sans leading-relaxed mt-2">
        {body ?? <span className="italic text-muted-foreground">No matching records in current view.</span>}
      </p>
    </div>
  );
}

function ChartCard({ title, children, height = 288 }: { title: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="bg-white border border-border rounded-sm p-4">
      <h3 className="font-serif font-bold uppercase text-primary text-sm mb-3 tracking-wide">{title}</h3>
      <div style={{ height }}>{children}</div>
    </div>
  );
}

function VesselCard({
  title, date, country, flagState, location, severity, type, summary, sourceUrl,
}: {
  title: string;
  date: string | null;
  country: string | null;
  flagState: string | null;
  location: string | null;
  severity: string;
  type: VesselIncidentType;
  summary: string | null;
  sourceUrl: string | null;
}) {
  const accent = VESSEL_ACCENT[type];
  const where = [country, location].filter(Boolean).join(" · ");
  return (
    <div className="bg-white border border-border rounded-sm p-3 relative overflow-hidden flex flex-col gap-2">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: accent }} />
      <div className="flex items-start justify-between gap-2 pl-2">
        <div className="text-[10px] uppercase tracking-widest font-sans text-muted-foreground">
          {type}
        </div>
        <span
          className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm shrink-0"
          style={severityBadgeStyle(severity)}
        >
          {SEVERITY_LABELS[severity] ?? severity}
        </span>
      </div>
      <div className="pl-2 text-sm font-serif font-bold text-primary leading-snug">{title}</div>
      <div className="pl-2 text-[11px] text-muted-foreground font-sans flex flex-wrap gap-x-3 gap-y-0.5">
        {date && <span className="font-mono">{date}</span>}
        {where && <span>{where}</span>}
        {flagState && (
          <span className="text-[10px] uppercase tracking-wider">
            Flag state: <span className="font-semibold text-primary normal-case tracking-normal">{flagState}</span>
          </span>
        )}
      </div>
      {summary && (
        <p className="pl-2 text-xs text-foreground/80 font-sans leading-snug line-clamp-3">{summary}</p>
      )}
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="pl-2 mt-auto text-[11px] text-accent hover:underline inline-flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" /> Source
        </a>
      )}
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground italic">
      {message}
    </div>
  );
}

// --- Maritime Intelligence board ---------------------------------------------
// Renders the one shared deterministic dataset (buildMaritimeIntelligence). The
// Shipping Watch report renders the SAME dataset in the same section order, so
// the live board and the report can never disagree. Brand: #0B0B3D / #4655FF /
// #A33232 reserved for level-5 / Extreme only. Terse; no parenthetical counts
// in prose (counts appear only on stat tiles / captions).

const MARITIME_CONFIDENCE_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function MaritimeRiskChip({ level, label }: { level: MaritimeRiskLevel; label: string }) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-sm text-xs font-bold uppercase tracking-wider"
      style={{ background: MARITIME_RISK_COLOR[level], color: "#FFFFFF" }}
    >
      Level {level} · {label}
    </span>
  );
}

function MaritimeBoardCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-border rounded-sm p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

// Movement (AIS) context is populated automatically by the live AIS ingest when
// AIS_API_KEY is configured; this admin-token-gated form is a COMPLEMENTARY
// manual path for a licensed provider's snapshot. Either way the rows are
// CONTEXT only, never incidents. A successful upload invalidates the
// latest-movement query so the board AND the Shipping Watch report immediately
// render the new movement context. The token is sent per-request as an
// Authorization: Bearer header; it is never persisted and the workbench never
// holds a global auth token.
const MOVEMENT_COUNT_FIELDS: { key: keyof MaritimeMovementInput; label: string }[] = [
  { key: "totalVessels", label: "Total vessels" },
  { key: "inboundCount", label: "Inbound" },
  { key: "outboundCount", label: "Outbound" },
  { key: "tankersCount", label: "Tankers" },
  { key: "bulkCarriersCount", label: "Bulk carriers" },
  { key: "containerCount", label: "Container" },
  { key: "lngLpgCount", label: "LNG / LPG" },
  { key: "anchoredOrWaitingCount", label: "Anchored / waiting" },
  { key: "aisVisibleCount", label: "AIS visible" },
  { key: "aisDarkOrGapCount", label: "AIS dark / gap" },
];

const MOVEMENT_INPUT_CLASS =
  "w-full border border-border rounded-sm px-2 py-1.5 text-sm font-sans bg-white text-foreground";
const MOVEMENT_LABEL_CLASS =
  "block text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-1";

function MaritimeMovementUploadForm({ hasMovement }: { hasMovement: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [theatre, setTheatre] = useState("Strait of Hormuz");
  const [chokepoint, setChokepoint] = useState("");
  const [dataAsOf, setDataAsOf] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [confidence, setConfidence] = useState<"low" | "medium" | "high">("medium");
  const [changeVs7DayBaseline, setChangeVs7DayBaseline] = useState("");
  const [notes, setNotes] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);

    if (!token.trim()) {
      setResult({ kind: "error", msg: "Admin token is required to upload." });
      return;
    }
    if (!theatre.trim() || !sourceName.trim() || !dataAsOf) {
      setResult({ kind: "error", msg: "Theatre, source name and data-as-of are required." });
      return;
    }

    const input: MaritimeMovementInput = {
      theatre: theatre.trim(),
      dataAsOf: new Date(dataAsOf).toISOString(),
      sourceName: sourceName.trim(),
      confidence,
    };
    if (chokepoint.trim()) input.chokepoint = chokepoint.trim();
    if (sourceUrl.trim()) input.sourceUrl = sourceUrl.trim();
    if (changeVs7DayBaseline.trim()) input.changeVs7DayBaseline = changeVs7DayBaseline.trim();
    if (notes.trim()) input.notes = notes.trim();
    for (const { key } of MOVEMENT_COUNT_FIELDS) {
      const raw = counts[key as string];
      if (raw != null && raw.trim() !== "") {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) {
          (input as unknown as Record<string, unknown>)[key as string] = Math.round(n);
        }
      }
    }

    setSubmitting(true);
    try {
      await createMaritimeMovement(input, {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListLatestMaritimeMovementQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListMaritimeMovementQueryKey() }),
      ]);
      setResult({
        kind: "ok",
        msg: "Movement snapshot uploaded. The board and the Shipping Watch report now carry this context.",
      });
      setCounts({});
      setNotes("");
      setChangeVs7DayBaseline("");
    } catch (err) {
      const httpStatus = (err as { status?: number })?.status;
      let msg = "Upload failed. Check the values and try again.";
      if (httpStatus === 401) {
        msg = "Unauthorized — the admin token is missing or incorrect.";
      } else if (httpStatus === 503) {
        msg = "Upload disabled — no admin token is configured on the server.";
      } else if (httpStatus === 400) {
        msg = "Rejected — one or more fields are invalid (counts must be whole numbers ≥ 0).";
      } else if (err instanceof Error && err.message) {
        msg = err.message;
      }
      setResult({ kind: "error", msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Section title="Movement Data Upload — Admin">
      <div className="flex items-center justify-between gap-4 flex-wrap -mt-1">
        <p className="text-xs text-muted-foreground font-sans max-w-3xl">
          Movement (AIS) figures are CONTEXT, never incidents. A live AIS feed populates these
          automatically when configured; this form adds a licensed provider's snapshot manually.
          Admin token required.{" "}
          {hasMovement
            ? "A snapshot is on file; uploading adds a newer one."
            : "No snapshot on file — both surfaces read movement data unavailable until one is added."}
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-sans uppercase tracking-widest border border-border rounded-sm px-3 py-1.5 text-primary hover:bg-muted/40"
        >
          {open ? "Hide form" : "Upload snapshot"}
        </button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="mt-3 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={MOVEMENT_LABEL_CLASS}>Admin token *</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                placeholder="INGEST_ADMIN_TOKEN"
                className={MOVEMENT_INPUT_CLASS}
              />
            </div>
            <div>
              <label className={MOVEMENT_LABEL_CLASS}>Theatre *</label>
              <input
                type="text"
                value={theatre}
                onChange={(e) => setTheatre(e.target.value)}
                className={MOVEMENT_INPUT_CLASS}
              />
            </div>
            <div>
              <label className={MOVEMENT_LABEL_CLASS}>Chokepoint</label>
              <input
                type="text"
                value={chokepoint}
                onChange={(e) => setChokepoint(e.target.value)}
                placeholder="optional"
                className={MOVEMENT_INPUT_CLASS}
              />
            </div>
            <div>
              <label className={MOVEMENT_LABEL_CLASS}>Data as of *</label>
              <input
                type="datetime-local"
                value={dataAsOf}
                onChange={(e) => setDataAsOf(e.target.value)}
                className={MOVEMENT_INPUT_CLASS}
              />
            </div>
            <div>
              <label className={MOVEMENT_LABEL_CLASS}>Source name *</label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="Licensed AIS provider"
                className={MOVEMENT_INPUT_CLASS}
              />
            </div>
            <div>
              <label className={MOVEMENT_LABEL_CLASS}>Source URL</label>
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="optional"
                className={MOVEMENT_INPUT_CLASS}
              />
            </div>
            <div>
              <label className={MOVEMENT_LABEL_CLASS}>Confidence</label>
              <select
                value={confidence}
                onChange={(e) => setConfidence(e.target.value as "low" | "medium" | "high")}
                className={MOVEMENT_INPUT_CLASS}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className={MOVEMENT_LABEL_CLASS}>Change vs 7-day baseline</label>
              <input
                type="text"
                value={changeVs7DayBaseline}
                onChange={(e) => setChangeVs7DayBaseline(e.target.value)}
                placeholder="e.g. +12% 7d"
                className={MOVEMENT_INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">
              Vessel counts — leave blank for "not reported" (blank is never read as zero)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {MOVEMENT_COUNT_FIELDS.map(({ key, label }) => (
                <div key={key as string}>
                  <label className={MOVEMENT_LABEL_CLASS}>{label}</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={counts[key as string] ?? ""}
                    onChange={(e) =>
                      setCounts((c) => ({ ...c, [key as string]: e.target.value }))
                    }
                    className={MOVEMENT_INPUT_CLASS}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className={MOVEMENT_LABEL_CLASS}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="optional analyst note"
              className={MOVEMENT_INPUT_CLASS}
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="submit"
              disabled={submitting}
              className="text-xs font-sans uppercase tracking-widest rounded-sm px-4 py-2 text-white disabled:opacity-60"
              style={{ background: "#4655FF" }}
            >
              {submitting ? "Uploading…" : "Upload movement snapshot"}
            </button>
            {result && (
              <span
                className="text-xs font-sans"
                style={{ color: result.kind === "ok" ? "#1d6b3a" : "#A33232" }}
              >
                {result.msg}
              </span>
            )}
          </div>
        </form>
      )}
    </Section>
  );
}

// Small severity-coloured chip for a chokepoint card's risk level.
function MaritimeMiniRiskChip({ level, label }: { level: MaritimeRiskLevel; label: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider"
      style={{ background: MARITIME_RISK_COLOR[level], color: "#FFFFFF" }}
    >
      L{level} · {label}
    </span>
  );
}

// One of the six spec chokepoint cards.
function ChokepointBoardCard({ card }: { card: ChokepointCard }) {
  const { key, risk, incidentCount, lastConfirmed, movement, businessImpact, confidence } = card;
  return (
    <div className="bg-white border border-border rounded-sm p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="font-serif font-bold text-primary text-sm leading-tight">{key}</span>
        <MaritimeMiniRiskChip level={risk.level} label={risk.label} />
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-mono text-lg text-primary leading-none">{incidentCount}</span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">
          confirmed · last 7 days
        </span>
      </div>

      <div className="text-[11px] font-sans leading-snug">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-1">Last incident</span>
        {lastConfirmed ? (
          <span className="text-foreground/85">
            {format(parseISO(lastConfirmed.occurredAt), "dd MMM")} — {lastConfirmed.title}
          </span>
        ) : (
          <span className="italic text-muted-foreground">None in window</span>
        )}
      </div>

      <div className="text-[11px] font-sans leading-snug">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-1">Movement</span>
        {movement ? (
          <span className="text-foreground/85">{formatMovementSummary(movement)}</span>
        ) : (
          <span className="italic text-muted-foreground">Movement data unavailable</span>
        )}
      </div>

      <div className="text-[11px] font-sans leading-snug">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-1">Business impact</span>
        <span className="text-foreground/85">{businessImpact.join(", ")}</span>
      </div>

      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mt-auto pt-1">
        Confidence: {MARITIME_CONFIDENCE_LABEL[confidence] ?? confidence}
      </div>
    </div>
  );
}

// One executive-summary stat card.
function ExecSummaryCard({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <div className="bg-white border border-border rounded-sm p-4 flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">{label}</div>
      <div
        className="font-serif font-bold leading-none text-2xl"
        style={{ color: valueColor ?? "#0B0B3D" }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] font-sans leading-snug text-foreground/75">{sub}</div>}
    </div>
  );
}

// The confirmed-incidents table — confirmed maritime security events only.
// Movement / AIS context never appears here.
function ConfirmedIncidentsTable({ rows }: { rows: LatestIncident[] }) {
  return (
    <MaritimeBoardCard label="Confirmed Maritime Incidents">
      {rows.length === 0 ? (
        <div className="text-[12px] font-sans italic text-muted-foreground">
          No confirmed maritime security incidents in the window.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-2 font-sans font-medium w-[90px]">Date</th>
                <th className="text-left p-2 font-sans font-medium w-[170px]">Category</th>
                <th className="text-left p-2 font-sans font-medium w-[90px]">Severity</th>
                <th className="text-left p-2 font-sans font-medium w-[150px]">Chokepoint</th>
                <th className="text-left p-2 font-sans font-medium">Event</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-muted/30">
                  <td className="p-2 font-mono text-xs whitespace-nowrap">
                    {format(parseISO(r.occurredAt), "dd MMM")}
                  </td>
                  <td className="p-2 text-xs text-foreground/90">{r.category}</td>
                  <td className="p-2">
                    <span
                      className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm"
                      style={severityBadgeStyle((r.severity ?? "").toLowerCase())}
                    >
                      {SEVERITY_LABELS[(r.severity ?? "").toLowerCase()] ?? r.severity}
                    </span>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {r.chokepoint ?? "—"}
                  </td>
                  <td className="p-2 text-xs text-foreground/90">{r.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </MaritimeBoardCard>
  );
}

function MaritimeIntelligenceBoard({ board }: { board: MaritimeIntelligence }) {
  const {
    bluf,
    risk,
    movementSnapshot,
    incidentSnapshot,
    chokepointCards,
    chokepointsAffected,
    confirmedIncidents,
    keyRiskIndicators,
    businessImpact,
    watchNext,
  } = board;

  const namedImpacts = businessImpact.filter((b) => b !== "No material impact");

  return (
    <Section title="Maritime Intelligence">
      <p className="text-xs text-muted-foreground font-sans -mt-1">
        Weekly assessment · last 7 days. One shared dataset, identical to the Shipping Watch report.
      </p>

      {/* Executive summary row — 4 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ExecSummaryCard
          label="Maritime Risk Level"
          value={`L${risk.level} · ${risk.label}`}
          valueColor={MARITIME_RISK_COLOR[risk.level]}
          sub={`Confidence: ${MARITIME_CONFIDENCE_LABEL[risk.confidence] ?? risk.confidence}`}
        />
        <ExecSummaryCard
          label="Confirmed Incidents · 7d"
          value={incidentSnapshot.total}
          sub="Confirmed maritime security events"
        />
        <ExecSummaryCard
          label="Chokepoints Affected"
          value={`${chokepointsAffected} / ${chokepointCards.length}`}
          sub="With ≥1 confirmed incident"
        />
        <ExecSummaryCard
          label="Business Impact"
          value={namedImpacts.length > 0 ? namedImpacts.length : "—"}
          sub={namedImpacts.length > 0 ? namedImpacts.slice(0, 2).join(", ") : "No material impact"}
        />
      </div>

      {/* BLUF */}
      <div className="rounded-sm p-4" style={{ background: "#0B0B3D" }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="text-[10px] uppercase tracking-widest font-sans" style={{ color: "#9aa0c8" }}>
            Bottom line up front
          </div>
          <MaritimeRiskChip level={risk.level} label={risk.label} />
        </div>
        <p className="text-sm font-sans leading-snug mt-2" style={{ color: "#FFFFFF" }}>
          {bluf}
        </p>
      </div>

      {/* Six chokepoint cards */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-2">
          Chokepoint Cards
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {chokepointCards.map((card) => (
            <ChokepointBoardCard key={card.key} card={card} />
          ))}
        </div>
      </div>

      {/* Confirmed incidents table */}
      <ConfirmedIncidentsTable rows={confirmedIncidents} />

      {/* Live vessel map — individual AIS positions in the tracked chokepoints */}
      <MaritimeBoardCard label="Live Vessel Map — AIS Positions (Middle East & Asia-Pacific)">
        <p className="text-[11px] text-muted-foreground font-sans leading-snug mb-3">
          Individual vessels at their most recent transmitted position inside the tracked chokepoints. Positions are live AIS CONTEXT — they never count as incidents and never raise the risk level on their own.
        </p>
        <VesselMap />
      </MaritimeBoardCard>

      {/* Maritime context panel — movement / AIS only */}
      <MaritimeBoardCard label="Maritime Context — Vessel Movement (AIS)">
        {movementSnapshot ? (
          <div className="space-y-2">
            <div className="text-[11px] text-muted-foreground font-sans">
              As of {format(parseISO(movementSnapshot.asOf ?? new Date().toISOString()), "dd MMM yyyy")} ·{" "}
              {movementSnapshot.sourceName ?? "Licensed provider"} · Confidence{" "}
              {MARITIME_CONFIDENCE_LABEL[movementSnapshot.confidence ?? "low"] ?? movementSnapshot.confidence}
            </div>
            <ul className="space-y-1.5">
              {movementSnapshot.theatres.map((t) => (
                <li key={t.theatre} className="text-[12px] font-sans leading-snug">
                  <span className="font-serif font-bold text-primary">{t.theatre}</span>
                  <span className="text-foreground/80"> — {formatMovementSummary(t)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground font-sans leading-snug">
              Vessel movement is CONTEXT only — it never counts as an incident and never raises the risk level on its own.
            </p>
          </div>
        ) : (
          <div className="text-[12px] font-sans italic text-muted-foreground">
            Movement data unavailable. Upload a licensed-provider snapshot to populate this panel. Risk is assessed from confirmed incidents alone.
          </div>
        )}
      </MaritimeBoardCard>

      {/* Polestar View */}
      <div className="rounded-sm border border-border" style={{ background: "#0B0B3D" }}>
        <div className="px-4 pt-3 text-[10px] uppercase tracking-widest font-sans" style={{ color: "#9aa0c8" }}>
          Polestar View
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px p-4 pt-2">
          <div className="pr-4">
            <div className="text-[10px] uppercase tracking-widest font-sans mb-1" style={{ color: "#9aa0c8" }}>
              Assessment
            </div>
            <p className="text-[13px] font-sans leading-snug" style={{ color: "#FFFFFF" }}>
              {risk.rationale}
            </p>
            <ul className="space-y-1 mt-2">
              {keyRiskIndicators.map((k, i) => (
                <li key={i} className="text-[12px] font-sans leading-snug flex gap-2" style={{ color: "#dfe1f0" }}>
                  <span style={{ color: "#4655FF" }}>•</span>
                  <span>{k}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="md:pl-4 md:border-l" style={{ borderColor: "#2a2a5c" }}>
            <div className="text-[10px] uppercase tracking-widest font-sans mb-1" style={{ color: "#9aa0c8" }}>
              Business impact
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {businessImpact.map((b) => (
                <span
                  key={b}
                  className="px-2 py-0.5 text-[11px] font-sans rounded-sm"
                  style={{ background: "#16164a", color: "#dfe1f0" }}
                >
                  {b}
                </span>
              ))}
            </div>
            <div className="text-[10px] uppercase tracking-widest font-sans mb-1" style={{ color: "#9aa0c8" }}>
              Confidence
            </div>
            <p className="text-[12px] font-sans mb-3" style={{ color: "#FFFFFF" }}>
              {MARITIME_CONFIDENCE_LABEL[risk.confidence] ?? risk.confidence}
            </p>
            <div className="text-[10px] uppercase tracking-widest font-sans mb-1" style={{ color: "#9aa0c8" }}>
              Watch next
            </div>
            <ul className="space-y-1">
              {watchNext.map((w, i) => (
                <li key={i} className="text-[12px] font-sans leading-snug flex gap-2" style={{ color: "#dfe1f0" }}>
                  <span style={{ color: "#4655FF" }}>•</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}
