import { useState, useRef, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { format } from "date-fns";
import { 
  ArrowLeft, Download, Trash2, CheckCircle, Clock, AlertTriangle, FileText, Activity, Save, History, Edit2
} from "lucide-react";
import {
  useGetDbPortsEdition,
  getGetDbPortsEditionQueryKey,
  useUpdateDbPortsEdition,
  useDeleteDbPortsEdition,
  useImportDbPortsCandidates,
  useAddDbPortsItem,
  useUpdateDbPortsItem,
  useMergeDbPortsItems,
  usePrepareDbPortsExport,
  DbPortsEdition,
} from "@workspace/api-client-react";
import { emptyDbPortsItem } from "@workspace/db-ports";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

// @ts-ignore - Created by another helper
import { downloadDbPortsDocx, downloadDbPortsPdf } from "@/lib/dbPortsExport";
// @ts-ignore - Created by another helper
import DbPortsBulletin from "@/components/dbPorts/DbPortsBulletin";

// Sub-components to be imported later
import DbPortsItemList from "@/components/dbPorts/DbPortsItemList";
import DbPortsItemEditor from "@/components/dbPorts/DbPortsItemEditor";
import DbPortsWorklog from "@/components/dbPorts/DbPortsWorklog";
import DbPortsCoverage from "@/components/dbPorts/DbPortsCoverage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function DbPortsReview() {
  const { id } = useParams<{ id: string }>();
  const editionId = Number(id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: edition, isLoading, error } = useGetDbPortsEdition(editionId, {
    query: {
      enabled: !!editionId,
      queryKey: getGetDbPortsEditionQueryKey(editionId),
    },
  });

  const updateMutation = useUpdateDbPortsEdition();
  const deleteMutation = useDeleteDbPortsEdition();
  const importMutation = useImportDbPortsCandidates();
  const exportMutation = usePrepareDbPortsExport();
  const addMutation = useAddDbPortsItem();

  const [activeTab, setActiveTab] = useState("items");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  
  const [overview, setOverview] = useState("");
  const [overviewDirty, setOverviewDirty] = useState(false);
  const baselineOverview = useRef("");
  const currentEditionId = useRef<number | null>(null);
  
  const [itemDirty, setItemDirty] = useState(false);
  
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const isDirty = overviewDirty || itemDirty;

  useEffect(() => {
    if (edition && currentEditionId.current !== edition.id) {
      setOverview(edition.overview || "");
      baselineOverview.current = edition.overview || "";
      setOverviewDirty(false);
      currentEditionId.current = edition.id;
    }
  }, [edition]);

  if (isLoading) return <div className="p-6">Loading edition...</div>;
  if (!edition || error) return <div className="p-6">Error loading edition.</div>;

  const handleUpdateTitle = () => {
    updateMutation.mutate(
      {
        id: editionId,
        data: {
          revision: edition.revision,
          title: newTitle.trim(),
        },
      },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsEditionQueryKey(editionId), updated);
          setIsEditingTitle(false);
          toast({ title: "Title updated" });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Error", description: err?.data?.error || "Failed to update title." });
        },
      }
    );
  };

  const handleSelectItem = (id: string) => {
    if (itemDirty) {
      if (!confirm("You have unsaved changes on this item. Discard them?")) {
        return;
      }
      setItemDirty(false); // Discarding edits
    }
    setSelectedItemId(id);
  };

  const handleUpdateOverview = () => {
    const capturedOverview = overview;
    updateMutation.mutate(
      {
        id: editionId,
        data: {
          revision: edition.revision,
          overview: capturedOverview,
        },
      },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsEditionQueryKey(editionId), updated);
          baselineOverview.current = capturedOverview;
          setOverviewDirty(overview !== capturedOverview);
          toast({ title: "Overview saved" });
        },
        onError: (err: any) => {
          if (err?.status === 409) {
            toast({ variant: "destructive", title: "Conflict Detected", description: "Overview was modified elsewhere. Your changes are preserved. Copy and refresh." });
          } else {
            toast({ variant: "destructive", title: "Error", description: err?.data?.error || "Failed to save overview." });
          }
        },
      }
    );
  };

  const handleStatusChange = (status: "draft" | "in_review" | "approved") => {
    if (status === "approved" && !edition.quality.readyForReview) {
      toast({ variant: "destructive", title: "Cannot approve", description: "Fix blockers first." });
      return;
    }
    updateMutation.mutate(
      { id: editionId, data: { revision: edition.revision, status } },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsEditionQueryKey(editionId), updated);
          toast({ title: `Status changed to ${status.replace("_", " ")}` });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Error", description: err?.data?.error });
        }
      }
    );
  };

  const handleDelete = () => {
    if (confirm("Permanently delete this edition?")) {
      deleteMutation.mutate(
        { id: editionId, data: { revision: edition.revision } },
        {
          onSuccess: () => {
            setLocation("/db-ports");
          },
          onError: (err: any) => {
            toast({ variant: "destructive", title: "Error", description: err?.data?.error });
          }
        }
      );
    }
  };

  const handleImport = () => {
    importMutation.mutate(
      { id: editionId, data: { revision: edition.revision } },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsEditionQueryKey(editionId), updated);
          toast({ title: "Imported candidates successfully" });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Import failed", description: err?.data?.error });
        }
      }
    );
  };

  const handleAddManual = () => {
    if (isDirty) {
      if (!confirm("You have unsaved changes. Discard them?")) return;
      setItemDirty(false);
      setOverviewDirty(false);
    }
    
    // Create an empty valid payload based on the schemas
    const emptyContent = emptyDbPortsItem();
    
    addMutation.mutate(
      {
        id: editionId,
        data: {
          revision: edition.revision,
          item: emptyContent
        }
      },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsEditionQueryKey(editionId), updated);
          toast({ title: "Added manual candidate" });
          
          // Optionally, find the new item which would be the one not present in the old edition
          // But simplest is we just assume it's created and they can select it from Inbox.
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Error", description: err?.data?.error });
        }
      }
    );
  };

  const handleExport = (mode: "working" | "reviewed", format: "docx" | "pdf") => {
    exportMutation.mutate(
      { id: editionId, data: { revision: edition.revision, mode } },
      {
        onSuccess: async (payload) => {
          try {
            if (format === "pdf") {
              await downloadDbPortsPdf(payload);
            } else {
              await downloadDbPortsDocx(payload);
            }
            toast({ title: `Export downloaded (${mode} ${format.toUpperCase()})` });
          } catch (e: any) {
            toast({ variant: "destructive", title: "Export generation failed", description: e.message || "Unknown error" });
          }
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Export failed", description: err?.data?.error });
        }
      }
    );
  };

  const handleBack = () => {
    if (isDirty) {
      if (!confirm("You have unsaved changes. Leave anyway?")) return;
    }
    setLocation("/db-ports");
  };

  return (
    <div className="h-full flex flex-col max-w-[1600px] mx-auto overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center justify-between py-4 border-b border-border">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm ${
                edition.status === 'approved' ? 'bg-emerald-500/20 text-emerald-700' :
                edition.status === 'in_review' ? 'bg-amber-500/20 text-amber-700' :
                'bg-secondary text-secondary-foreground'
              }`}>
                {edition.status.replace("_", " ")}
              </span>
              {isEditingTitle ? (
                <div className="flex items-center gap-2 ml-2">
                  <input
                    className="h-7 text-lg font-serif font-bold bg-transparent border-b border-accent focus:outline-none focus:border-accent w-[300px]"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    autoFocus
                  />
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleUpdateTitle} disabled={updateMutation.isPending || !newTitle.trim()}>Save</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setIsEditingTitle(false)}>Cancel</Button>
                </div>
              ) : (
                <h1 
                  className="text-2xl font-serif font-bold text-primary tracking-tight ml-2 flex items-center gap-2 group cursor-pointer"
                  onClick={() => { setNewTitle(edition.title || ""); setIsEditingTitle(true); }}
                >
                  {edition.title || "Untitled Edition"}
                  <Edit2 className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </h1>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1 font-mono ml-10">
              {edition.startDate} to {edition.endDate} | Rev: {edition.revision}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-xs font-bold text-amber-500 flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded-sm mr-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              Unsaved edits
            </span>
          )}
          
          {edition.quality.blockers.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-destructive mr-2">
              <AlertTriangle className="w-4 h-4" /> {edition.quality.blockers.length} blockers
            </div>
          )}
          
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => handleExport("working", "docx")} disabled={isDirty || exportMutation.isPending}>
              <Download className="w-4 h-4 mr-1" /> DOCX (Working)
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("working", "pdf")} disabled={isDirty || exportMutation.isPending}>
              <Download className="w-4 h-4 mr-1" /> PDF
            </Button>
          </div>
          
          {edition.status === "approved" && edition.quality.readyForReview && (
            <div className="flex gap-1 ml-2 border-l border-border pl-2">
              <Button variant="outline" size="sm" className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20" onClick={() => handleExport("reviewed", "docx")} disabled={isDirty || exportMutation.isPending}>
                <Download className="w-4 h-4 mr-1" /> DOCX (Reviewed)
              </Button>
              <Button variant="outline" size="sm" className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20" onClick={() => handleExport("reviewed", "pdf")} disabled={isDirty || exportMutation.isPending}>
                <Download className="w-4 h-4 mr-1" /> PDF
              </Button>
            </div>
          )}
          
          {edition.status === "draft" && (
            <Button size="sm" onClick={() => handleStatusChange("in_review")} className="bg-amber-600 hover:bg-amber-700 text-white ml-2" disabled={isDirty}>
              Request Review
            </Button>
          )}
          {edition.status === "in_review" && (
            <Button size="sm" onClick={() => handleStatusChange("approved")} className="bg-emerald-600 hover:bg-emerald-700 text-white ml-2" disabled={isDirty || !edition.quality.readyForReview}>
              <CheckCircle className="w-4 h-4 mr-2" /> Approve Edition
            </Button>
          )}
          
          <Button variant="ghost" size="icon" className="text-destructive ml-2" onClick={handleDelete} disabled={isDirty}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Main Content Workspace */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col mt-4 min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="items" className="flex items-center gap-2"><FileText className="w-4 h-4" /> Items</TabsTrigger>
          <TabsTrigger value="overview" className="flex items-center gap-2"><Activity className="w-4 h-4" /> Overview</TabsTrigger>
          <TabsTrigger value="coverage" className="flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Coverage</TabsTrigger>
          <TabsTrigger value="worklog" className="flex items-center gap-2"><Clock className="w-4 h-4" /> Worklog</TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2"><History className="w-4 h-4" /> History</TabsTrigger>
          <TabsTrigger value="preview" className="flex items-center gap-2"><FileText className="w-4 h-4" /> Preview</TabsTrigger>
        </TabsList>
        
        <div className="flex-1 overflow-hidden mt-4 bg-card border border-border rounded-sm">
          <TabsContent value="items" forceMount className="m-0 h-full flex data-[state=inactive]:hidden">
            {/* Sidebar List */}
            <div className="w-[350px] flex-shrink-0 border-r border-border bg-muted/10 overflow-y-auto">
              <DbPortsItemList 
                edition={edition} 
                selectedId={selectedItemId} 
                onSelect={handleSelectItem} 
                onImport={handleImport}
                onAddManual={handleAddManual}
                importing={importMutation.isPending}
                importDisabled={isDirty}
              />
            </div>
            {/* Editor Pane */}
            <div className="flex-1 overflow-y-auto bg-background p-4 custom-scrollbar">
              {selectedItemId ? (
                <DbPortsItemEditor edition={edition} itemId={selectedItemId} onDirtyChange={setItemDirty} />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Select an item to edit
                </div>
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="overview" forceMount className="m-0 h-full p-6 overflow-y-auto data-[state=inactive]:hidden">
            <div className="max-w-3xl space-y-4">
              <h2 className="text-lg font-serif font-bold text-primary">Edition Overview</h2>
              <p className="text-sm text-muted-foreground">150–250 word executive summary covering the main themes of this edition.</p>
              <Textarea 
                value={overview} 
                onChange={(e) => {
                  setOverview(e.target.value);
                  setOverviewDirty(e.target.value !== baselineOverview.current);
                }}
                className="min-h-[300px] font-serif text-base"
              />
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground font-mono">
                  {overview.split(/\s+/).filter(Boolean).length} words
                </div>
                <Button onClick={handleUpdateOverview} disabled={!overviewDirty || updateMutation.isPending}>
                  <Save className="w-4 h-4 mr-2" /> Save Overview
                </Button>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="coverage" forceMount className="m-0 h-full overflow-y-auto p-6 data-[state=inactive]:hidden">
            <DbPortsCoverage edition={edition} />
          </TabsContent>
          
          <TabsContent value="worklog" forceMount className="m-0 h-full overflow-y-auto p-6 data-[state=inactive]:hidden">
            <DbPortsWorklog edition={edition} />
          </TabsContent>

          <TabsContent value="history" forceMount className="m-0 h-full overflow-y-auto p-6 data-[state=inactive]:hidden">
            <div className="max-w-4xl space-y-6">
              <h2 className="text-lg font-serif font-bold text-primary">Audit History</h2>
              <div className="space-y-4">
                {edition.history.map((h, i) => (
                  <div key={i} className="flex gap-4 p-3 bg-muted/30 border border-border rounded-sm text-sm">
                    <div className="w-[140px] text-xs font-mono text-muted-foreground shrink-0">{format(new Date(h.at), "dd MMM HH:mm:ss")}</div>
                    <div className="w-[160px] font-medium capitalize">{h.action.replace(/_/g, " ")}</div>
                    <div className="flex-1 text-muted-foreground">{h.detail}</div>
                  </div>
                ))}
                {edition.history.length === 0 && <div className="text-muted-foreground">No history available.</div>}
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="preview" forceMount className="m-0 h-full overflow-y-auto bg-muted/10 p-6 flex justify-center data-[state=inactive]:hidden">
            <div className="w-[800px] bg-white text-black shadow-xl min-h-[1000px] p-8">
              <DbPortsBulletin 
                payload={{ 
                  edition, 
                  mode: edition.status === "approved" ? "reviewed" : "working",
                  generatedAt: new Date().toISOString()
                }} 
              />
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
