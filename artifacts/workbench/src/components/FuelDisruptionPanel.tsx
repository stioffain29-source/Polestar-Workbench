import { SEVERITY_LABELS, severityBadgeStyle } from "@/lib/topics";
import {
  SOUTH_ASIA_FUEL_ALERT,
  type FuelDisruptionAlert,
  type FuelDisruptionCountry,
} from "@/lib/fuelDisruptionAlert";

// Brand palette (no shadows / gradients per spec).
const MIDNIGHT = "#0B0B3D";
const ELECTRIC = "#4655FF";

const NOT_REPORTED = "Not reported";

function StatusPill({ active }: { active: boolean }) {
  const style = active
    ? { background: "#6FB872", color: "#0B0B3D" }
    : { background: "#E2E2E2", color: "#303030" };
  return (
    <span
      className="text-[10px] font-sans uppercase tracking-widest px-2 py-0.5 rounded-sm"
      style={style}
    >
      {active ? "Active" : "Expired"}
    </span>
  );
}

function ConcernBadge({ concern }: { concern: FuelDisruptionCountry["concern"] }) {
  return (
    <span
      className="text-[10px] font-sans uppercase tracking-widest px-2 py-0.5 rounded-sm whitespace-nowrap"
      style={severityBadgeStyle(concern)}
    >
      {SEVERITY_LABELS[concern]}
    </span>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-serif font-bold uppercase text-primary text-base tracking-wide border-b-2 border-accent pb-1 inline-block">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">{label}</div>
      <div className={"text-sm font-sans mt-0.5 leading-snug " + (value ? "text-primary" : "text-muted-foreground italic")}>
        {value || NOT_REPORTED}
      </div>
    </div>
  );
}

function FieldList({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) {
    return <Field label={label} value={undefined} />;
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">{label}</div>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-sm font-sans text-primary leading-snug flex gap-2">
            <span aria-hidden style={{ color: ELECTRIC }}>—</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CountryCard({ c }: { c: FuelDisruptionCountry }) {
  return (
    <div className="bg-white border border-border rounded-sm overflow-hidden flex flex-col">
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5"
        style={{ background: MIDNIGHT }}
      >
        <h3 className="font-serif font-bold uppercase text-white text-lg tracking-wide leading-none">
          {c.country}
        </h3>
        <ConcernBadge concern={c.concern} />
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Event type" value={c.eventType} />
          <Field label="Status" value={c.status} />
          <Field label="Time frame" value={c.timeFrame} />
        </div>
        <Field label="Fuel availability" value={c.fuelAvailability} />
        <FieldList label="Government measures" items={c.governmentMeasures} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border">
          <Field label="Transport impact" value={c.transportImpact} />
          <Field label="Business impact" value={c.businessImpact} />
          <Field label="Aviation impact" value={c.aviationImpact} />
          <Field label="Power impact" value={c.powerImpact} />
          <Field label="Protest / unrest risk" value={c.protestRisk} />
          <Field label="Operational impact" value={c.operationalImpact} />
        </div>
        <div className="pt-1 border-t border-border" style={{ borderTopColor: ELECTRIC }}>
          <div className="text-[10px] uppercase tracking-widest font-sans" style={{ color: ELECTRIC }}>
            Polestar view
          </div>
          <div className="text-sm font-sans text-primary mt-0.5 leading-snug">{c.polestarView}</div>
        </div>
        <FieldList label="Advice" items={c.advice} />
        {c.watchNext && c.watchNext.length > 0 && (
          <FieldList label="Watch next" items={c.watchNext} />
        )}
      </div>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {items.map((it, i) => (
        <span
          key={i}
          className="text-xs font-sans px-2 py-1 rounded-sm border"
          style={{ borderColor: "#E2E2E2", color: "#303030" }}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

export function FuelDisruptionPanel({ alert = SOUTH_ASIA_FUEL_ALERT }: { alert?: FuelDisruptionAlert }) {
  const active = new Date() <= new Date(alert.alertExpiresAt);

  return (
    <div className="space-y-6">
      {/* Header band */}
      <div className="rounded-sm overflow-hidden border border-border">
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3" style={{ background: MIDNIGHT }}>
          <div>
            <div className="text-[10px] font-sans uppercase tracking-[0.2em] text-white/70">
              Operational Fuel Disruption Alert
            </div>
            <h2 className="font-serif font-bold uppercase text-white text-2xl tracking-tight mt-1 leading-none">
              {alert.region}: {alert.event}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill active={active} />
            <div className="text-right">
              <div className="text-[10px] font-sans uppercase tracking-widest text-white/60">Highest concern</div>
              <div className="font-serif font-bold text-white text-lg leading-none mt-0.5">{alert.highestConcern}</div>
            </div>
          </div>
        </div>
        <div className="bg-white px-5 py-2 text-[11px] font-sans text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
          <span><span className="uppercase tracking-widest text-[10px]">Time frame:</span> {alert.timeFrame}</span>
          <span><span className="uppercase tracking-widest text-[10px]">Began:</span> {alert.alertBegan}</span>
          <span><span className="uppercase tracking-widest text-[10px]">Expires:</span> {alert.alertExpires}</span>
        </div>
      </div>

      {/* 1. Regional summary card */}
      <PanelSection title="Regional Summary">
        <div className="bg-white border border-border rounded-sm p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">Main drivers</div>
              <Chips items={alert.drivers} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">Primary impacts</div>
              <Chips items={alert.primaryImpacts} />
            </div>
          </div>
          <div className="pt-3 border-t-2" style={{ borderTopColor: ELECTRIC }}>
            <div className="text-[10px] uppercase tracking-widest font-sans" style={{ color: ELECTRIC }}>
              Polestar view
            </div>
            <p className="text-sm font-sans text-primary mt-1 leading-relaxed">{alert.polestarView}</p>
          </div>
        </div>
      </PanelSection>

      {/* 2. Country impact cards */}
      <PanelSection title="Country Impact">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {alert.countries.map((c) => (
            <CountryCard key={c.country} c={c} />
          ))}
        </div>
      </PanelSection>

      {/* 3. Operational impact */}
      <PanelSection title="Operational Impact">
        <div className="bg-white border border-border rounded-sm p-4">
          <ul className="space-y-2">
            {alert.operationalImpact.map((o) => (
              <li key={o.country} className="text-sm font-sans leading-snug flex gap-2">
                <span className="font-serif font-bold text-primary whitespace-nowrap">{o.country}:</span>
                <span className="text-primary">{o.impact}</span>
              </li>
            ))}
          </ul>
        </div>
      </PanelSection>

      {/* 4. Traveller and in-location advice */}
      <PanelSection title="Traveller & In-Location Advice">
        <div className="bg-white border border-border rounded-sm p-4">
          <ul className="space-y-2">
            {alert.travellerAdvice.map((a, i) => (
              <li key={i} className="text-sm font-sans text-primary leading-snug flex gap-2">
                <span aria-hidden style={{ color: ELECTRIC }}>—</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      </PanelSection>

      {/* 5. Watch next */}
      <PanelSection title="Watch Next">
        <div className="bg-white border border-border rounded-sm p-4">
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            {alert.watchNext.map((w, i) => (
              <li key={i} className="text-sm font-sans text-primary leading-snug flex gap-2">
                <span aria-hidden style={{ color: ELECTRIC }}>▸</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      </PanelSection>

      <p className="text-[11px] font-sans text-muted-foreground italic leading-snug border-t border-border pt-3">
        {alert.sourceNote}
      </p>
    </div>
  );
}
