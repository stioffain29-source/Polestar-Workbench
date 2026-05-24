import { useMemo } from "react";
import { useListIncidents } from "@workspace/api-client-react";
import type { Incident } from "@workspace/api-client-react";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { format, differenceInDays, parseISO, startOfDay } from "date-fns";
import {
  BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  LineChart, Line,
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
} from "@/lib/shippingAnalysis";
import { ExternalLink } from "lucide-react";

const NOT_IDENTIFIED = LOCATION_NOT_IDENTIFIED;

// Region / issue / vessel classifiers are now imported from
// `@/lib/shippingAnalysis` so the Shipping page and the Shipping report PDF
// share one source of truth and never drift.

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};

const FILL_OPACITY = 0.78;
const STROKE_WIDTH = 1.5;

function darken(hex: string, amount = 0.18): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export default function Shipping() {
  const { data: incidents = [], isLoading } = useListIncidents({ topic: "shipping" });

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
  const enriched = useMemo(
    () => allEnriched.filter((i) => i.region !== "Out of scope"),
    [allEnriched],
  );

  const total = enriched.length;

  const last7 = useMemo(() => {
    const now = new Date();
    return enriched.filter((i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= 7).length;
  }, [enriched]);
  const last30 = useMemo(() => {
    const now = new Date();
    return enriched.filter((i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= 30).length;
  }, [enriched]);

  const byRegion = useMemo(() => {
    const m = new Map<Region, number>([
      ["Middle East", 0],
      ["APAC", 0],
      ["Country not identified", 0],
    ]);
    enriched.forEach((i) => {
      if (i.region === "Out of scope") return;
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
    const sorted = [...enriched]
      .filter((i) => !isNaN(i.occurredDate.getTime()))
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
    return sorted.find((i) => i.severity === "extreme" || i.severity === "high") ?? sorted[0] ?? null;
  }, [enriched]);

  // Vessels Attacked — derive from the already-scoped `enriched` list so this
  // section honours the same APAC + Middle East filter as the rest of the page.
  const vesselIncidents = useMemo(() => {
    return enriched
      .map((i) => ({ ...i, vesselType: classifyVesselIncident(i) }))
      .filter((i): i is typeof i & { vesselType: VesselIncidentType } => i.vesselType !== null)
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
  }, [enriched]);
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
      const records = sortedEnriched.filter((i) => detectChokepoints(i).includes(cp));
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

  // --- Piracy and Armed Robbery -------------------------------------------
  const piracyIncidents = useMemo(() => {
    return sortedEnriched
      .map((i) => ({ ...i, piracyAct: classifyPiracy(i) }))
      .filter((i): i is typeof i & { piracyAct: PiracyAct } => i.piracyAct !== null);
  }, [sortedEnriched]);

  // Vessel attack / seizure count (excludes piracy — that has its own count).
  const vesselAttackOrSeizureCount = useMemo(
    () => vesselIncidents.filter((v) => v.vesselType === "Attack" || v.vesselType === "Seized").length,
    [vesselIncidents],
  );

  // Page render
  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* 1. Header */}
      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Shipping</h1>
        <p className="text-sm text-muted-foreground font-sans mt-1 max-w-4xl">
          Port disruption, chokepoint risk, vessel attacks, route diversion, shipping delays, insurance pressure, naval advisories, port strikes and cargo movement disruption. APAC and the Middle East only — records from other regions are excluded. Cargo theft and pilferage are tracked under Cargo Watch.
        </p>
      </div>

      {outOfScopeCount > 0 && (
        <div className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-sm px-3 py-2">
          {outOfScopeCount} shipping record{outOfScopeCount === 1 ? "" : "s"} from outside APAC and the Middle East (e.g. North America, Europe, Africa, South America) are excluded from this view.
        </div>
      )}

      {/* 2. Fast Facts */}
      <Section title="Fast Facts">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <FastFactCard
            label="Total Shipping Records"
            value={String(total)}
            note={`${last7} in the past 7 days · ${last30} in the past 30 days.`}
            accent="#4655FF"
          />
          <FastFactCard
            label="Highest Severity On File"
            value={highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"}
            note={
              highestSev
                ? `${highestSevCount} record${highestSevCount === 1 ? "" : "s"} at this rating across the dataset.`
                : "No severity recorded."
            }
            accent={highestSev ? ratingColor(highestSev) : "#B8C2CC"}
          />
          <FastFactCard
            label="Main Affected Region"
            value={mainRegion ? mainRegion.region : "—"}
            note={
              mainRegion
                ? `${mainRegion.count} of ${total} shipping records mapped to this region.`
                : "No regional distribution available."
            }
            accent={mainRegion ? REGION_COLOR[mainRegion.region] : "#B8C2CC"}
          />
          <FastFactCard
            label="Main Issue Type"
            value={mainIssue ? mainIssue.issue : "—"}
            note={
              mainIssue
                ? `${mainIssue.count} record${mainIssue.count === 1 ? "" : "s"} classified as ${mainIssue.issue.toLowerCase()}.`
                : "No issue classification available."
            }
            accent="#0B0B3D"
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
          />
        </div>
      </Section>

      {/* 3. Key Metrics */}
      <Section title="Key Metrics">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Records in Window" value={total} accent="#0B0B3D" />
          <Kpi
            label="Highest Severity"
            value={highestSev ? SEVERITY_LABELS[highestSev] ?? highestSev : "—"}
            accent={highestSev ? ratingColor(highestSev) : "#B8C2CC"}
            small
          />
          <Kpi
            label="Main Affected Chokepoint"
            value={mainChokepoint ? mainChokepoint.key : (mainRegion?.region ?? "—")}
            accent={mainChokepoint ? "#0B0B3D" : (mainRegion ? REGION_COLOR[mainRegion.region] : "#B8C2CC")}
            small
          />
          <Kpi label="Vessel Attacks / Seizures" value={vesselAttackOrSeizureCount} accent="#C0392B" />
          <Kpi label="Piracy / Armed Robbery" value={piracyIncidents.length} accent="#E67E22" />
          <Kpi
            label="Latest Significant Incident"
            value={latestSignificant ? format(latestSignificant.occurredDate, "dd MMM yyyy") : "—"}
            accent={latestSignificant ? ratingColor(latestSignificant.severity) : "#B8C2CC"}
            small
          />
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
                      : `${row.count} record${row.count === 1 ? "" : "s"} on file. Most recent: ${row.latest!.title}.`}
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
              <Kpi label="Total vessel incidents" value={vesselIncidents.length} accent="#0B0B3D" />
              <Kpi label="Attacks" value={vesselCounts.Attack} accent={VESSEL_ACCENT.Attack} />
              <Kpi label="Near miss" value={vesselCounts["Near miss"]} accent={VESSEL_ACCENT["Near miss"]} />
              <Kpi label="Seized" value={vesselCounts.Seized} accent={VESSEL_ACCENT.Seized} />
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
                    sourceUrl={v.sourceUrl ?? null}
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
                      {i.sourceUrl ? (
                        <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs">
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
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
              <YAxis dataKey="issue" type="category" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} width={200} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
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
                ? `${transitRecords.length} record${transitRecords.length === 1 ? "" : "s"} on file covering chokepoint risk, route diversion and maritime advisories. Most recent: ${transitRecords[0].title}.`
                : null
            }
          />
          <IntelCard
            label="Vessel Threat / Piracy"
            body={
              vesselIncidents.length + piracyIncidents.length > 0
                ? `${vesselAttackOrSeizureCount} vessel attack/seizure record${vesselAttackOrSeizureCount === 1 ? "" : "s"} and ${piracyIncidents.length} piracy/armed-robbery record${piracyIncidents.length === 1 ? "" : "s"} on file. Most recent vessel item: ${vesselIncidents[0]?.title ?? piracyIncidents[0]?.title ?? "—"}.`
                : null
            }
          />
          <IntelCard
            label="Commercial Impact"
            body={
              commercialRecords.length > 0
                ? `${commercialRecords.length} record${commercialRecords.length === 1 ? "" : "s"} on port disruption, freight or insurance pressure and commercial shipping disruption. Most recent: ${commercialRecords[0].title}.`
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
                  <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} interval="preserveStartEnd" />
                  <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
                  <Line type="monotone" dataKey="count" stroke="#0B0B3D" strokeWidth={2} dot={{ r: 3, stroke: "#0B0B3D", strokeWidth: 1.5, fill: "#4655FF", fillOpacity: FILL_OPACITY }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Incidents by Region">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byRegion} layout="vertical" margin={{ left: 24, right: 16 }}>
                <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
                <XAxis type="number" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
                <YAxis dataKey="region" type="category" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} width={130} />
                <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
                <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                  {byRegion.map((d) => {
                    const c = REGION_COLOR[d.region as Region];
                    return <Cell key={d.region} fill={c} stroke={darken(c)} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Incidents by Country (Top 12)">
            {byCountry.length === 0 ? (
              <EmptyChart message="No identified countries in shipping records." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCountry} margin={{ left: 8, right: 16, bottom: 40 }}>
                  <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
                  <XAxis dataKey="country" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={60} />
                  <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#4655FF" stroke={darken("#4655FF")} strokeWidth={STROKE_WIDTH} fillOpacity={FILL_OPACITY} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Severity Distribution">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySeverity}>
                <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} />
                <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
                <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
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
                            {i.sourceUrl ? (
                              <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-xs" aria-label="Open source">
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

function FastFactCard({ label, value, note, accent }: { label: string; value: string; note: string; accent: string }) {
  return (
    <div className="bg-white border border-border rounded-sm p-3 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: accent }} />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mt-1">{label}</div>
      <div className="font-serif font-bold text-primary leading-tight mt-1 text-xl">{value}</div>
      <div className="text-[11px] text-muted-foreground font-sans mt-2 leading-snug">{note}</div>
    </div>
  );
}

function Kpi({ label, value, accent, small }: { label: string; value: string | number; accent: string; small?: boolean }) {
  return (
    <div className="bg-white border border-border rounded-sm p-3 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: accent }} />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans pl-2">{label}</div>
      <div className={"font-serif font-bold leading-none text-primary mt-2 pl-2 " + (small ? "text-lg" : "text-2xl")}>{value}</div>
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
