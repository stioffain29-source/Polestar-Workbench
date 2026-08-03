import { SEVERITY_LABELS, severityBadgeStyle } from "@/lib/topics";
import {
  SOUTH_ASIA_FUEL_ALERT,
  type FuelDisruptionAlert,
  type FuelDisruptionCountry,
} from "@/lib/fuelDisruptionAlert";

// Brand palette (no shadows / gradients per spec).
const MIDNIGHT = "#0b0a3d";
const ELECTRIC = "#465bff";

function StatusPill({ active }: { active: boolean }) {
  const style = active
    ? { background: "#6FB872", color: "#0b0a3d" }
    : { background: "#e2e2e2", color: "#363636" };
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

// Undefined/empty fields are omitted entirely rather than shown as a
// "Not reported" placeholder — the alert dataset is intentionally sparse
// per-country (see fuelDisruptionAlert.ts), and a blank field is not new
// information worth a row of its own.
function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">{label}</div>
      <div className="text-sm font-sans mt-0.5 leading-snug text-primary">{value}</div>
    </div>
  );
}

function FieldList({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) {
    return null;
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
  // Only the dimensions the alert actually reports get a row — undefined
  // fields (e.g. Bangladesh/Nepal have no aviation or power impact data)
  // are dropped rather than padded out with "Not reported" placeholders.
  const impactFields: { label: string; value: string }[] = [
    { label: "Fuel availability", value: c.fuelAvailability },
    { label: "Transport impact", value: c.transportImpact },
    { label: "Business impact", value: c.businessImpact },
    { label: "Aviation impact", value: c.aviationImpact },
    { label: "Power impact", value: c.powerImpact },
    { label: "Protest / unrest risk", value: c.protestRisk },
    { label: "Operational impact", value: c.operationalImpact },
  ].filter((f): f is { label: string; value: string } => Boolean(f.value));

  return (
    <div className="bg-white border border-border rounded-sm overflow-hidden">
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
        {impactFields.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3 border-t border-border">
            {impactFields.map((f) => (
              <Field key={f.label} label={f.label} value={f.value} />
            ))}
          </div>
        )}
        <FieldList label="Government measures" items={c.governmentMeasures} />
        <div className="pt-1 border-t border-border" style={{ borderTopColor: ELECTRIC }}>
          <div className="text-[10px] uppercase tracking-widest font-sans" style={{ color: ELECTRIC }}>
            Polestar view
          </div>
          <div className="text-sm font-sans text-primary mt-0.5 leading-snug">{c.polestarView}</div>
        </div>
        <FieldList label="Advice" items={c.advice} />
        <FieldList label="Watch next" items={c.watchNext} />
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
          style={{ borderColor: "#e2e2e2", color: "#363636" }}
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
        <div className="flex flex-col gap-4">
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
