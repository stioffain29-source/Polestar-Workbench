import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListIncidents,
  useListDataCentreFacilities,
} from "@workspace/api-client-react";
import { format, differenceInDays, parseISO } from "date-fns";
import {
  BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, LabelList,
} from "recharts";
import {
  SEVERITY_LEVELS, SEVERITY_LABELS, severityBadgeStyle, ratingColor,
} from "@/lib/topics";
import { resolveTrueIncidents } from "@/lib/trueIncidents";
import { RangeToggle } from "@/components/RangeToggle";
import { RANGE_DAYS, RANGE_LABEL, RANGE_NOTE, type RangeKey } from "@/lib/dateRange";
import { CountryChoroplethMap, buildCountryIntensity } from "@/components/CountryChoroplethMap";
import { DataCentreFacilityMap, statusColor } from "@/components/DataCentreFacilityMap";
import { incidentSourceUrl } from "@/lib/incidentSourceUrl";
import { displayIncidentTitle } from "@/lib/incidentTitle";
import { ExternalLink, Server } from "lucide-react";

const FILL_OPACITY = 0.78;
const STROKE_WIDTH = 1.5;
const SEV_RANK: Record<string, number> = { insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5 };

function darken(hex: string, amount = 0.18): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function cleanCountry(c?: string | null): string | null {
  if (!c) return null;
  const t = c.trim();
  if (!t || /^unknown$/i.test(t)) return null;
  return t;
}

// Registry status → marker colour is the single source of truth exported from
// DataCentreFacilityMap.tsx (STATUS_COLOR / statusColor), imported above so the
// registry list and the facility map can never drift apart.

export default function DataCentres() {
  const { data: rawIncidents = [], isLoading } = useListIncidents({ topic: "data_centres" as never });
  const { data: facilities = [], isLoading: facLoading } = useListDataCentreFacilities();

  const [range, setRange] = useState<RangeKey>("2y");
  const windowDays = RANGE_DAYS[range];
  const now = new Date();

  const trueIncidents = useMemo(
    () => resolveTrueIncidents("data_centres", rawIncidents),
    [rawIncidents],
  );

  const enriched = useMemo(
    () =>
      trueIncidents.map((i) => ({
        ...i,
        country: cleanCountry((i as { country?: string | null }).country),
        occurredDate: (() => { try { return parseISO(i.occurredAt); } catch { return new Date(NaN); } })(),
      })),
    [trueIncidents],
  );

  const total = enriched.length;

  const inWindow = useMemo(
    () => enriched.filter(
      (i) => !isNaN(i.occurredDate.getTime()) && differenceInDays(now, i.occurredDate) <= windowDays,
    ),
    [enriched, windowDays],
  );
  const countWindow = inWindow.length;
  const criticalWindow = useMemo(
    () => inWindow.filter((i) => i.severity === "high" || i.severity === "extreme").length,
    [inWindow],
  );

  const latest = useMemo(() => {
    const sorted = [...enriched]
      .filter((i) => !isNaN(i.occurredDate.getTime()))
      .sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime());
    return sorted[0] ?? null;
  }, [enriched]);

  // Incident countries (windowed) → choropleth intensity.
  const byCountry = useMemo(() => {
    const m = new Map<string, number>();
    inWindow.forEach((i) => {
      if (!i.country) return;
      m.set(i.country, (m.get(i.country) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);
  }, [inWindow]);
  const countryIntensity = useMemo(() => buildCountryIntensity(byCountry), [byCountry]);
  const countriesAffected = byCountry.length;

  const bySeverity = useMemo(
    () => SEVERITY_LEVELS.map((s) => ({
      severity: s,
      label: SEVERITY_LABELS[s] ?? s,
      count: inWindow.filter((i) => i.severity === s).length,
    })),
    [inWindow],
  );

  const sortedForTable = useMemo(
    () => [...inWindow].sort((a, b) => b.occurredDate.getTime() - a.occurredDate.getTime()),
    [inWindow],
  );

  // --- Registry (facilities) ------------------------------------------------
  const facByStatus = useMemo(() => {
    const m = new Map<string, number>();
    facilities.forEach((f) => m.set(f.status, (m.get(f.status) ?? 0) + 1));
    return Array.from(m.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [facilities]);

  const facByPlanningRisk = useMemo(() => {
    const m = new Map<string, number>();
    facilities.forEach((f) => {
      if (f.planningRisk === "No known issue" || f.planningRisk === "Unknown") return;
      m.set(f.planningRisk, (m.get(f.planningRisk) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [facilities]);

  const recentMovers = useMemo(
    () => facilities.filter((f) => f.statusChanged),
    [facilities],
  );

  const facCountries = useMemo(() => {
    const s = new Set<string>();
    facilities.forEach((f) => { if (f.country) s.add(f.country); });
    return s.size;
  }, [facilities]);

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitor</div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Data Centres</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1 max-w-4xl">
            Data-centre build-out, planning, power/water constraint and operational-risk monitor.
            The incident feed and the analyst facility registry are kept strictly separate — a
            tracked facility is never an incident.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/registry/data-centres"
            className="flex items-center gap-2 h-9 px-4 border border-border rounded-sm text-sm font-medium font-sans hover:bg-muted"
          >
            <Server className="w-4 h-4" /> Manage Registry
          </Link>
          <RangeToggle range={range} onChange={setRange} />
        </div>
      </div>

      {/* 1. Top metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label={`Incidents (${RANGE_LABEL[range]})`} value={countWindow} accent="#465bff" />
        <Kpi label={`Critical (${RANGE_LABEL[range]})`} value={criticalWindow} accent="#C0392B" />
        <Kpi label="Total Recorded" value={total} accent="#0b0a3d" />
        <Kpi label="Countries Affected" value={countriesAffected} accent="#363636" />
        <Kpi label="Facilities Tracked" value={facilities.length} accent="#1B6B7A" />
      </div>

      {/* 2. Registry summary */}
      <Section title="Facility Registry">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <FastFactCard
            label="Facilities Tracked"
            value={String(facilities.length)}
            note={facilities.length ? `Across ${facCountries} countr${facCountries === 1 ? "y" : "ies"}.` : "No facilities on file."}
            accent="#465bff"
          />
          <FastFactCard
            label="Operational"
            value={String(facByStatus.find((s) => s.label === "Operational")?.value ?? 0)}
            note="Facilities recorded as operational."
            accent="#1B6B7A"
          />
          <FastFactCard
            label="Planning-Risk Flags"
            value={String(facByPlanningRisk.reduce((a, b) => a + b.value, 0))}
            note="Facilities carrying a known planning or build-out risk."
            accent="#E67E22"
          />
          <FastFactCard
            label="Recent Status Movers"
            value={String(recentMovers.length)}
            note="Facilities whose status recently changed."
            accent="#A33232"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <ChartCard title="Facilities by Status">
            {facByStatus.length === 0 ? (
              <EmptyChart message="No facilities on file." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={facByStatus} margin={{ top: 16, left: 8, right: 16, bottom: 60 }}>
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={80} />
                  <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="value" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                    {facByStatus.map((d) => {
                      const c = statusColor(d.label);
                      return <Cell key={d.label} fill={c} stroke={darken(c)} />;
                    })}
                    <LabelList dataKey="value" position="top" fontSize={12} fontWeight={700} fill="#303030" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Facilities by Planning Risk">
            {facByPlanningRisk.length === 0 ? (
              <EmptyChart message="No planning-risk flags on file." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={facByPlanningRisk} margin={{ top: 16, left: 8, right: 16, bottom: 60 }}>
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={80} />
                  <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="value" fill="#E67E22" stroke={darken("#E67E22")} strokeWidth={STROKE_WIDTH} fillOpacity={FILL_OPACITY}>
                    <LabelList dataKey="value" position="top" fontSize={12} fontWeight={700} fill="#303030" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </Section>

      {/* 3. Geography — incident choropleth + purpose-built facility overlay */}
      <Section title="Geography">
        <div className="grid grid-cols-1 gap-4">
          <div className="bg-white border border-border rounded-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-sans">
              Incident Density by Country ({RANGE_LABEL[range]})
            </div>
            <CountryChoroplethMap
              intensity={countryIntensity}
              legendLabel="Incident Count"
              scope="world"
              emptyText="No identified incident countries in this window."
            />
          </div>

          <div className="bg-white border border-border rounded-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground font-sans">
              Facility &amp; Incident Overlay ({RANGE_LABEL[range]})
            </div>
            {facLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              <DataCentreFacilityMap facilities={facilities} incidents={inWindow} />
            )}
          </div>
        </div>
      </Section>

      {/* 4. Charts (incidents) */}
      <Section title="Incident Charts">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Severity Distribution">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySeverity} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} />
                <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                <Bar dataKey="count" fillOpacity={FILL_OPACITY} strokeWidth={STROKE_WIDTH}>
                  {bySeverity.map((d) => {
                    const c = ratingColor(d.severity);
                    return <Cell key={d.severity} fill={c} stroke={darken(c)} />;
                  })}
                  <LabelList dataKey="count" position="top" fontSize={13} fontWeight={700} fill="#303030" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Top Countries by Incident Count">
            {byCountry.length === 0 ? (
              <EmptyChart message="No identified countries on file." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCountry.slice(0, 12)} margin={{ top: 16, left: 8, right: 16, bottom: 40 }}>
                  <CartesianGrid stroke="#e2e2e2" strokeDasharray="3 3" />
                  <XAxis dataKey="country" tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={10} angle={-35} textAnchor="end" interval={0} height={60} />
                  <YAxis tickLine={false} axisLine={{ stroke: "#e2e2e2" }} fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0b0a3d", border: "none", color: "#fff", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#465bff" stroke={darken("#465bff")} strokeWidth={STROKE_WIDTH} fillOpacity={FILL_OPACITY}>
                    <LabelList dataKey="count" position="top" fontSize={12} fontWeight={700} fill="#303030" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </Section>

      {/* 5. Recent status movers */}
      {recentMovers.length > 0 && (
        <Section title="Recent Status Movers">
          <div className="bg-white border border-border rounded-sm overflow-x-auto">
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="px-4 py-2 font-medium">Facility</th>
                  <th className="px-4 py-2 font-medium">Country</th>
                  <th className="px-4 py-2 font-medium">Moved From</th>
                  <th className="px-4 py-2 font-medium">Current Status</th>
                  <th className="px-4 py-2 font-medium">Changed</th>
                </tr>
              </thead>
              <tbody>
                {recentMovers.map((f) => (
                  <tr key={f.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">{f.name}</td>
                    <td className="px-4 py-2.5 text-foreground">{f.country}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{f.previousStatus ?? "—"}</td>
                    <td className="px-4 py-2.5 text-foreground">{f.status}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {f.statusChangedAt ? format(parseISO(f.statusChangedAt), "dd MMM yyyy") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* 6. Incident table */}
      <Section title="Incidents">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : sortedForTable.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground italic bg-white border border-border rounded-sm">
            No data-centre incidents reported in the {RANGE_NOTE[range]}.
          </div>
        ) : (
          <div className="bg-white border border-border rounded-sm overflow-x-auto">
            <table className="w-full text-sm font-sans">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Country</th>
                  <th className="px-4 py-2 font-medium">Headline</th>
                  <th className="px-4 py-2 font-medium">Severity</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {sortedForTable.map((i) => {
                  const url = incidentSourceUrl(i);
                  return (
                    <tr key={i.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                        {isNaN(i.occurredDate.getTime()) ? "—" : format(i.occurredDate, "dd MMM yyyy")}
                      </td>
                      <td className="px-4 py-2.5 text-foreground whitespace-nowrap">{i.country ?? "—"}</td>
                      <td className="px-4 py-2.5 text-foreground">{displayIncidentTitle(i.title, i.displayTitle)}</td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 text-[11px] rounded-sm font-sans" style={severityBadgeStyle(i.severity)}>
                          {SEVERITY_LABELS[i.severity] ?? i.severity}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
                            Open <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function Kpi({ label, value, accent, small }: { label: string; value: number | string; accent: string; small?: boolean }) {
  return (
    <div className="bg-white border border-border rounded-sm p-4" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">{label}</div>
      <div className={`font-serif font-bold text-primary mt-1 ${small ? "text-lg" : "text-2xl"}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-serif font-bold text-primary uppercase tracking-wide mb-3">{title}</h2>
      {children}
    </section>
  );
}

function FastFactCard({ label, value, note, accent }: { label: string; value: string; note: string; accent: string }) {
  return (
    <div className="bg-white border border-border rounded-sm p-4" style={{ borderLeft: `3px solid ${accent}` }}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">{label}</div>
      <div className="text-xl font-serif font-bold text-primary mt-1">{value}</div>
      <div className="text-xs text-muted-foreground mt-1 font-sans">{note}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-border rounded-sm p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans mb-3">{title}</div>
      <div className="h-[280px]">{children}</div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">{message}</div>;
}
