import { useMemo, useState } from "react";
import {
  useListSources, useGetSourceHealth, useGetIntegrationStatus,
  useCreateSource, useUpdateSource, useDeleteSource,
  getListSourcesQueryKey, getGetSourceHealthQueryKey, getGetDashboardOverviewQueryKey,
  type Source,
  type IntegrationStatusItem,
  type IntegrationStatusState,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TOPICS, TOPIC_LABELS, SOURCE_TYPES, SOURCE_STATUSES } from "@/lib/topics";
import { sourceStatusBadgeClass, sourceStatusLabel, formatSourceTimestamp, effectiveSourceStatus, isSourceActionRequired, isSourceRetrying } from "@/lib/sourceHealth";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Operational-impact playbook for non-operational sources. Each entry
// gives operations staff a clear issue / impact / required-action read
// without forcing them to interpret raw status enums or error blobs.
interface ActionPlaybook {
  issue: string;
  impact: string;
  action: string;
}
const ACTION_PLAYBOOK: Record<string, ActionPlaybook> = {
  failing: {
    issue: "Source is returning errors on collection.",
    impact: "Topic feed is degraded — backfill missing for the affected window.",
    action: "Investigate the upstream error, restore credentials or scraper, and replay the missing window.",
  },
  blocked: {
    issue: "Source is actively blocking the collector (rate-limit, IP ban, CAPTCHA, or paywall).",
    impact: "No new records on this source until access is restored.",
    action: "Rotate credentials / IP, negotiate access with the publisher, or replace the source with an equivalent.",
  },
  stale: {
    issue: "No fresh records inside the staleness window.",
    impact: "Topic feed has a coverage gap that may not be obvious in the dashboard.",
    action: "Confirm upstream cadence, refresh credentials, and verify the parser still matches the source schema.",
  },
  delayed: {
    issue: "Records are arriving later than the published SLA.",
    impact: "Reports built late in the cycle may miss the latest items from this source.",
    action: "Contact upstream provider to confirm SLA; treat the source as advisory until cadence recovers.",
  },
  not_configured: {
    issue: "Source has been listed but never wired up.",
    impact: "Source contributes zero records — onboarding is the bottleneck.",
    action: "Complete onboarding (credentials, parser, manual workflow) or remove from the source list.",
  },
};
function playbookFor(status: string): ActionPlaybook | null {
  return ACTION_PLAYBOOK[status] ?? null;
}

// Badge styling for the six unified integration states. Deliberately reserves
// the subdued-red brand colour (#A33232) for the EXTREME severity tier ONLY —
// none of these states uses it. Neutral states (not configured / disabled /
// unknown) read muted, not alarming, because every integration here is OPTIONAL
// and degrades gracefully when absent.
const INTEGRATION_BADGE: Record<IntegrationStatusState, string> = {
  working: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  failing_upstream: "bg-orange-100 text-orange-800 border border-orange-200",
  no_data: "bg-amber-100 text-amber-800 border border-amber-200",
  pending: "bg-amber-100 text-amber-800 border border-amber-200",
  not_configured: "bg-muted text-muted-foreground border border-border",
  disabled: "bg-muted text-muted-foreground border border-border",
  unknown: "bg-muted text-muted-foreground border border-border",
};
const INTEGRATION_LABEL: Record<IntegrationStatusState, string> = {
  working: "Working",
  failing_upstream: "Upstream failing",
  no_data: "No data yet",
  pending: "Pending approval",
  not_configured: "Not configured",
  disabled: "Disabled",
  unknown: "Unknown",
};

function IntegrationRow({ item }: { item: IntegrationStatusItem }) {
  return (
    <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-[1.2fr_1.6fr_1.1fr] gap-3 text-sm">
      <div>
        <div className="font-serif font-bold text-primary">{item.label}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className={cn("px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm", INTEGRATION_BADGE[item.status])}>
            {INTEGRATION_LABEL[item.status]}
          </span>
          {item.optional && (
            <span className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">Optional</span>
          )}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground mt-1.5 break-all">
          {item.envVars.join(" · ")}
        </div>
      </div>
      <div>
        <div className="text-foreground">{item.summary}</div>
        {item.detail && <div className="text-xs text-muted-foreground mt-1">{item.detail}</div>}
        {item.docsUrl && (
          <a
            href={item.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent underline mt-1 inline-block"
          >
            Documentation
          </a>
        )}
      </div>
      <div>
        <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-1">Evidence</div>
        {item.metrics.length === 0 ? (
          <div className="text-xs text-muted-foreground">—</div>
        ) : (
          <div className="space-y-0.5">
            {item.metrics.map((m, i) => (
              <div key={i} className="flex justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{m.label}</span>
                <span className="font-mono text-foreground">{m.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IntegrationsPanel() {
  const { data, isLoading } = useGetIntegrationStatus();
  const integrations = data?.integrations ?? [];
  return (
    <div className="bg-card border border-border rounded-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="text-sm font-serif font-bold uppercase tracking-wide text-primary">External Integrations</div>
        <div className="text-xs text-muted-foreground ml-1">
          Optional enrichment &amp; overlay services — each degrades gracefully when absent
        </div>
      </div>
      {isLoading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Checking integrations…</div>
      ) : integrations.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">No integration status available.</div>
      ) : (
        <div className="divide-y divide-border">
          {integrations.map((it) => (
            <IntegrationRow key={it.key} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sources() {
  const qc = useQueryClient();
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("");
  // Fetch the full source list once, then derive both the filtered
  // table view and the (unfiltered) Action Required panel from the
  // same dataset. This avoids a duplicate `/api/sources` round trip.
  const { data: allSources = [] } = useListSources();
  const { data: health } = useGetSourceHealth();
  const [editing, setEditing] = useState<Source | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const del = useDeleteSource();

  const sources = useMemo(
    () =>
      allSources.filter(
        (s) =>
          (!topic || s.topic === topic) &&
          (!status ||
            (status === "retrying"
              ? isSourceRetrying(s)
              : effectiveSourceStatus(s) === status)),
      ),
    [allSources, topic, status],
  );

  const actionItems = useMemo(
    () =>
      allSources
        // A source recovered by timestamp (latest success newer than latest
        // failure) drops out immediately, so a self-healed transient blip never
        // lingers in Action Required until the next ingest run.
        .filter((s) => isSourceActionRequired(s))
        .sort((a, b) => {
          const order: Record<string, number> = {
            failing: 0, blocked: 1, stale: 2, not_configured: 3, delayed: 4,
          };
          const oa = order[effectiveSourceStatus(a)] ?? 9;
          const ob = order[effectiveSourceStatus(b)] ?? 9;
          if (oa !== ob) return oa - ob;
          return a.name.localeCompare(b.name);
        }),
    [allSources],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListSourcesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSourceHealthQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
  };

  return (
    <div className="max-w-[1800px] mx-auto space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Operations</div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Source Health</h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">Live status of every collection source feeding the workbench</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"><Plus className="w-4 h-4 mr-2" /> Add Source</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-serif uppercase tracking-wide">New Source</DialogTitle></DialogHeader>
            <SourceForm onSaved={() => { invalidate(); setAddOpen(false); }} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-8 gap-px bg-border p-px rounded-sm">
        <Kpi label="Total Sources" value={health?.total ?? 0} />
        <Kpi label="Manual Review" value={health?.manualReviewCount ?? 0} alert={(health?.manualReviewCount ?? 0) > 0} />
        {SOURCE_STATUSES.map((s) => {
          const c = health?.byStatus.find((b) => b.status === s)?.count ?? 0;
          return <Kpi key={s} label={sourceStatusLabel(s)} value={c} />;
        })}
      </div>

      {actionItems.length > 0 && (
        <div className="bg-card border border-border rounded-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-destructive/5">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <div className="text-sm font-serif font-bold uppercase tracking-wide text-destructive">
              Action Required
            </div>
            <div className="text-xs text-muted-foreground ml-1">
              {actionItems.length} source{actionItems.length === 1 ? "" : "s"} need operations follow-up
            </div>
          </div>
          <div className="divide-y divide-border">
            {actionItems.map((s) => {
              const pb = playbookFor(s.status);
              if (!pb) return null;
              const issueText = s.errorMessage?.trim() || pb.issue;
              return (
                <div key={s.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1fr] gap-3 text-sm">
                  <div>
                    <div className="font-serif font-bold text-primary">{s.name}</div>
                    <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mt-1">
                      {TOPIC_LABELS[s.topic] ?? s.topic}
                    </div>
                    <div className="mt-1">
                      <span className={cn("px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm", sourceStatusBadgeClass(s.status))}>
                        {sourceStatusLabel(s.status)}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-1">Issue</div>
                    <div className="text-foreground">{issueText}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Impact: {pb.impact}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-1">Required Action</div>
                    <div className="text-foreground">{pb.action}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mb-1">Owner / Status</div>
                    <div className="text-foreground">{s.notes?.trim() || "Unassigned — assign an owner in source notes."}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Last success: {formatSourceTimestamp(s.lastSuccessAt)}
                      {s.lastFailureAt ? ` · Last failure: ${formatSourceTimestamp(s.lastFailureAt)}` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <IntegrationsPanel />

      <div className="bg-card border border-border rounded-sm p-3 flex gap-2">
        <Select value={topic || "all"} onValueChange={(v) => setTopic(v === "all" ? "" : v)}>
          <SelectTrigger className="rounded-sm w-48"><SelectValue placeholder="All topics" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All topics</SelectItem>
            {TOPICS.map((t) => <SelectItem key={t} value={t}>{TOPIC_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="rounded-sm w-48"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="retrying">retrying</SelectItem>
            {SOURCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-sm overflow-hidden">
        <div className="grid grid-cols-[1.5fr_120px_100px_110px_90px_160px_160px_1fr_80px] text-[10px] font-sans uppercase tracking-widest text-muted-foreground bg-muted/50 border-b border-border">
          <div className="p-3">Name</div><div className="p-3">Topic</div><div className="p-3">Type</div><div className="p-3">Status</div>
          <div className="p-3">Reliability</div><div className="p-3">Last Success</div><div className="p-3">Last Failure</div>
          <div className="p-3">Error</div><div className="p-3"></div>
        </div>
        {sources.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No sources match.</div>
        ) : (
          <div className="divide-y divide-border">
            {sources.map((s) => (
              <div key={s.id} className="grid grid-cols-[1.5fr_120px_100px_110px_90px_160px_160px_1fr_80px] items-center text-sm hover:bg-muted/30">
                <div className="p-3">
                  <div className="font-serif font-bold text-primary">{s.name}</div>
                  {s.manualReviewRequired && <div className="text-[10px] uppercase tracking-widest text-destructive mt-0.5">Manual review</div>}
                </div>
                <div className="p-3 text-xs">{TOPIC_LABELS[s.topic]}</div>
                <div className="p-3 text-xs uppercase font-serif">{s.sourceType}</div>
                <div className="p-3">
                  <span className={cn("px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm", sourceStatusBadgeClass(effectiveSourceStatus(s)))}>{sourceStatusLabel(effectiveSourceStatus(s))}</span>
                  {isSourceRetrying(s) && (
                    <div className="flex items-center gap-1 mt-1" title={`Failed ${s.consecutiveFailures}x in a row — retrying on the next ingest run, not yet a sustained outage`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span className="text-[10px] font-sans uppercase tracking-wider text-amber-600">Retrying ({s.consecutiveFailures}x)</span>
                    </div>
                  )}
                </div>
                <div className="p-3"><Dots filled={s.reliability} /></div>
                <div className="p-3 text-xs font-mono text-muted-foreground">{formatSourceTimestamp(s.lastSuccessAt)}</div>
                <div className="p-3 text-xs font-mono text-muted-foreground">{formatSourceTimestamp(s.lastFailureAt)}</div>
                <div className="p-3 text-xs text-muted-foreground truncate">{s.errorMessage ?? "—"}</div>
                <div className="p-3 flex items-center gap-2">
                  <button onClick={() => setEditing(s)} className="text-muted-foreground hover:text-accent"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => { if (confirm("Delete source?")) del.mutate({ id: s.id }, { onSuccess: invalidate }); }} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-serif uppercase tracking-wide">Edit Source</DialogTitle></DialogHeader>
          {editing && <SourceForm key={editing.id} initial={editing} onSaved={() => { invalidate(); setEditing(null); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Dots({ filled }: { filled: number }) {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={cn("w-2 h-2 rounded-full", i < filled ? "bg-accent" : "bg-border")} />
      ))}
    </div>
  );
}

function Kpi({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={cn("bg-card p-3", alert && "bg-destructive/5")}>
      <div className="text-[9px] font-sans uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className={cn("text-2xl font-serif font-bold leading-none", alert ? "text-destructive" : "text-primary")}>{value}</div>
    </div>
  );
}

function SourceForm({ initial, onSaved }: { initial?: Source; onSaved: () => void }) {
  const create = useCreateSource();
  const update = useUpdateSource();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    topic: initial?.topic ?? "fuel",
    sourceType: initial?.sourceType ?? "rss",
    url: initial?.url ?? "",
    status: initial?.status ?? "operational",
    reliability: initial?.reliability ?? 3,
    manualReviewRequired: initial?.manualReviewRequired ?? false,
    notes: initial?.notes ?? "",
    errorMessage: initial?.errorMessage ?? "",
  });
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const submit = () => {
    const data = {
      name: form.name, topic: form.topic, sourceType: form.sourceType,
      url: form.url || undefined, status: form.status, reliability: form.reliability,
      manualReviewRequired: form.manualReviewRequired,
      notes: form.notes || undefined, errorMessage: form.errorMessage || undefined,
    } as never;
    if (initial) update.mutate({ id: initial.id, data }, { onSuccess: onSaved });
    else create.mutate({ data }, { onSuccess: onSaved });
  };
  return (
    <div className="space-y-3">
      <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} className="rounded-sm" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Topic">
          <Select value={form.topic} onValueChange={(v) => set("topic", v)}>
            <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{TOPICS.map((t) => <SelectItem key={t} value={t}>{TOPIC_LABELS[t]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Type">
          <Select value={form.sourceType} onValueChange={(v) => set("sourceType", v)}>
            <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{SOURCE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="URL"><Input value={form.url} onChange={(e) => set("url", e.target.value)} className="rounded-sm" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select value={form.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{SOURCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Reliability (0-5)"><Input type="number" min={0} max={5} value={form.reliability} onChange={(e) => set("reliability", parseInt(e.target.value || "0"))} className="rounded-sm" /></Field>
      </div>
      <Field label="Error Message"><Input value={form.errorMessage} onChange={(e) => set("errorMessage", e.target.value)} className="rounded-sm" /></Field>
      <Field label="Notes"><Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} className="rounded-sm" /></Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.manualReviewRequired} onChange={(e) => set("manualReviewRequired", e.target.checked)} />
        Requires manual review
      </label>
      <Button onClick={submit} className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm w-full">{initial ? "Save" : "Create"}</Button>
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
