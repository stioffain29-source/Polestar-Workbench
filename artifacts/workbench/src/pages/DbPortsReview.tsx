import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { format } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Download,
  Edit2,
  FileText,
  History,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  DbPortsItem,
  DbPortsItemContentDisposition,
  DbPortsParameters,
  getGetDbPortsEditionQueryKey,
  getGetDbPortsSettingsQueryKey,
  useAddDbPortsItem,
  useDeleteDbPortsEdition,
  useGenerateDbPortsDraft,
  useGetDbPortsEdition,
  useGetDbPortsSettings,
  usePrepareDbPortsExport,
  useRegenerateDbPortsOverview,
  useReorderDbPortsItems,
  useUpdateDbPortsEdition,
  useUpdateDbPortsItem,
  useUpdateDbPortsSettings,
} from "@workspace/api-client-react";
import { emptyDbPortsItem, wordCount } from "@workspace/db-ports";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { downloadDbPortsDocx, downloadDbPortsPdf } from "@/lib/dbPortsExport";
import DbPortsBulletin from "@/components/dbPorts/DbPortsBulletin";
import DbPortsItemList from "@/components/dbPorts/DbPortsItemList";
import DbPortsItemEditor from "@/components/dbPorts/DbPortsItemEditor";
import DbPortsCoverage from "@/components/dbPorts/DbPortsCoverage";
import DbPortsParameterPanel from "@/components/dbPorts/DbPortsParameterPanel";

export default function DbPortsReview() {
  const { id } = useParams<{ id: string }>();
  const editionId = Number(id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: edition, isLoading, error } = useGetDbPortsEdition(editionId, {
    query: { enabled: !!editionId, queryKey: getGetDbPortsEditionQueryKey(editionId) },
  });
  const { data: settings } = useGetDbPortsSettings();

  const updateMutation = useUpdateDbPortsEdition();
  const deleteMutation = useDeleteDbPortsEdition();
  const generateMutation = useGenerateDbPortsDraft();
  const overviewMutation = useRegenerateDbPortsOverview();
  const reorderMutation = useReorderDbPortsItems();
  const itemMutation = useUpdateDbPortsItem();
  const addMutation = useAddDbPortsItem();
  const exportMutation = usePrepareDbPortsExport();
  const settingsMutation = useUpdateDbPortsSettings();

  const [activeTab, setActiveTab] = useState("items");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [overview, setOverview] = useState("");
  const [overviewDirty, setOverviewDirty] = useState(false);
  const [itemDirty, setItemDirty] = useState(false);
  const [parameters, setParameters] = useState<DbPortsParameters | null>(null);
  const [endDate, setEndDate] = useState("");
  const [parametersDirty, setParametersDirty] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const overviewBaseline = useRef("");
  const loadedRevision = useRef<string>("");
  const openedTab = useRef(false);

  useEffect(() => {
    if (!edition) return;
    const signature = `${edition.id}:${edition.revision}`;
    if (!openedTab.current) {
      // A report with nothing drafted yet opens where the work starts.
      openedTab.current = true;
      setActiveTab(
        edition.items.some((item) => item.disposition === "selected" && !item.mergedInto)
          ? "items"
          : "configuration",
      );
    }
    if (loadedRevision.current === signature) return;
    if (!overviewDirty) {
      setOverview(edition.overview || "");
      overviewBaseline.current = edition.overview || "";
    }
    if (!parametersDirty) {
      setParameters(edition.parameters);
      setEndDate(edition.endDate);
    }
    loadedRevision.current = signature;
  }, [edition, overviewDirty, parametersDirty]);

  if (isLoading) return <div className="p-6">Loading report…</div>;
  if (!edition || error) return <div className="p-6">This report could not be loaded.</div>;

  const isDirty = overviewDirty || itemDirty || parametersDirty;
  const busy =
    updateMutation.isPending ||
    generateMutation.isPending ||
    overviewMutation.isPending ||
    reorderMutation.isPending ||
    itemMutation.isPending ||
    addMutation.isPending;

  const apply = (updated: typeof edition) => qc.setQueryData(getGetDbPortsEditionQueryKey(editionId), updated);
  const failed = (title: string) => (err: any) =>
    toast({
      variant: "destructive",
      title,
      description:
        err?.status === 409
          ? "This report changed elsewhere. Your text is still on screen — copy it, then reload."
          : err?.data?.error || "Unknown error",
    });

  const guard = (message: string) => !isDirty || confirm(message);

  const handleUpdateTitle = () => {
    updateMutation.mutate(
      { id: editionId, data: { revision: edition.revision, title: newTitle.trim() } },
      {
        onSuccess: (updated) => {
          apply(updated);
          setIsEditingTitle(false);
        },
        onError: failed("Could not rename the report"),
      },
    );
  };

  const handleGenerate = () => {
    if (!guard("Generating replaces the drafted items and overview. Discard your unsaved edits?")) return;
    generateMutation.mutate(
      { id: editionId, data: { revision: edition.revision } },
      {
        onSuccess: (updated) => {
          apply(updated);
          setOverviewDirty(false);
          setItemDirty(false);
          setOverview(updated.overview);
          overviewBaseline.current = updated.overview;
          loadedRevision.current = "";
          const drafted = updated.items.filter((item) => item.disposition === "selected").length;
          const watch = updated.items.filter((item) => item.disposition === "watch").length;
          toast({ title: "Draft generated", description: `${drafted} items and ${watch} watchlist entries from collected material.` });
        },
        onError: failed("Draft generation failed"),
      },
    );
  };

  const handleRegenerateOverview = () => {
    if (!guard("Redrafting the overview discards your unsaved edits to it. Continue?")) return;
    overviewMutation.mutate(
      { id: editionId, data: { revision: edition.revision } },
      {
        onSuccess: (updated) => {
          apply(updated);
          setOverview(updated.overview);
          overviewBaseline.current = updated.overview;
          setOverviewDirty(false);
          loadedRevision.current = "";
          toast({ title: "Regional Overview redrafted" });
        },
        onError: failed("Overview redraft failed"),
      },
    );
  };

  const handleSaveOverview = () => {
    const captured = overview;
    updateMutation.mutate(
      { id: editionId, data: { revision: edition.revision, overview: captured } },
      {
        onSuccess: (updated) => {
          apply(updated);
          overviewBaseline.current = captured;
          setOverviewDirty(overview !== captured);
          loadedRevision.current = "";
          toast({ title: "Overview saved" });
        },
        onError: failed("Could not save the overview"),
      },
    );
  };

  const handleSaveParameters = () => {
    if (!parameters) return;
    updateMutation.mutate(
      { id: editionId, data: { revision: edition.revision, parameters, endDate } },
      {
        onSuccess: (updated) => {
          apply(updated);
          setParameters(updated.parameters);
          setEndDate(updated.endDate);
          setParametersDirty(false);
          loadedRevision.current = "";
          toast({ title: "Configuration saved" });
        },
        onError: failed("Could not save the configuration"),
      },
    );
  };

  const handleSavePreset = () => {
    if (!parameters || !settings) return;
    settingsMutation.mutate(
      {
        data: {
          revision: settings.revision,
          sources: settings.sources,
          watchlist: settings.watchlist,
          notes: settings.notes,
          defaults: parameters,
        },
      },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsSettingsQueryKey(), updated);
          toast({ title: "Saved as the default preset", description: "New reports start from this configuration." });
        },
        onError: failed("Could not save the preset"),
      },
    );
  };

  const handleAddManual = () => {
    if (!guard("You have unsaved edits. Discard them?")) return;
    addMutation.mutate(
      { id: editionId, data: { revision: edition.revision, item: emptyDbPortsItem() } },
      {
        onSuccess: (updated) => {
          apply(updated);
          loadedRevision.current = "";
          const added = updated.items[updated.items.length - 1];
          if (added) setSelectedItemId(added.id);
          setItemDirty(false);
          toast({ title: "Blank item added", description: "Fill it from collected material and attach its source." });
        },
        onError: failed("Could not add an item"),
      },
    );
  };

  const handleMove = (item: DbPortsItem, disposition: DbPortsItemContentDisposition) => {
    const { id: _id, mergedInto: _m, updatedAt: _u, warnings: _w, drafted: _d, ...content } = item;
    itemMutation.mutate(
      { id: editionId, itemId: item.id, data: { revision: edition.revision, item: { ...content, disposition } } },
      {
        onSuccess: (updated) => {
          apply(updated);
          loadedRevision.current = "";
        },
        onError: failed("Could not move the item"),
      },
    );
  };

  const handleReorder = (item: DbPortsItem, direction: -1 | 1) => {
    const order = edition.items.map((entry) => entry.id);
    const peers = edition.items.filter((entry) => entry.disposition === item.disposition);
    const position = peers.findIndex((entry) => entry.id === item.id);
    const target = peers[position + direction];
    if (!target) return;
    const from = order.indexOf(item.id);
    const to = order.indexOf(target.id);
    order.splice(from, 1);
    order.splice(to, 0, item.id);
    reorderMutation.mutate(
      { id: editionId, data: { revision: edition.revision, itemIds: order } },
      {
        onSuccess: (updated) => {
          apply(updated);
          loadedRevision.current = "";
        },
        onError: failed("Could not reorder"),
      },
    );
  };

  const handleDelete = () => {
    if (!confirm("Permanently delete this report?")) return;
    deleteMutation.mutate(
      { id: editionId, data: { revision: edition.revision } },
      { onSuccess: () => setLocation("/db-ports"), onError: failed("Could not delete the report") },
    );
  };

  const handleExport = (kind: "docx" | "pdf") => {
    exportMutation.mutate(
      { id: editionId, data: { revision: edition.revision } },
      {
        onSuccess: async (payload) => {
          try {
            if (kind === "pdf") await downloadDbPortsPdf(payload);
            else await downloadDbPortsDocx(payload);
            toast({ title: `${kind.toUpperCase()} downloaded` });
          } catch (err: any) {
            toast({ variant: "destructive", title: "Export failed", description: err?.message || "Unknown error" });
          }
        },
        onError: failed("Export failed"),
      },
    );
  };

  const overviewWords = wordCount(overview);
  const overviewTarget = edition.parameters.overviewWordTarget;

  return (
    <div className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-border py-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => guard("You have unsaved edits. Leave anyway?") && setLocation("/db-ports")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  className="h-7 w-[340px] border-b border-accent bg-transparent font-serif text-lg font-bold focus:outline-none"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  autoFocus
                />
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleUpdateTitle} disabled={updateMutation.isPending || !newTitle.trim()}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setIsEditingTitle(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <h1
                className="group flex cursor-pointer items-center gap-2 font-serif text-2xl font-bold tracking-tight text-primary"
                onClick={() => {
                  setNewTitle(edition.title || "");
                  setIsEditingTitle(true);
                }}
                data-testid="text-report-title"
              >
                {edition.title || "Untitled report"}
                <Edit2 className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </h1>
            )}
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              {edition.startDate} to {edition.endDate} · {edition.parameters.customerName || "no customer set"} · rev {edition.revision}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="mr-2 flex items-center gap-1 rounded-sm bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" /> Unsaved edits
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => handleExport("docx")} disabled={isDirty || exportMutation.isPending} data-testid="button-export-docx">
            <Download className="mr-1 h-4 w-4" /> Word
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("pdf")} disabled={isDirty || exportMutation.isPending} data-testid="button-export-pdf">
            <Download className="mr-1 h-4 w-4" /> PDF
          </Button>
          <Button variant="ghost" size="icon" className="text-destructive" onClick={handleDelete} disabled={isDirty}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {edition.quality.warnings.length > 0 && (
        <div className="mt-3 rounded-sm border border-amber-500/60 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300" data-testid="panel-warnings">
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" /> Editor checks — these never appear in the Word or PDF export
          </div>
          <ul className="mt-1 list-disc pl-5">
            {edition.quality.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4 flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="configuration" className="flex items-center gap-2"><Settings2 className="h-4 w-4" /> Configuration</TabsTrigger>
          <TabsTrigger value="items" className="flex items-center gap-2"><FileText className="h-4 w-4" /> Items</TabsTrigger>
          <TabsTrigger value="overview" className="flex items-center gap-2"><Activity className="h-4 w-4" /> Regional Overview</TabsTrigger>
          <TabsTrigger value="coverage" className="flex items-center gap-2"><CheckCircle className="h-4 w-4" /> Coverage</TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2"><History className="h-4 w-4" /> History</TabsTrigger>
          <TabsTrigger value="preview" className="flex items-center gap-2"><FileText className="h-4 w-4" /> Preview</TabsTrigger>
        </TabsList>

        <div className="mt-4 flex-1 overflow-hidden rounded-sm border border-border bg-card">
          <TabsContent value="configuration" className="m-0 h-full overflow-y-auto p-6">
            {parameters && (
              <div className="max-w-5xl space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif text-lg font-bold text-primary">Report configuration</h2>
                    <p className="text-sm text-muted-foreground">
                      These settings drive what the generator screens in, how much it writes, and what the export shows.
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" onClick={handleSavePreset} disabled={!settings || settingsMutation.isPending} data-testid="button-save-preset">
                      Save as default preset
                    </Button>
                    <Button onClick={handleSaveParameters} disabled={!parametersDirty || updateMutation.isPending} data-testid="button-save-parameters">
                      <Save className="mr-2 h-4 w-4" /> Save configuration
                    </Button>
                  </div>
                </div>
                <DbPortsParameterPanel
                  value={parameters}
                  onChange={(next) => {
                    setParameters(next);
                    setParametersDirty(true);
                  }}
                  period={{
                    startDate: edition.startDate,
                    endDate,
                    onEndDateChange: (next) => {
                      setEndDate(next);
                      setParametersDirty(true);
                    },
                  }}
                />
                <div className="border-t border-border pt-4">
                  <Button onClick={handleGenerate} disabled={generateMutation.isPending || isDirty} data-testid="button-generate-from-config">
                    <Sparkles className="mr-2 h-4 w-4" />
                    {generateMutation.isPending ? "Drafting…" : "Generate Draft"}
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Drafting uses only material the Workbench already collected for this period. Items you wrote yourself are kept.
                  </p>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="items" forceMount className="m-0 flex h-full data-[state=inactive]:hidden">
            <div className="w-[350px] flex-shrink-0 overflow-y-auto border-r border-border bg-muted/10">
              <DbPortsItemList
                edition={edition}
                selectedId={selectedItemId}
                onSelect={(nextId) => {
                  if (itemDirty && !confirm("Discard unsaved edits to this item?")) return;
                  setItemDirty(false);
                  setSelectedItemId(nextId);
                }}
                onGenerate={handleGenerate}
                onAddManual={handleAddManual}
                onMove={handleMove}
                onReorder={handleReorder}
                generating={generateMutation.isPending}
                busy={busy}
                actionsDisabled={isDirty}
              />
            </div>
            <div className="custom-scrollbar flex-1 overflow-y-auto bg-background p-4">
              {selectedItemId ? (
                <DbPortsItemEditor
                  edition={edition}
                  itemId={selectedItemId}
                  onDirtyChange={setItemDirty}
                  onDeleted={() => setSelectedItemId(null)}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select an item to edit it.
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="overview" className="m-0 h-full overflow-y-auto p-6">
            <div className="max-w-3xl space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-serif text-lg font-bold text-primary">Regional Overview</h2>
                  <p className="text-sm text-muted-foreground">
                    Analytical opening covering the fortnight's pattern, not a list of the items below.
                  </p>
                </div>
                <Button variant="outline" onClick={handleRegenerateOverview} disabled={overviewMutation.isPending} data-testid="button-regenerate-overview">
                  <RefreshCw className="mr-2 h-4 w-4" /> Regenerate overview
                </Button>
              </div>
              <Textarea
                value={overview}
                onChange={(event) => {
                  setOverview(event.target.value);
                  setOverviewDirty(event.target.value !== overviewBaseline.current);
                }}
                className="min-h-[320px] font-serif text-base"
                data-testid="input-overview"
              />
              <div className="flex items-center justify-between">
                <div className={`font-mono text-xs ${overviewWords && (overviewWords < 150 || overviewWords > overviewTarget) ? "text-amber-600" : "text-muted-foreground"}`}>
                  {overviewWords} words · target 150–{overviewTarget}
                </div>
                <Button onClick={handleSaveOverview} disabled={!overviewDirty || updateMutation.isPending} data-testid="button-save-overview">
                  <Save className="mr-2 h-4 w-4" /> Save draft
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="coverage" className="m-0 h-full overflow-y-auto p-6">
            <DbPortsCoverage edition={edition} />
          </TabsContent>

          <TabsContent value="history" className="m-0 h-full overflow-y-auto p-6">
            <div className="max-w-4xl space-y-6">
              <h2 className="font-serif text-lg font-bold text-primary">Change history</h2>
              <div className="space-y-3">
                {edition.history.map((entry, index) => (
                  <div key={index} className="flex gap-4 rounded-sm border border-border bg-muted/30 p-3 text-sm">
                    <div className="w-[140px] shrink-0 font-mono text-xs text-muted-foreground">
                      {format(new Date(entry.at), "dd MMM HH:mm:ss")}
                    </div>
                    <div className="w-[160px] font-medium capitalize">{entry.action.replaceAll("_", " ")}</div>
                    <div className="flex-1 text-muted-foreground">{entry.detail}</div>
                  </div>
                ))}
                {edition.history.length === 0 && <div className="text-muted-foreground">No changes recorded yet.</div>}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="m-0 flex h-full justify-center overflow-y-auto bg-muted/10 p-6">
            <div className="min-h-[1000px] w-[800px] bg-white text-black shadow-xl">
              <DbPortsBulletin payload={{ edition, generatedAt: new Date().toISOString() }} />
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
