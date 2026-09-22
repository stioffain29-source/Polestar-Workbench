import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Save, Plus, Trash2, ArrowLeft, Radio, Target } from "lucide-react";
import {
  useGetDbPortsSettings,
  useUpdateDbPortsSettings,
  getGetDbPortsSettingsQueryKey,
  DbPortsSource,
  DbPortsWatchTarget,
  DbPortsSourceSourceType,
  DbPortsSourceAccessMode,
  DbPortsSourceStatus,
  DbPortsSourceReliability,
  DbPortsWatchTargetKind,
  DbPortsTheme,
  DbPortsParameters,
} from "@workspace/api-client-react";
import { DB_PORTS_COUNTRIES, DEFAULT_DB_PORTS_PARAMETERS } from "@workspace/db-ports";
import DbPortsParameterPanel from "@/components/dbPorts/DbPortsParameterPanel";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export default function DbPortsSettings() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  
  const { data: settings, isLoading } = useGetDbPortsSettings();
  const updateMutation = useUpdateDbPortsSettings();

  const [sources, setSources] = useState<DbPortsSource[]>([]);
  const [watchlist, setWatchlist] = useState<DbPortsWatchTarget[]>([]);
  const [notes, setNotes] = useState("");
  const [defaults, setDefaults] = useState<DbPortsParameters | null>(null);
  const revisionRef = useRef<number>(0);
  const initialized = useRef(false);

  useEffect(() => {
    if (settings && !initialized.current) {
      setSources(settings.sources || []);
      setWatchlist(settings.watchlist || []);
      setNotes(settings.notes || "");
      setDefaults(settings.defaults);
      revisionRef.current = settings.revision;
      initialized.current = true;
    }
  }, [settings]);

  const handleSave = () => {
    updateMutation.mutate(
      {
        data: {
          revision: revisionRef.current,
          sources,
          watchlist,
          notes,
          defaults: defaults ?? settings?.defaults ?? DEFAULT_DB_PORTS_PARAMETERS,
        },
      },
      {
        onSuccess: (data) => {
          toast({ title: "Settings saved successfully" });
          revisionRef.current = data.revision;
          qc.setQueryData(getGetDbPortsSettingsQueryKey(), data);
        },
        onError: (err: any) => {
          if (err?.status === 409) {
            toast({
              variant: "destructive",
              title: "Conflict Detected",
              description: "Settings were updated elsewhere. Your local edits are preserved. Copy them and refresh.",
            });
          } else {
            toast({
              variant: "destructive",
              title: "Failed to save",
              description: err?.data?.error || "Unknown error",
            });
          }
        },
      }
    );
  };

  const addSource = () => {
    setSources([
      ...sources,
      {
        id: generateId(),
        name: "",
        country: "Regional",
        url: "",
        sourceType: "discovery",
        themes: ["port_terminal_operations"],
        language: "EN",
        accessMode: "manual",
        status: "pending",
        notes: "",
        expectedCadence: "",
        reliability: "unassessed",
        manualReviewRequired: true,
        lastSuccessfulCheckAt: null,
        lastRelevantItemDate: null,
        lastRelevantItemUrl: null,
      },
    ]);
  };

  const addWatchTarget = () => {
    setWatchlist([
      ...watchlist,
      {
        id: generateId(),
        name: "",
        country: "Regional",
        kind: "port",
        aliases: [],
        confirmedClientAsset: false,
        active: true,
      },
    ]);
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="max-w-[1200px] mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/db-ports")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-serif font-bold text-primary uppercase tracking-tight">
              Report Settings
            </h1>
            <div className="text-xs text-muted-foreground font-sans">
              Default configuration, source roster and watchlist
            </div>
          </div>
        </div>
        <Button onClick={handleSave} disabled={updateMutation.isPending} className="rounded-sm">
          <Save className="w-4 h-4 mr-2" />
          {updateMutation.isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      <section className="space-y-4 rounded-sm border border-border bg-card p-5">
        <div>
          <h2 className="font-serif text-lg font-bold text-primary">Default report configuration</h2>
          <p className="text-sm text-muted-foreground">
            New reports start from this preset. Each report can still be tuned on its own Configuration tab.
          </p>
        </div>
        {defaults && <DbPortsParameterPanel value={defaults} onChange={setDefaults} />}
      </section>

      <Accordion type="multiple" defaultValue={["sources", "watchlist", "notes"]}>
        <AccordionItem value="sources" className="border-border">
          <AccordionTrigger className="hover:no-underline font-serif font-bold text-lg">
            <div className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-accent" />
              Source Roster
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {sources.map((src, i) => (
                <div key={src.id} className="bg-muted/30 border border-border p-4 rounded-sm flex gap-4">
                  <div className="flex-1 grid grid-cols-12 gap-4">
                    <div className="col-span-12 sm:col-span-4">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Name</label>
                      <Input
                        value={src.name}
                        onChange={(e) => {
                          const s = [...sources];
                          s[i].name = e.target.value;
                          setSources(s);
                        }}
                        placeholder="Source name"
                      />
                    </div>
                    <div className="col-span-12 sm:col-span-4">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">URL</label>
                      <Input
                        value={src.url}
                        onChange={(e) => {
                          const s = [...sources];
                          s[i].url = e.target.value;
                          setSources(s);
                        }}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="col-span-12 sm:col-span-4">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Country</label>
                      <Select
                        value={src.country}
                        onValueChange={(v) => {
                          const s = [...sources];
                          s[i].country = v;
                          setSources(s);
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Regional">Regional</SelectItem>
                          {DB_PORTS_COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="col-span-12 sm:col-span-3">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Authority / Type</label>
                      <Select
                        value={src.sourceType}
                        onValueChange={(v: any) => {
                          const s = [...sources];
                          s[i].sourceType = v;
                          setSources(s);
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.values(DbPortsSourceSourceType).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Access Mode</label>
                      <Select
                        value={src.accessMode}
                        onValueChange={(v: any) => {
                          const s = [...sources];
                          s[i].accessMode = v;
                          setSources(s);
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.values(DbPortsSourceAccessMode).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Status</label>
                      <Select
                        value={src.status}
                        onValueChange={(v: any) => {
                          const s = [...sources];
                          s[i].status = v;
                          setSources(s);
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.values(DbPortsSourceStatus).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 sm:col-span-6">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Themes (comma-separated)</label>
                      <Input
                        value={src.themes.join(", ")}
                        onChange={(e) => {
                          const s = [...sources];
                          const validThemes = Object.values(DbPortsTheme);
                          s[i].themes = e.target.value.split(",").map(t => t.trim()).filter(t => validThemes.includes(t as any)) as any;
                          setSources(s);
                        }}
                        placeholder="e.g. operations, security"
                      />
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Language</label>
                      <Input
                        value={src.language}
                        onChange={(e) => {
                          const s = [...sources];
                          s[i].language = e.target.value;
                          setSources(s);
                        }}
                      />
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Expected Cadence</label>
                      <Input
                        value={src.expectedCadence || ""}
                        onChange={(e) => {
                          const s = [...sources];
                          s[i].expectedCadence = e.target.value;
                          setSources(s);
                        }}
                        placeholder="e.g. Daily, Weekly"
                      />
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Reliability</label>
                      <Select
                        value={src.reliability || "unassessed"}
                        onValueChange={(v: any) => {
                          const s = [...sources];
                          s[i].reliability = v;
                          setSources(s);
                        }}
                      >
                        <SelectTrigger className={src.reliability === "unassessed" ? "border-amber-500/50 text-amber-600" : ""}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.values(DbPortsSourceReliability).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 sm:col-span-6 flex items-center pt-5">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`review-${src.id}`}
                          checked={src.manualReviewRequired !== false}
                          onCheckedChange={(c) => {
                            const s = [...sources];
                            s[i].manualReviewRequired = !!c;
                            setSources(s);
                          }}
                        />
                        <label htmlFor={`review-${src.id}`} className="text-sm font-medium leading-none">Manual Review Required</label>
                      </div>
                    </div>

                    <div className="col-span-12 sm:col-span-4">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Last Successful Check</label>
                      <Input
                        type="datetime-local"
                        value={src.lastSuccessfulCheckAt ? new Date(src.lastSuccessfulCheckAt).toISOString().slice(0, 16) : ""}
                        onChange={(e) => {
                          const s = [...sources];
                          s[i].lastSuccessfulCheckAt = e.target.value ? new Date(e.target.value).toISOString() : null;
                          setSources(s);
                        }}
                      />
                    </div>
                    <div className="col-span-12 sm:col-span-4">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Last Relevant Item Date</label>
                      <Input
                        type="date"
                        value={src.lastRelevantItemDate || ""}
                        onChange={(e) => {
                          const s = [...sources];
                          s[i].lastRelevantItemDate = e.target.value || null;
                          setSources(s);
                        }}
                      />
                    </div>
                    <div className="col-span-12 sm:col-span-4">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Last Relevant Item URL</label>
                      <Input
                        value={src.lastRelevantItemUrl || ""}
                        onChange={(e) => {
                          const s = [...sources];
                          s[i].lastRelevantItemUrl = e.target.value || null;
                          setSources(s);
                        }}
                        placeholder="https://..."
                      />
                    </div>

                    <div className="col-span-12">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Notes</label>
                      <Input
                        value={src.notes}
                        onChange={(e) => {
                          const s = [...sources];
                          s[i].notes = e.target.value;
                          setSources(s);
                        }}
                        placeholder="Login details, frequency, etc."
                      />
                    </div>
                  </div>
                  <div>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => {
                      if (confirm("Remove source?")) {
                        setSources(sources.filter((_, idx) => idx !== i));
                      }
                    }}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" className="w-full border-dashed" onClick={addSource}>
                <Plus className="w-4 h-4 mr-2" /> Add Source
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="watchlist" className="border-border">
          <AccordionTrigger className="hover:no-underline font-serif font-bold text-lg">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-accent" />
              Watchlist
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              {watchlist.map((wt, i) => (
                <div key={wt.id} className="bg-muted/30 border border-border p-4 rounded-sm flex gap-4">
                  <div className="flex-1 grid grid-cols-12 gap-4">
                    <div className="col-span-12 sm:col-span-4">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Target Name</label>
                      <Input
                        value={wt.name}
                        onChange={(e) => {
                          const w = [...watchlist];
                          w[i].name = e.target.value;
                          setWatchlist(w);
                        }}
                      />
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Country</label>
                      <Select
                        value={wt.country}
                        onValueChange={(v) => {
                          const w = [...watchlist];
                          w[i].country = v;
                          setWatchlist(w);
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Regional">Regional</SelectItem>
                          {DB_PORTS_COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 sm:col-span-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Kind</label>
                      <Select
                        value={wt.kind}
                        onValueChange={(v: any) => {
                          const w = [...watchlist];
                          w[i].kind = v;
                          setWatchlist(w);
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.values(DbPortsWatchTargetKind).map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Aliases (comma-separated)</label>
                      <Input
                        value={wt.aliases.join(", ")}
                        onChange={(e) => {
                          const w = [...watchlist];
                          w[i].aliases = e.target.value.split(",").map(a => a.trim()).filter(Boolean);
                          setWatchlist(w);
                        }}
                      />
                    </div>
                    <div className="col-span-12 flex items-center gap-6 mt-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`active-${wt.id}`}
                          checked={wt.active}
                          onCheckedChange={(c) => {
                            const w = [...watchlist];
                            w[i].active = !!c;
                            setWatchlist(w);
                          }}
                        />
                        <label htmlFor={`active-${wt.id}`} className="text-sm">Active</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`client-${wt.id}`}
                          checked={wt.confirmedClientAsset}
                          onCheckedChange={(c) => {
                            const w = [...watchlist];
                            w[i].confirmedClientAsset = !!c;
                            setWatchlist(w);
                          }}
                        />
                        <label htmlFor={`client-${wt.id}`} className="text-sm">Confirmed Client Asset</label>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => {
                      if (confirm("Remove target?")) {
                        setWatchlist(watchlist.filter((_, idx) => idx !== i));
                      }
                    }}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" className="w-full border-dashed" onClick={addWatchTarget}>
                <Plus className="w-4 h-4 mr-2" /> Add Target
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="notes" className="border-border">
          <AccordionTrigger className="hover:no-underline font-serif font-bold text-lg">
            Notes
          </AccordionTrigger>
          <AccordionContent>
            <Textarea
              className="min-h-[150px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal guidance, methodologies, reminders..."
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
