import { useState } from "react";
import { useRoute } from "wouter";
import { useListStrikes, useGetStrikeSummary } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { munitionLabel } from "@/lib/topics";

const WINDOWS = [7, 14, 30, 60, 90, 120] as const;

export default function Strikes() {
  const [, params] = useRoute("/strikes/:theatre");
  const slug = params?.theatre ?? "maritime";
  const theatre: "maritime_hormuz" | "land_gcc" = slug === "land" ? "land_gcc" : "maritime_hormuz";
  const [days, setDays] = useState<number>(30);

  const { data: strikes = [] } = useListStrikes({ theatre, days: days as 7 });
  const { data: summary } = useGetStrikeSummary({ theatre, days: days as 7 });

  const droneShare = summary?.total
    ? Math.round(((summary.byMunition.find((b) => b.key === "drone")?.count ?? 0) / summary.total) * 100)
    : 0;

  const title = theatre === "maritime_hormuz"
    ? "Missile Strike Tracker · Strait of Hormuz (Maritime)"
    : "Missile Strike Tracker · GCC (Land Based)";

  return (
    <div className="max-w-[1800px] mx-auto space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Strike Tracker</div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">{title}</h1>
        </div>
        <div className="flex border border-border rounded-sm overflow-hidden">
          {WINDOWS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                "px-3 py-2 text-xs uppercase tracking-wider font-serif font-medium",
                days === d ? "bg-accent text-accent-foreground" : "bg-card hover:bg-muted",
              )}
            >{d}d</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border p-px rounded-sm">
        <Kpi label="Total Strikes" value={summary?.total ?? 0} />
        <Kpi label="Total Casualties" value={summary?.totalCasualties ?? 0} alert={(summary?.totalCasualties ?? 0) > 0} />
        <Kpi label="Drone Share" value={`${droneShare}%`} accent />
        <Kpi label="Countries Affected" value={summary?.byCountry.length ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Daily Activity">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={summary?.timeline ?? []}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} />
              <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Line type="monotone" dataKey="count" stroke="#4655FF" strokeWidth={2} dot={{ fill: "#4655FF" }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="By Munition">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={summary?.byMunition ?? []}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis dataKey="key" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} tickFormatter={munitionLabel} />
              <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count" fill="#4655FF" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="By Infrastructure">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={summary?.byInfrastructure ?? []}>
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis dataKey="key" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} tickFormatter={munitionLabel} />
              <YAxis tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count" fill="#0B0B3D" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="By Country">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={summary?.byCountry ?? []} layout="vertical">
              <CartesianGrid stroke="#E2E2E2" strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} />
              <YAxis dataKey="key" type="category" tickLine={false} axisLine={{ stroke: "#E2E2E2" }} fontSize={10} width={110} />
              <Tooltip contentStyle={{ background: "#0B0B3D", border: "none", color: "#fff", fontSize: 12 }} />
              <Bar dataKey="count" fill="#4655FF" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="bg-card border border-border rounded-sm">
        <div className="p-3 border-b border-border bg-muted/50 font-serif font-bold uppercase text-sm text-primary">Strike Log</div>
        <div className="grid grid-cols-[180px_140px_1fr_140px_140px_100px_80px] text-[10px] font-sans uppercase tracking-widest text-muted-foreground bg-muted/30 border-b border-border">
          <div className="p-3">Occurred</div><div className="p-3">Country</div><div className="p-3">Location</div>
          <div className="p-3">Munition</div><div className="p-3">Target</div><div className="p-3">Casualties</div><div className="p-3">Conf</div>
        </div>
        {strikes.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No strikes in selected window.</div>
        ) : (
          <div className="divide-y divide-border">
            {strikes.map((s) => (
              <div key={s.id} className="grid grid-cols-[180px_140px_1fr_140px_140px_100px_80px] items-center text-sm hover:bg-muted/30">
                <div className="p-3 font-mono text-xs">{format(new Date(s.occurredAt), "dd MMM yyyy HH:mm")}</div>
                <div className="p-3 text-xs">{s.country}</div>
                <div className="p-3 text-xs truncate">{s.location ?? "—"}</div>
                <div className="p-3 text-xs uppercase font-serif">{munitionLabel(s.munition)}</div>
                <div className="p-3 text-xs">{munitionLabel(s.targetCategory)}</div>
                <div className="p-3 text-xs font-mono">{s.casualties ?? 0}</div>
                <div className="p-3 text-xs uppercase font-serif">{s.confidence}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-sm p-4">
      <h2 className="font-serif font-bold uppercase text-primary text-sm mb-3 tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

function Kpi({ label, value, accent, alert }: { label: string; value: string | number; accent?: boolean; alert?: boolean }) {
  return (
    <div className={cn("bg-card p-4", alert && "bg-destructive/5", accent && "bg-accent/5")}>
      <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className={cn("text-3xl font-serif font-bold leading-none", alert ? "text-destructive" : accent ? "text-accent" : "text-primary")}>
        {value}
      </div>
    </div>
  );
}
