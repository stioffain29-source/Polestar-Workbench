import { useEffect, useMemo, useState } from "react";
import {
  useListIncidents,
  useCreateIncident,
  useUpdateIncident,
  useDeleteIncident,
  getListIncidentsQueryKey,
  getGetDashboardOverviewQueryKey,
  type Incident,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { Plus, Search, Siren, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TOPICS, TOPIC_LABELS, SEVERITY_LEVELS, CONFIDENCE_LEVELS, severityBadgeStyle } from "@/lib/topics";
import { cn } from "@/lib/utils";

const WINDOWS = [7, 14, 30, 60, 90, 120];

export default function Incidents() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [topic, setTopic] = useState<string>("");
  const [country, setCountry] = useState("");
  const [severity, setSeverity] = useState<string>("");
  const [days, setDays] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setSelectedId(parseInt(id, 10));
  }, []);

  const params = useMemo(() => {
    const p: Record<string, unknown> = {};
    if (topic) p.topic = topic;
    if (country) p.country = country;
    if (severity) p.severity = severity;
    if (days) p.days = days;
    if (search) p.search = search;
    return p;
  }, [topic, country, severity, days, search]);

  const { data: incidents, isLoading } = useListIncidents(params);
  const selected = incidents?.find((i) => i.id === selectedId) ?? null;
  const deleteM = useDeleteIncident();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListIncidentsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight">Incident Database</h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">All recorded incidents across topics and theatres</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm">
          <Plus className="w-4 h-4 mr-2" /> Add Incident
        </Button>
      </div>

      <div className="bg-card border border-border rounded-sm p-3 grid grid-cols-2 md:grid-cols-6 gap-2">
        <Select value={topic || "all"} onValueChange={(v) => setTopic(v === "all" ? "" : v)}>
          <SelectTrigger className="rounded-sm"><SelectValue placeholder="All topics" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All topics</SelectItem>
            {TOPICS.map((t) => <SelectItem key={t} value={t}>{TOPIC_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className="rounded-sm" />
        <Select value={severity || "all"} onValueChange={(v) => setSeverity(v === "all" ? "" : v)}>
          <SelectTrigger className="rounded-sm"><SelectValue placeholder="All severities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {SEVERITY_LEVELS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={days ? String(days) : "all"} onValueChange={(v) => setDays(v === "all" ? undefined : parseInt(v))}>
          <SelectTrigger className="rounded-sm"><SelectValue placeholder="All time" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            {WINDOWS.map((d) => <SelectItem key={d} value={String(d)}>Last {d} days</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="md:col-span-2 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, summary, country..." className="pl-9 rounded-sm" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-sm overflow-hidden">
        <div className="grid grid-cols-[180px_120px_1fr_140px_100px_100px_140px_72px] text-[10px] font-sans uppercase tracking-widest text-muted-foreground bg-muted/50 border-b border-border">
          <div className="p-3">Occurred</div>
          <div className="p-3">Topic</div>
          <div className="p-3">Title</div>
          <div className="p-3">Country</div>
          <div className="p-3">Severity</div>
          <div className="p-3">Confidence</div>
          <div className="p-3">Source</div>
          <div className="p-3"></div>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : !incidents?.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No incidents match.</div>
        ) : (
          <div className="divide-y divide-border">
            {incidents.map((i) => (
              <div
                key={i.id}
                onClick={() => setSelectedId(i.id)}
                className="grid grid-cols-[180px_120px_1fr_140px_100px_100px_140px_72px] items-center hover:bg-muted/30 cursor-pointer text-sm"
              >
                <div className="p-3 font-mono text-xs">{format(new Date(i.occurredAt), "dd MMM yyyy HH:mm")}</div>
                <div className="p-3"><span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm bg-secondary text-secondary-foreground">{TOPIC_LABELS[i.topic] ?? i.topic}</span></div>
                <div className="p-3 font-medium truncate">{i.title}</div>
                <div className="p-3 text-xs">{i.country}</div>
                <div className="p-3"><span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(i.severity)}>{i.severity}</span></div>
                <div className="p-3 text-xs uppercase font-serif">{i.confidence}</div>
                <div className="p-3 text-xs text-muted-foreground truncate">{i.source ?? "—"}</div>
                <div className="p-3 flex items-center justify-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setLocation(`/spot-reports/new?incidentId=${i.id}`); }}
                    className="text-muted-foreground hover:text-accent"
                    aria-label="Create spot report"
                    title="Create spot report"
                  >
                    <Siren className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (confirm("Delete incident?")) deleteM.mutate({ id: i.id }, { onSuccess: invalidate }); }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="right" className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          {selected && <IncidentDetail key={selected.id} incident={selected} onSaved={invalidate} />}
        </SheetContent>
      </Sheet>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent side="right" className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader><SheetTitle className="font-serif uppercase tracking-wide">New Incident</SheetTitle></SheetHeader>
          <IncidentForm onSaved={() => { invalidate(); setAddOpen(false); }} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function IncidentDetail({ incident, onSaved }: { incident: Incident; onSaved: () => void }) {
  const [, setLocation] = useLocation();
  const [notes, setNotes] = useState(incident.analystNotes ?? "");
  const [severity, setSeverity] = useState<string>(incident.severity);
  const update = useUpdateIncident();
  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle className="font-serif uppercase tracking-wide">{incident.title}</SheetTitle>
      </SheetHeader>
      <Button
        variant="outline"
        onClick={() => setLocation(`/spot-reports/new?incidentId=${incident.id}`)}
        className="w-full rounded-sm"
      >
        <Siren className="w-4 h-4 mr-2" /> Create Spot Report
      </Button>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Meta label="Topic" value={TOPIC_LABELS[incident.topic] ?? incident.topic} />
        <Meta label="Country" value={incident.country} />
        <Meta label="Location" value={incident.location ?? "—"} />
        <Meta label="Occurred" value={format(new Date(incident.occurredAt), "dd MMM yyyy HH:mm")} />
        <Meta label="Confidence" value={incident.confidence} />
        <Meta label="Source" value={incident.source ?? "—"} />
      </div>
      <div>
        <label className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">Summary</label>
        <p className="text-sm mt-1">{incident.summary}</p>
      </div>
      {incident.sourceUrl && (
        <div className="text-xs">
          <a className="text-accent hover:underline" href={incident.sourceUrl} target="_blank" rel="noreferrer">{incident.sourceUrl}</a>
        </div>
      )}
      <div>
        <label className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">Severity</label>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="rounded-sm mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>{SEVERITY_LEVELS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">Analyst Notes</label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} className="mt-1 rounded-sm" />
      </div>
      <Button
        onClick={() => update.mutate({ id: incident.id, data: { analystNotes: notes, severity: severity as never } }, { onSuccess: onSaved })}
        className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
      >
        Save
      </Button>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-medium text-sm mt-0.5">{value}</div>
    </div>
  );
}

function IncidentForm({ onSaved }: { onSaved: () => void }) {
  const create = useCreateIncident();
  const [form, setForm] = useState({
    topic: "fuel",
    title: "",
    summary: "",
    country: "",
    location: "",
    severity: "low",
    confidence: "medium",
    source: "",
    sourceUrl: "",
    occurredAt: new Date().toISOString().slice(0, 16),
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-3 mt-4">
      <Field label="Title"><Input value={form.title} onChange={(e) => set("title", e.target.value)} className="rounded-sm" /></Field>
      <Field label="Topic">
        <Select value={form.topic} onValueChange={(v) => set("topic", v)}>
          <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{TOPICS.map((t) => <SelectItem key={t} value={t}>{TOPIC_LABELS[t]}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country"><Input value={form.country} onChange={(e) => set("country", e.target.value)} className="rounded-sm" /></Field>
        <Field label="Location"><Input value={form.location} onChange={(e) => set("location", e.target.value)} className="rounded-sm" /></Field>
      </div>
      <Field label="Occurred"><Input type="datetime-local" value={form.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} className="rounded-sm" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Severity">
          <Select value={form.severity} onValueChange={(v) => set("severity", v)}>
            <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{SEVERITY_LEVELS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Confidence">
          <Select value={form.confidence} onValueChange={(v) => set("confidence", v)}>
            <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{CONFIDENCE_LEVELS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Summary"><Textarea value={form.summary} onChange={(e) => set("summary", e.target.value)} rows={4} className="rounded-sm" /></Field>
      <Field label="Source"><Input value={form.source} onChange={(e) => set("source", e.target.value)} className="rounded-sm" /></Field>
      <Field label="Source URL"><Input value={form.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} className="rounded-sm" /></Field>
      <Button
        className="w-full bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
        disabled={!form.title || !form.country || !form.summary}
        onClick={() => create.mutate({ data: { ...form, occurredAt: new Date(form.occurredAt).toISOString() } as never }, { onSuccess: onSaved })}
      >Create Incident</Button>
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
