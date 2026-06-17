type GdeltFields = {
  fatalities?: number | null;
  actors?: string | null;
  gdeltEventType?: string | null;
  gdeltSubEventType?: string | null;
  gdeltConfidence?: number | null;
};

export function hasGdeltCoding(i: GdeltFields): boolean {
  return (
    i.fatalities != null ||
    !!i.actors ||
    !!i.gdeltEventType ||
    !!i.gdeltSubEventType ||
    i.gdeltConfidence != null
  );
}

/**
 * GDELT precision-enrichment display. The GDELT pass attaches ACLED-style
 * structured coding (named actors, event/sub-event type, fatalities, AI
 * confidence) to the subset of flashpoint rows it matched. Renders nothing when
 * no field is present so absence shows no empty labels — graceful fallback.
 *
 * `variant="block"` is the full labelled panel for the incident detail sheet;
 * `variant="inline"` is a compact chip row for dense table cells.
 */
export function GdeltCoding({ incident, variant = "block" }: { incident: GdeltFields; variant?: "block" | "inline" }) {
  if (!hasGdeltCoding(incident)) return null;

  const event = [incident.gdeltEventType, incident.gdeltSubEventType].filter(Boolean).join(" · ");
  const confidence = incident.gdeltConfidence != null ? `${Math.round(incident.gdeltConfidence * 100)}%` : null;

  if (variant === "inline") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 text-[10px] font-sans font-semibold uppercase tracking-wider text-accent">
          GDELT
        </span>
        {incident.fatalities != null && (
          <span><span className="font-semibold">Fatalities:</span> {incident.fatalities}</span>
        )}
        {incident.actors && (
          <span><span className="font-semibold">Actors:</span> {incident.actors}</span>
        )}
        {event && (
          <span><span className="font-semibold">Event:</span> {event}</span>
        )}
        {confidence && (
          <span><span className="font-semibold">Confidence:</span> {confidence}</span>
        )}
      </div>
    );
  }

  return (
    <div className="border border-border rounded-sm p-3 bg-muted/20">
      <div className="text-[11px] font-sans font-semibold uppercase tracking-wider text-accent">
        GDELT structured coding
      </div>
      <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
        ACLED-style detail from GDELT's AI-coded event matched to this incident. Shown only where GDELT covered the event.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
        {incident.fatalities != null && <Field label="Fatalities" value={String(incident.fatalities)} />}
        {incident.actors && <Field label="Actors" value={incident.actors} />}
        {event && <Field label="Event" value={event} />}
        {confidence && <Field label="Confidence" value={confidence} />}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-medium text-sm mt-0.5">{value}</div>
    </div>
  );
}
