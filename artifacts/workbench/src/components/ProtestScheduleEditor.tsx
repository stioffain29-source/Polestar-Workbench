import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListProtestEventsQueryKey,
  useCreateProtestEvent,
  useUpdateProtestEvent,
  type ProtestEvent,
  type ProtestEventInput,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PROTEST_EMPTY_SENTENCE,
  PROTEST_FORECAST_HEADING,
  PROTEST_WATCHLIST_HEADING,
  protestScheduleActivity,
  type ProtestScheduleModel,
} from "@/lib/protestScheduleModel";

type Draft = {
  eventDate: string;
  country: string;
  city: string;
  venue: string;
  eventType: string;
  issue: string;
  organiser: string;
  description: string;
  startTime: string;
  attendance: string;
  disruptionPotential: string;
  confidence: "High" | "Moderate" | "Low";
  sourcePublishedAt: string;
  status: "Confirmed" | "Planned" | "Possible" | "Cancelled" | "Postponed";
  sourceTitle: string;
  sourceUrl: string;
};

function draftOf(row?: ProtestEvent): Draft {
  return {
    eventDate: row?.eventDate?.slice(0, 10) ?? "",
    country: row?.country ?? "",
    city: row?.city ?? "",
    venue: row?.venue ?? "",
    eventType: row?.eventType ?? "",
    issue: row?.issue ?? "",
    organiser: row?.organiser ?? "",
    description: row?.description ?? "",
    startTime: row?.startTime ?? "",
    attendance: row?.attendance == null ? "" : String(row.attendance),
    disruptionPotential: row?.disruptionPotential ?? "Moderate",
    confidence: row?.confidence ?? "Moderate",
    sourcePublishedAt: row?.sourcePublishedAt?.slice(0, 10) ?? "",
    status: row?.status ?? "Planned",
    sourceTitle: row?.sourceTitle ?? "",
    sourceUrl: row?.sourceUrl ?? "",
  };
}

function payloadOf(draft: Draft): ProtestEventInput {
  return {
    eventDate: draft.eventDate ? `${draft.eventDate}T00:00:00Z` : null,
    country: draft.country.trim(),
    city: draft.city.trim() || null,
    venue: draft.venue.trim() || null,
    eventType: draft.eventType.trim() || null,
    issue: draft.issue.trim() || null,
    organiser: draft.organiser.trim() || null,
    description: draft.description.trim() || null,
    startTime: draft.startTime.trim() || null,
    attendance: draft.attendance.trim() ? Number(draft.attendance) : null,
    disruptionPotential: (draft.disruptionPotential || null) as ProtestEventInput["disruptionPotential"],
    confidence: draft.confidence,
    status: draft.status,
    sourceTitle: draft.sourceTitle.trim() || draft.description.trim(),
    sourceUrl: draft.sourceUrl.trim(),
    sourcePublishedAt: draft.sourcePublishedAt
      ? `${draft.sourcePublishedAt}T00:00:00Z`
      : null,
  };
}

function ScheduleTable({
  rows,
  onEdit,
}: {
  rows: readonly ProtestEvent[];
  onEdit: (row: ProtestEvent) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto border border-border rounded-sm">
      <table className="min-w-[760px] w-full text-[11px]">
        <thead className="bg-muted/50 text-left uppercase tracking-wider text-[10px]">
          <tr>
            {["Date", "Country", "Location", "Scheduled activity", "Assessment", "Source", ""].map((label) => (
              <th key={label} className="px-2 py-2 whitespace-nowrap">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border align-top">
              <td className="px-2 py-2 whitespace-nowrap">{row.eventDate?.slice(0, 10) ?? "—"}</td>
              <td className="px-2 py-2">{row.country}</td>
              <td className="px-2 py-2">{row.venue ?? row.city ?? "—"}</td>
              <td className="px-2 py-2">{protestScheduleActivity(row)}</td>
              <td className="px-2 py-2">{row.disruptionPotential ?? row.confidence}</td>
              <td className="px-2 py-2 max-w-[180px] truncate">
                <a className="text-primary underline" href={row.sourceUrl} target="_blank" rel="noreferrer">{row.sourceTitle || row.sourceUrl}</a>
              </td>
              <td className="px-2 py-2"><Button type="button" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => onEdit(row)}>Edit</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ProtestScheduleEditor({
  model,
  collecting,
  onCollect,
}: {
  model: ProtestScheduleModel;
  collecting: boolean;
  onCollect: () => void;
}) {
  const qc = useQueryClient();
  const create = useCreateProtestEvent();
  const update = useUpdateProtestEvent();
  const [editing, setEditing] = useState<ProtestEvent | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf());
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState("");
  const rows = model.schedule.length + model.watchlist.length;
  const refresh = () => qc.invalidateQueries({ queryKey: getListProtestEventsQueryKey() });
  const set = (key: keyof Draft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const save = () => {
    const payload = payloadOf(draft);
    if (!payload.eventDate || !payload.country || !payload.description || !payload.sourceUrl) {
      setFormError("Date, country, scheduled activity and source link are required.");
      return;
    }
    setFormError("");
    const options = { onSuccess: () => { setEditing(null); setAdding(false); setFormError(""); refresh(); } };
    if (editing) update.mutate({ id: editing.id, data: payload }, options);
    else create.mutate({ data: payload }, options);
  };
  const editor = (editing || adding) && (
    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 border border-border rounded-sm p-3">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Date<Input type="date" value={draft.eventDate} onChange={(e) => set("eventDate", e.target.value)} className="h-8 mt-1 text-xs normal-case tracking-normal" /></label>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Country<Input value={draft.country} onChange={(e) => set("country", e.target.value)} className="h-8 mt-1 text-xs normal-case tracking-normal" /></label>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Location<Input value={draft.venue} onChange={(e) => set("venue", e.target.value)} className="h-8 mt-1 text-xs normal-case tracking-normal" /></label>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Assessment<select value={draft.disruptionPotential || "Moderate"} onChange={(e) => { set("disruptionPotential", e.target.value); set("confidence", e.target.value === "Extreme" ? "High" : e.target.value); }} className="h-8 mt-1 w-full border rounded-sm text-xs"><option>Low</option><option>Moderate</option><option>High</option><option>Extreme</option></select></label>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground md:col-span-2">Scheduled activity<Input value={draft.description} onChange={(e) => set("description", e.target.value)} className="h-8 mt-1 text-xs normal-case tracking-normal" /></label>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground md:col-span-2">Source link<Input type="url" value={draft.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} className="h-8 mt-1 text-xs normal-case tracking-normal" /></label>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status<select value={draft.status} onChange={(e) => set("status", e.target.value)} className="h-8 mt-1 w-full border rounded-sm text-xs"><option>Confirmed</option><option>Planned</option><option>Possible</option><option>Cancelled</option><option>Postponed</option></select></label>
      {formError && <p className="text-xs text-destructive md:col-span-2">{formError}</p>}
      <div className="col-span-full flex gap-2 justify-end"><Button type="button" variant="outline" className="h-8 text-xs" onClick={() => { setEditing(null); setAdding(false); setFormError(""); }}>Cancel</Button><Button type="button" className="h-8 text-xs" disabled={create.isPending || update.isPending} onClick={save}>{create.isPending || update.isPending ? "Saving…" : "Save event"}</Button></div>
    </div>
  );
  return (
    <section className="border border-border rounded-sm p-4 mb-4" data-testid="protest-schedule-editor">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-sm">{PROTEST_FORECAST_HEADING}</h3>
          <p className="text-[11px] text-muted-foreground">Forward-looking context only; these rows never change incident totals.</p>
        </div>
        <div className="flex gap-2"><Button type="button" variant="outline" className="h-8 text-xs" disabled={collecting} onClick={onCollect}>{collecting ? "Updating…" : "Collect / update schedule"}</Button><Button type="button" variant="outline" className="h-8 text-xs" onClick={() => { setAdding(true); setEditing(null); setFormError(""); setDraft(draftOf()); }}>Add event</Button></div>
      </div>
      {!model.searchCompleted && rows === 0 ? (
        <p className="text-xs text-muted-foreground">Automated protest search has not completed.</p>
      ) : model.empty ? (
        <p className="text-xs italic">{PROTEST_EMPTY_SENTENCE}</p>
      ) : (
        <>
          {!model.searchCompleted && <p className="text-[11px] italic text-muted-foreground mb-2">Automated protest search has not completed; displayed rows may be analyst-authored.</p>}
          <ScheduleTable rows={model.schedule} onEdit={(row) => { setEditing(row); setAdding(false); setFormError(""); setDraft(draftOf(row)); }} />
        </>
      )}
      {model.watchlist.length > 0 && <><h4 className="font-semibold text-xs mt-4 mb-2">{PROTEST_WATCHLIST_HEADING}</h4><ScheduleTable rows={model.watchlist} onEdit={(row) => { setEditing(row); setAdding(false); setFormError(""); setDraft(draftOf(row)); }} /></>}
      {rows === 0 && model.searchCompleted && !model.empty && <p className="text-xs italic">No possible mobilisation is currently listed.</p>}
      {editor}
    </section>
  );
}
