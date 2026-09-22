import { useEffect, useRef, useState } from "react";
import {
  DbPortsEdition,
  DbPortsEvidence,
  DbPortsItem,
  DbPortsItemContent,
  getGetDbPortsEditionQueryKey,
  useDeleteDbPortsItem,
  useMergeDbPortsItems,
  useRegenerateDbPortsItem,
  useUpdateDbPortsItem,
} from "@workspace/api-client-react";
import {
  DB_PORTS_COUNTRIES,
  DB_PORTS_IMPACT_AREAS,
  DB_PORTS_SEVERITIES,
  DB_PORTS_THEMES,
  dbPortsThemeLabel,
} from "@workspace/db-ports";
import { AlertTriangle, GitMerge, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

interface Props {
  edition: DbPortsEdition;
  itemId: string;
  onDirtyChange?: (dirty: boolean) => void;
  onDeleted?: () => void;
}

const DISPOSITIONS = ["selected", "watch", "hold", "inbox", "rejected"] as const;
const CONFIDENCES = ["unverified", "single_source", "corroborated", "official"] as const;
const SOURCE_TYPES = ["official", "specialist", "news", "discovery"] as const;
const UNASSESSED = "__unassessed__";

function toContent(item: DbPortsItem): DbPortsItemContent {
  const { id: _id, mergedInto: _mergedInto, updatedAt: _updatedAt, warnings: _warnings, drafted: _drafted, ...content } = item;
  return content;
}

function wordCount(...values: string[]): number {
  return values.join(" ").split(/\s+/).filter(Boolean).length;
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{children}</span>;
}

export default function DbPortsItemEditor({ edition, itemId, onDirtyChange, onDeleted }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateMutation = useUpdateDbPortsItem();
  const deleteMutation = useDeleteDbPortsItem();
  const regenerateMutation = useRegenerateDbPortsItem();
  const mergeMutation = useMergeDbPortsItems();

  const item = edition.items.find((entry) => entry.id === itemId);
  const [form, setForm] = useState<DbPortsItemContent | null>(null);
  const loadedFor = useRef<string>("");
  const baseline = useRef<string>("");

  useEffect(() => {
    if (!item) return;
    const signature = `${item.id}:${item.updatedAt}`;
    if (loadedFor.current === signature) return;
    const clean = getNormalised(form);
    if (loadedFor.current.startsWith(`${item.id}:`) && clean !== baseline.current) return; // keep unsaved edits
    const content = toContent(item);
    setForm(content);
    baseline.current = getNormalised(content);
    loadedFor.current = signature;
  }, [item, form]);

  useEffect(() => {
    if (form) onDirtyChange?.(getNormalised(form) !== baseline.current);
  }, [form, onDirtyChange]);

  if (!item || !form) return <div className="text-sm text-muted-foreground">Item not found.</div>;

  const busy =
    updateMutation.isPending || deleteMutation.isPending || regenerateMutation.isPending || mergeMutation.isPending;

  const apply = (updated: DbPortsEdition) => qc.setQueryData(getGetDbPortsEditionQueryKey(edition.id), updated);
  const failed = (title: string) => (error: any) =>
    toast({
      variant: "destructive",
      title,
      description:
        error?.status === 409
          ? "This report changed elsewhere. Your text is still on screen — copy it, then reload."
          : error?.data?.error || "Unknown error",
    });

  const set = <K extends keyof DbPortsItemContent>(key: K, value: DbPortsItemContent[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = () => {
    const captured = form;
    updateMutation.mutate(
      { id: edition.id, itemId: item.id, data: { revision: edition.revision, item: captured } },
      {
        onSuccess: (updated) => {
          apply(updated);
          baseline.current = getNormalised(captured);
          loadedFor.current = "";
          onDirtyChange?.(false);
          toast({ title: "Item saved" });
        },
        onError: failed("Save failed"),
      },
    );
  };

  const handleRegenerate = () => {
    if (getNormalised(form) !== baseline.current && !confirm("Regenerating replaces the drafted text. Discard your unsaved edits?")) return;
    regenerateMutation.mutate(
      { id: edition.id, itemId: item.id, data: { revision: edition.revision } },
      {
        onSuccess: (updated) => {
          apply(updated);
          baseline.current = "";
          loadedFor.current = "";
          onDirtyChange?.(false);
          toast({ title: "Item redrafted from its own sources" });
        },
        onError: failed("Redraft failed"),
      },
    );
  };

  const handleDelete = () => {
    if (!confirm("Delete this item from the report?")) return;
    deleteMutation.mutate(
      { id: edition.id, itemId: item.id, data: { revision: edition.revision } },
      {
        onSuccess: (updated) => {
          apply(updated);
          onDirtyChange?.(false);
          onDeleted?.();
          toast({ title: "Item deleted" });
        },
        onError: failed("Delete failed"),
      },
    );
  };

  const handleMerge = () => {
    const sourceId = prompt("Paste the id of the duplicate report to fold into this item. Its sources are kept as corroboration.");
    if (!sourceId) return;
    mergeMutation.mutate(
      { id: edition.id, data: { revision: edition.revision, targetItemId: item.id, sourceItemId: sourceId.trim() } },
      {
        onSuccess: (updated) => {
          apply(updated);
          loadedFor.current = "";
          toast({ title: "Duplicate folded in" });
        },
        onError: failed("Merge failed"),
      },
    );
  };

  const updateEvidence = (index: number, patch: Partial<DbPortsEvidence>) =>
    setForm((prev) =>
      prev
        ? { ...prev, evidence: prev.evidence.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)) }
        : prev,
    );

  const words = wordCount(form.summary, form.operationalImpact, form.polestarView, form.outlook);
  const limit = edition.parameters.itemWordTarget;

  return (
    <div className="space-y-6 pb-20">
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background pb-4 pt-2">
        <div>
          <h2 className="font-serif text-xl font-bold text-primary">Edit item</h2>
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{item.id}</span>
            <span>{item.drafted ? "drafted by generator" : "analyst item"}</span>
            {item.mergedInto ? <span className="font-bold uppercase text-amber-600">folded into another item</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" title="Fold a duplicate into this item" onClick={handleMerge} disabled={busy}>
            <GitMerge className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={busy} data-testid="button-regenerate-item">
            <RefreshCw className="mr-2 h-4 w-4" /> Regenerate item
          </Button>
          <Button variant="ghost" size="icon" className="text-destructive" onClick={handleDelete} disabled={busy} data-testid="button-delete-item">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button onClick={handleSave} disabled={busy} data-testid="button-save-item">
            <Save className="mr-2 h-4 w-4" /> Save item
          </Button>
        </div>
      </div>

      {item.warnings.length > 0 && (
        <div className="rounded-sm border border-amber-500/60 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" /> Editor checks — never exported
          </div>
          <ul className="mt-1 list-disc pl-5">
            {item.warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12">
          <Label>Headline</Label>
          <Input className="font-serif text-lg" value={form.headline} onChange={(event) => set("headline", event.target.value)} data-testid="input-headline" />
        </div>
        <div className="col-span-12 sm:col-span-3">
          <Label>Country</Label>
          <Select value={form.country} onValueChange={(value) => set("country", value)}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {DB_PORTS_COUNTRIES.map((country) => <SelectItem key={country} value={country}>{country}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-12 sm:col-span-3">
          <Label>Location</Label>
          <Input value={form.location} onChange={(event) => set("location", event.target.value)} />
        </div>
        <div className="col-span-12 sm:col-span-3">
          <Label>Event date</Label>
          <Input type="date" value={form.eventDate ?? ""} onChange={(event) => set("eventDate", event.target.value || null)} />
        </div>
        <div className="col-span-12 sm:col-span-3">
          <Label>Theme</Label>
          <Select value={form.theme} onValueChange={(value) => set("theme", value as DbPortsItemContent["theme"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DB_PORTS_THEMES.map((theme) => <SelectItem key={theme} value={theme}>{dbPortsThemeLabel(theme)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-12 sm:col-span-3">
          <Label>Severity</Label>
          <Select
            value={form.severity ?? UNASSESSED}
            onValueChange={(value) => set("severity", value === UNASSESSED ? null : (value as DbPortsItemContent["severity"]))}
          >
            <SelectTrigger data-testid="select-item-severity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSESSED}>Not assessed</SelectItem>
              {DB_PORTS_SEVERITIES.map((severity) => <SelectItem key={severity} value={severity}>{severity}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-12 sm:col-span-3">
          <Label>Placement</Label>
          <Select value={form.disposition} onValueChange={(value) => set("disposition", value as DbPortsItemContent["disposition"])}>
            <SelectTrigger data-testid="select-item-disposition"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DISPOSITIONS.map((disposition) => <SelectItem key={disposition} value={disposition}>{disposition}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-12 sm:col-span-3">
          <Label>Verification status</Label>
          <Select value={form.confidence} onValueChange={(value) => set("confidence", value as DbPortsItemContent["confidence"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONFIDENCES.map((confidence) => (
                <SelectItem key={confidence} value={confidence}>{confidence.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-12 sm:col-span-3">
          <Label>Port, terminal or corridor</Label>
          <Input
            value={form.assets.join(", ")}
            onChange={(event) => set("assets", event.target.value.split(",").map((asset) => asset.trim()).filter(Boolean))}
          />
        </div>
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <div className="flex items-baseline justify-between">
          <h3 className="font-serif text-lg font-bold">Item text</h3>
          <span className={`font-mono text-xs ${words > limit ? "text-amber-600" : "text-muted-foreground"}`}>
            {words} words / {limit} max
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Summary</Label>
            <Textarea className="min-h-[140px]" value={form.summary} onChange={(event) => set("summary", event.target.value)} data-testid="input-summary" />
          </div>
          <div>
            <Label>Operational Impact</Label>
            <Textarea className="min-h-[140px]" value={form.operationalImpact} onChange={(event) => set("operationalImpact", event.target.value)} />
          </div>
          <div>
            <Label>Polestar View</Label>
            <Textarea className="min-h-[140px]" value={form.polestarView} onChange={(event) => set("polestarView", event.target.value)} />
          </div>
          <div>
            <Label>Outlook and indicators</Label>
            <Textarea className="min-h-[140px]" value={form.outlook} onChange={(event) => set("outlook", event.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Reason it is material (watchlist reason; not exported for items)</Label>
            <Input value={form.materialityReason} onChange={(event) => set("materialityReason", event.target.value)} />
          </div>
          <div>
            <Label>Unverified claims (editor note)</Label>
            <Input value={form.unverifiedClaims} onChange={(event) => set("unverifiedClaims", event.target.value)} />
          </div>
          <div>
            <Label>Missing information (editor note)</Label>
            <Input value={form.missingInfo} onChange={(event) => set("missingInfo", event.target.value)} />
          </div>
          <div>
            <Label>Analyst notes (editor note)</Label>
            <Input value={form.analystNotes} onChange={(event) => set("analystNotes", event.target.value)} />
          </div>
        </div>
        <div>
          <Label>Impact areas</Label>
          <div className="flex flex-wrap gap-4">
            {DB_PORTS_IMPACT_AREAS.map((area) => (
              <label key={area} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.impactAreas.includes(area)}
                  onCheckedChange={(checked) =>
                    set(
                      "impactAreas",
                      checked === true ? [...form.impactAreas, area] : form.impactAreas.filter((entry) => entry !== area),
                    )
                  }
                />
                <span className="capitalize">{area.replaceAll("_", " ")}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold">Sources</h3>
          <Button
            size="sm"
            variant="outline"
            data-testid="button-add-source"
            onClick={() =>
              set("evidence", [
                ...form.evidence,
                {
                  id: Math.random().toString(36).slice(2, 10),
                  sourceName: "",
                  sourceUrl: "",
                  sourceType: "news",
                  publishedDate: null,
                  sourceDate: null,
                  retrievedAt: new Date().toISOString(),
                  excerpt: "",
                  originalTitle: "",
                  sourceRecord: null,
                  verified: false,
                },
              ])
            }
          >
            <Plus className="mr-2 h-4 w-4" /> Add source
          </Button>
        </div>
        {form.evidence.map((entry, index) => (
          <div key={entry.id} className="space-y-3 rounded-sm border border-border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="grid flex-1 grid-cols-12 gap-3">
                <div className="col-span-12 sm:col-span-4">
                  <Label>Source name</Label>
                  <Input value={entry.sourceName} disabled={!!entry.sourceRecord} onChange={(event) => updateEvidence(index, { sourceName: event.target.value })} />
                </div>
                <div className="col-span-12 sm:col-span-5">
                  <Label>Hyperlink</Label>
                  <Input value={entry.sourceUrl} disabled={!!entry.sourceRecord} onChange={(event) => updateEvidence(index, { sourceUrl: event.target.value })} />
                </div>
                <div className="col-span-12 sm:col-span-3">
                  <Label>Type</Label>
                  <Select value={entry.sourceType} onValueChange={(value) => updateEvidence(index, { sourceType: value as DbPortsEvidence["sourceType"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SOURCE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-12 sm:col-span-6">
                  <Label>Source title</Label>
                  <Input value={entry.originalTitle} disabled={!!entry.sourceRecord} onChange={(event) => updateEvidence(index, { originalTitle: event.target.value })} />
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <Label>Publication date</Label>
                  <Input type="date" value={entry.publishedDate ?? ""} onChange={(event) => updateEvidence(index, { publishedDate: event.target.value || null })} />
                </div>
                <div className="col-span-6 sm:col-span-3 flex items-end pb-2">
                  <label className="flex items-center gap-2 text-xs font-bold">
                    <Checkbox checked={entry.verified} onCheckedChange={(checked) => updateEvidence(index, { verified: checked === true })} />
                    <span>Checked</span>
                  </label>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                title="Remove this source"
                onClick={() => set("evidence", form.evidence.filter((_, position) => position !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {form.evidence.length === 0 && <div className="text-sm text-muted-foreground">No sources attached.</div>}
      </div>
    </div>
  );
}

function getNormalised(value: unknown): string {
  if (!value) return "";
  const sortKeys = (input: any): any => {
    if (Array.isArray(input)) return input.map(sortKeys);
    if (input !== null && typeof input === "object") {
      return Object.keys(input)
        .sort()
        .reduce((acc: any, key: string) => {
          acc[key] = sortKeys(input[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return JSON.stringify(sortKeys(value));
}
