import { useState } from "react";
import { useCreateStrike, useListStrikes, getListStrikesQueryKey, getGetStrikeSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MUNITIONS, TARGET_CATEGORIES, INFRASTRUCTURE, CONFIDENCE_LEVELS, munitionLabel } from "@/lib/topics";
import { format } from "date-fns";

const INITIAL = {
  theatre: "maritime_hormuz",
  country: "",
  location: "",
  latitude: "",
  longitude: "",
  occurredAt: new Date().toISOString().slice(0, 16),
  munition: "drone",
  targetCategory: "vessel",
  infrastructure: "port",
  casualties: "",
  source: "",
  sourceUrl: "",
  confidence: "medium",
  summary: "",
  analystNotes: "",
};

export default function StrikesBackfill() {
  const qc = useQueryClient();
  const [form, setForm] = useState(INITIAL);
  const create = useCreateStrike();
  const { data: recent = [] } = useListStrikes({});
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    create.mutate(
      {
        data: {
          theatre: form.theatre as never,
          country: form.country,
          location: form.location || undefined,
          latitude: form.latitude ? parseFloat(form.latitude) : undefined,
          longitude: form.longitude ? parseFloat(form.longitude) : undefined,
          occurredAt: new Date(form.occurredAt).toISOString(),
          munition: form.munition as never,
          targetCategory: form.targetCategory as never,
          infrastructure: form.infrastructure as never,
          casualties: form.casualties ? parseInt(form.casualties) : undefined,
          source: form.source || undefined,
          sourceUrl: form.sourceUrl || undefined,
          confidence: form.confidence as never,
          summary: form.summary || undefined,
          analystNotes: form.analystNotes || undefined,
        } as never,
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListStrikesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetStrikeSummaryQueryKey() });
          setForm({ ...INITIAL, theatre: form.theatre, country: form.country });
        },
      },
    );
  };

  return (
    <div className="max-w-[1800px] mx-auto space-y-5">
      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Missile Strike Tracker</div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Run Backfill</h1>
        <p className="text-muted-foreground font-sans mt-1 text-sm">Record a historic or new missile strike event into the tracker.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_460px] gap-5">
        <div className="bg-card border border-border rounded-sm p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Theatre">
              <Select value={form.theatre} onValueChange={(v) => set("theatre", v)}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="maritime_hormuz">Maritime · Hormuz</SelectItem>
                  <SelectItem value="land_gcc">Land · GCC</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Country"><Input value={form.country} onChange={(e) => set("country", e.target.value)} className="rounded-sm" /></Field>
          </div>
          <Field label="Location"><Input value={form.location} onChange={(e) => set("location", e.target.value)} className="rounded-sm" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Latitude"><Input value={form.latitude} onChange={(e) => set("latitude", e.target.value)} className="rounded-sm" type="number" step="0.0001" /></Field>
            <Field label="Longitude"><Input value={form.longitude} onChange={(e) => set("longitude", e.target.value)} className="rounded-sm" type="number" step="0.0001" /></Field>
            <Field label="Occurred"><Input type="datetime-local" value={form.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} className="rounded-sm" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Munition">
              <Select value={form.munition} onValueChange={(v) => set("munition", v)}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{MUNITIONS.map((m) => <SelectItem key={m} value={m}>{munitionLabel(m)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Target Category">
              <Select value={form.targetCategory} onValueChange={(v) => set("targetCategory", v)}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{TARGET_CATEGORIES.map((t) => <SelectItem key={t} value={t}>{munitionLabel(t)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Infrastructure">
              <Select value={form.infrastructure} onValueChange={(v) => set("infrastructure", v)}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{INFRASTRUCTURE.map((i) => <SelectItem key={i} value={i}>{munitionLabel(i)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Casualties"><Input type="number" value={form.casualties} onChange={(e) => set("casualties", e.target.value)} className="rounded-sm" /></Field>
            <Field label="Confidence">
              <Select value={form.confidence} onValueChange={(v) => set("confidence", v)}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{CONFIDENCE_LEVELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Source"><Input value={form.source} onChange={(e) => set("source", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Source URL"><Input value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Summary"><Textarea rows={3} value={form.summary} onChange={(e) => set("summary", e.target.value)} className="rounded-sm" /></Field>
          <Field label="Analyst Notes"><Textarea rows={3} value={form.analystNotes} onChange={(e) => set("analystNotes", e.target.value)} className="rounded-sm" /></Field>
          <Button
            disabled={!form.country || !form.occurredAt}
            onClick={submit}
            className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
          >
            Record Strike
          </Button>
        </div>

        <div className="bg-card border border-border rounded-sm">
          <div className="p-3 border-b border-border bg-muted/50 font-serif font-bold uppercase text-sm text-primary">Recently Added</div>
          <div className="divide-y divide-border max-h-[700px] overflow-y-auto">
            {recent.slice(0, 20).map((s) => (
              <div key={s.id} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{format(new Date(s.occurredAt), "dd MMM yyyy HH:mm")}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-accent">{munitionLabel(s.munition)}</span>
                </div>
                <div className="mt-1 font-medium">{s.country}{s.location ? ` · ${s.location}` : ""}</div>
                {s.summary && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.summary}</div>}
              </div>
            ))}
            {recent.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No strikes recorded.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}
