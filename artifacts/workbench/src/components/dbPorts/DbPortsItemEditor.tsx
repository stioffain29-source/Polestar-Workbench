import { useState, useEffect, useRef } from "react";
import { 
  DbPortsEdition,
  DbPortsItem,
  useUpdateDbPortsItem,
  getGetDbPortsEditionQueryKey,
  DbPortsTheme,
  DbPortsItemContentDisposition,
  DbPortsItemContentSeverity,
  DbPortsItemContentConfidence,
  DbPortsImpactArea,
  DbPortsEvidence,
  DbPortsEvidenceSourceType
} from "@workspace/api-client-react";
import { DB_PORTS_COUNTRIES } from "@workspace/db-ports";
import { Save, Plus, Trash2, Link as LinkIcon, CheckCircle, GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useMergeDbPortsItems } from "@workspace/api-client-react";

interface Props {
  edition: DbPortsEdition;
  itemId: string;
  onDirtyChange?: (dirty: boolean) => void;
}

function getNormalizedItem(item: any) {
  if (!item) return "";
  const clone = JSON.parse(JSON.stringify(item));
  delete clone.id;
  delete clone.updatedAt;
  delete clone.blockers;
  delete clone.secondaryReviewRequired;
  delete clone.mergedInto;
  
  const sortKeys = (obj: any): any => {
    if (Array.isArray(obj)) return obj.map(sortKeys);
    if (obj !== null && typeof obj === "object") {
      return Object.keys(obj).sort().reduce((acc: any, key: string) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
    }
    return obj;
  };
  
  return JSON.stringify(sortKeys(clone));
}

export default function DbPortsItemEditor({ edition, itemId, onDirtyChange }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateMutation = useUpdateDbPortsItem();
  const mergeMutation = useMergeDbPortsItems();
  
  const item = edition.items.find(i => i.id === itemId);
  
  const [formData, setFormData] = useState<DbPortsItem | null>(null);
  const initializedForId = useRef<string | null>(null);
  const baseline = useRef<string>("");
  
  useEffect(() => {
    if (item && initializedForId.current !== itemId) {
      setFormData(JSON.parse(JSON.stringify(item)));
      baseline.current = getNormalizedItem(item);
      initializedForId.current = itemId;
    }
  }, [item, itemId]);
  
  useEffect(() => {
    if (formData) {
      const isDirty = getNormalizedItem(formData) !== baseline.current;
      onDirtyChange?.(isDirty);
    }
  }, [formData, onDirtyChange]);
  
  // Also update if the server revision changes and we aren't dirty? We just rely on manual save for this pilot editor to avoid complex autosave merge loops.
  
  if (!item || !formData) return <div>Item not found.</div>;
  
  const handleSave = () => {
    if (!formData) return;
    const capturedFormData = { ...formData };
    
    updateMutation.mutate(
      {
        id: edition.id,
        itemId: formData.id,
        data: {
          revision: edition.revision,
          item: capturedFormData
        }
      },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsEditionQueryKey(edition.id), updated);
          
          const updatedItem = updated.items.find(i => i.id === formData.id);
          if (updatedItem) {
            setFormData(prev => prev ? {
              ...prev,
              updatedAt: updatedItem.updatedAt,
              blockers: updatedItem.blockers,
              secondaryReviewRequired: updatedItem.secondaryReviewRequired,
              mergedInto: updatedItem.mergedInto
            } : prev);
          }
          
          baseline.current = getNormalizedItem(capturedFormData);
          onDirtyChange?.(getNormalizedItem(formData) !== baseline.current);
          toast({ title: "Item saved" });
        },
        onError: (err: any) => {
          if (err?.status === 409) {
            toast({ 
              variant: "destructive", 
              title: "Conflict Detected", 
              description: "This item was modified elsewhere. Your local edits have been preserved. Please copy your changes and reload the page." 
            });
          } else {
            toast({ variant: "destructive", title: "Save failed", description: err?.data?.error || "Unknown error" });
          }
        }
      }
    );
  };
  
  const updateField = (field: keyof DbPortsItem, value: any) => {
    setFormData(prev => prev ? { ...prev, [field]: value } : prev);
  };

  const handleMerge = () => {
    const sourceId = prompt("Enter the ID of the candidate to merge into this one:");
    if (!sourceId) return;
    
    mergeMutation.mutate(
      {
        id: edition.id,
        data: {
          revision: edition.revision,
          targetItemId: formData.id,
          sourceItemId: sourceId
        }
      },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsEditionQueryKey(edition.id), updated);
          toast({ title: "Items merged successfully" });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Merge failed", description: err?.data?.error });
        }
      }
    );
  };

  const toggleImpactArea = (area: DbPortsImpactArea) => {
    setFormData(prev => {
      if (!prev) return prev;
      const set = new Set(prev.impactAreas);
      if (set.has(area)) set.delete(area);
      else set.add(area);
      return { ...prev, impactAreas: Array.from(set) };
    });
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between sticky top-0 bg-background z-20 pb-4 pt-2 border-b border-border">
        <div>
          <h2 className="text-xl font-serif font-bold text-primary">Edit Item</h2>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-mono">ID: {item.id}</span>
            {item.mergedInto && <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider">MERGED</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={handleMerge} title="Merge another item into this one" disabled={mergeMutation.isPending}>
            <GitMerge className="w-4 h-4 text-muted-foreground" />
          </Button>
          <Select value={formData.disposition} onValueChange={(v: any) => updateField("disposition", v)}>
            <SelectTrigger className="w-[140px] font-bold text-xs uppercase tracking-wider"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.values(DbPortsItemContentDisposition).map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            <Save className="w-4 h-4 mr-2" /> Save Item
          </Button>
        </div>
      </div>
      
      {item.blockers && item.blockers.length > 0 && (
        <div className="bg-destructive/10 border border-destructive p-3 rounded-sm text-sm text-destructive">
          <strong>Blockers preventing approval:</strong>
          <ul className="list-disc pl-5 mt-1">
            {item.blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}

      {/* Core Metadata */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Headline</label>
          <Input className="font-serif text-lg" value={formData.headline} onChange={e => updateField("headline", e.target.value)} />
        </div>
        <div className="col-span-12 sm:col-span-3">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Country</label>
          <Select value={formData.country} onValueChange={v => updateField("country", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DB_PORTS_COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-12 sm:col-span-3">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Location</label>
          <Input value={formData.location} onChange={e => updateField("location", e.target.value)} />
        </div>
        <div className="col-span-12 sm:col-span-3">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Event Date</label>
          <Input type="date" value={formData.eventDate || ""} onChange={e => updateField("eventDate", e.target.value || null)} />
        </div>
        <div className="col-span-12 sm:col-span-3">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Theme</label>
          <Select value={formData.theme} onValueChange={v => updateField("theme", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.values(DbPortsTheme).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Severity</label>
          <Select value={formData.severity || "Unassessed"} onValueChange={(v: any) => updateField("severity", v === "Unassessed" ? null : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Unassessed">Unassessed</SelectItem>
              {Object.values(DbPortsItemContentSeverity).map(s => s && <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Confidence</label>
          <Select value={formData.confidence} onValueChange={v => updateField("confidence", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.values(DbPortsItemContentConfidence).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-12 sm:col-span-4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Assets (comma separated)</label>
          <Input value={formData.assets.join(", ")} onChange={e => updateField("assets", e.target.value.split(",").map(a => a.trim()).filter(Boolean))} />
        </div>
      </div>

      {/* Editor textareas */}
      <div className="space-y-4 pt-4 border-t border-border">
        <h3 className="font-serif font-bold text-lg">Analysis & Content</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Confirmed Facts</label>
            <Textarea className="min-h-[120px]" value={formData.confirmedFacts} onChange={e => updateField("confirmedFacts", e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Unverified Claims / Allegations</label>
            <Textarea className="min-h-[120px]" value={formData.unverifiedClaims} onChange={e => updateField("unverifiedClaims", e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Operational Implications</label>
            <Textarea className="min-h-[120px]" value={formData.operationalImplications} onChange={e => updateField("operationalImplications", e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Outlook</label>
            <Textarea className="min-h-[120px]" value={formData.outlook} onChange={e => updateField("outlook", e.target.value)} />
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Materiality Reason (Internal)</label>
            <Input value={formData.materialityReason} onChange={e => updateField("materialityReason", e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Missing Information</label>
            <Input value={formData.missingInfo} onChange={e => updateField("missingInfo", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Analyst Notes</label>
          <Textarea className="min-h-[80px]" value={formData.analystNotes} onChange={e => updateField("analystNotes", e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 block">Impact Areas</label>
          <div className="flex flex-wrap gap-4">
            {Object.values(DbPortsImpactArea).map(area => (
              <div key={area} className="flex items-center space-x-2">
                <Checkbox id={`impact-${area}`} checked={formData.impactAreas.includes(area)} onCheckedChange={() => toggleImpactArea(area)} />
                <label htmlFor={`impact-${area}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 capitalize">
                  {area.replace(/_/g, " ")}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Evidence */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <h3 className="font-serif font-bold text-lg">Evidence & Sources</h3>
          <Button size="sm" variant="outline" onClick={() => {
            const newEv: DbPortsEvidence = {
              id: Math.random().toString(36).substring(2, 9),
              sourceName: "",
              sourceUrl: "",
              sourceType: "discovery",
              publishedDate: null,
              sourceDate: null,
              retrievedAt: new Date().toISOString(),
              excerpt: "",
              originalTitle: "",
              sourceRecord: null,
              verified: false
            };
            updateField("evidence", [...formData.evidence, newEv]);
          }}>
            <Plus className="w-4 h-4 mr-2" /> Add Evidence
          </Button>
        </div>
        <div className="space-y-4">
          {formData.evidence.map((ev, i) => (
            <div key={ev.id} className="bg-muted/30 border border-border p-3 rounded-sm space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 grid grid-cols-12 gap-3">
                  <div className="col-span-12 sm:col-span-3">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Source Name</label>
                    <Input value={ev.sourceName} disabled={!!ev.sourceRecord} onChange={e => {
                      const evs = [...formData.evidence];
                      evs[i].sourceName = e.target.value;
                      updateField("evidence", evs);
                    }} />
                  </div>
                  <div className="col-span-12 sm:col-span-5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Source URL</label>
                    <Input value={ev.sourceUrl} disabled={!!ev.sourceRecord} onChange={e => {
                      const evs = [...formData.evidence];
                      evs[i].sourceUrl = e.target.value;
                      updateField("evidence", evs);
                    }} />
                  </div>
                  <div className="col-span-12 sm:col-span-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Type</label>
                    <Select value={ev.sourceType} onValueChange={(v: any) => {
                      const evs = [...formData.evidence];
                      evs[i].sourceType = v;
                      updateField("evidence", evs);
                    }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.values(DbPortsEvidenceSourceType).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-12 sm:col-span-2 flex items-end">
                    <div className="flex items-center space-x-2 mb-2">
                      <Checkbox id={`verified-${ev.id}`} checked={ev.verified} onCheckedChange={(c) => {
                        const evs = [...formData.evidence];
                        evs[i].verified = !!c;
                        updateField("evidence", evs);
                      }} />
                      <label htmlFor={`verified-${ev.id}`} className="text-xs font-bold text-emerald-600">VERIFIED</label>
                    </div>
                  </div>
                  <div className="col-span-12 sm:col-span-6">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Original Title</label>
                    <Input value={ev.originalTitle} disabled={!!ev.sourceRecord} onChange={e => {
                      const evs = [...formData.evidence];
                      evs[i].originalTitle = e.target.value;
                      updateField("evidence", evs);
                    }} />
                  </div>
                  <div className="col-span-12 sm:col-span-3">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Published Date</label>
                    <Input type="date" value={ev.publishedDate || ""} onChange={e => {
                      const evs = [...formData.evidence];
                      evs[i].publishedDate = e.target.value || null;
                      updateField("evidence", evs);
                    }} />
                  </div>
                  <div className="col-span-12 sm:col-span-3">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Source Date</label>
                    <Input type="date" value={ev.sourceDate || ""} onChange={e => {
                      const evs = [...formData.evidence];
                      evs[i].sourceDate = e.target.value || null;
                      updateField("evidence", evs);
                    }} />
                  </div>
                  <div className="col-span-12">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Excerpt</label>
                    <Textarea className="min-h-[60px]" value={ev.excerpt} onChange={e => {
                      const evs = [...formData.evidence];
                      evs[i].excerpt = e.target.value;
                      updateField("evidence", evs);
                    }} />
                  </div>
                </div>
                {!ev.sourceRecord && (
                  <Button variant="ghost" size="icon" className="text-destructive ml-2" onClick={() => {
                    if(confirm("Remove manual evidence?")) {
                      updateField("evidence", formData.evidence.filter((_, idx) => idx !== i));
                    }
                  }}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          {formData.evidence.length === 0 && <div className="text-sm text-muted-foreground">No evidence attached.</div>}
        </div>
      </div>

      {/* QA & Review */}
      <div className="space-y-4 pt-4 border-t border-border bg-muted/20 p-4 rounded-sm">
        <h3 className="font-serif font-bold text-lg">Quality Assurance</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <Checkbox id="reviewed" checked={formData.reviewed} onCheckedChange={(c) => updateField("reviewed", !!c)} />
              <label htmlFor="reviewed" className="text-sm font-medium">Ready for Review (First Pass)</label>
            </div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Primary Reviewer</label>
            <Input value={formData.reviewer} onChange={e => updateField("reviewer", e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block flex justify-between">
              <span>Secondary Reviewer</span>
              {formData.secondaryReviewRequired && <span className="text-amber-600">REQUIRED</span>}
            </label>
            <Input value={formData.secondReviewer} onChange={e => updateField("secondReviewer", e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Secondary Review Note</label>
            <Input value={formData.secondReviewNote} onChange={e => updateField("secondReviewNote", e.target.value)} />
          </div>
        </div>
      </div>
      
    </div>
  );
}
