import { useState } from "react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { Ship, Plus, Settings, AlertTriangle, Calendar } from "lucide-react";
import {
  useListDbPortsEditions,
  useCreateDbPortsEdition,
  getListDbPortsEditionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function DbPortsEditions() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { data: editions = [], isLoading } = useListDbPortsEditions();
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newEndDate, setNewEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const { toast } = useToast();

  const createMutation = useCreateDbPortsEdition({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getListDbPortsEditionsQueryKey() });
        setCreateOpen(false);
        setLocation(`/db-ports/${data.id}`);
      },
      onError: (err: any) => {
        toast({
          variant: "destructive",
          title: "Failed to create edition",
          description: err?.data?.error || "Unknown error occurred.",
        });
      },
    },
  });

  const handleCreate = () => {
    if (!newEndDate) return;
    createMutation.mutate({
      data: {
        endDate: newEndDate,
        ...(newTitle.trim() ? { title: newTitle.trim() } : {}),
      },
    });
  };

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">
            Reports
          </div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1 flex items-center gap-3">
            <Ship className="w-8 h-8" />
            Ports and Logistics Intelligence
          </h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">
            Fortnightly APAC and Oceania reporting on port, maritime and logistics disruption
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => setLocation("/db-ports/settings")}
            className="rounded-sm"
          >
            <Settings className="w-4 h-4 mr-2" />
            Report Settings
          </Button>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Edition
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading && <div className="text-muted-foreground">Loading editions...</div>}
        {!isLoading && editions.length === 0 && (
          <div className="text-sm text-muted-foreground col-span-full">
            No editions created yet.
          </div>
        )}
        {editions.map((ed) => (
          <div
            key={ed.id}
            className="bg-card border border-border rounded-sm p-5 hover:border-accent/50 transition-colors group flex flex-col h-full"
          >
            <div className="flex items-start justify-between">
              <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary-foreground">
                {ed.quality.selectedCount > 0 ? "drafted" : "not drafted"}
              </span>
              {ed.quality.warnings.length > 0 && (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
            </div>

            <Link href={`/db-ports/${ed.id}`} className="block mt-3 flex-1">
              <h2 className="font-serif font-bold text-lg text-primary group-hover:text-accent transition-colors">
                {ed.title || "Untitled Edition"}
              </h2>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 font-mono">
                <Calendar className="w-3.5 h-3.5" />
                {ed.startDate} to {ed.endDate}
              </div>
            </Link>

            <div className="mt-4 pt-3 border-t border-border grid grid-cols-3 gap-2 text-center text-xs font-mono">
              <div>
                <div className="text-muted-foreground/70">SEL</div>
                <div className="font-medium text-foreground">{ed.quality.selectedCount}</div>
              </div>
              <div>
                <div className="text-muted-foreground/70">WAT</div>
                <div className="font-medium text-foreground">{ed.quality.watchCount}</div>
              </div>
              <div>
                <div className="text-muted-foreground/70">WARN</div>
                <div
                  className={`font-medium ${
                    ed.quality.warnings.length > 0 ? "text-amber-500" : "text-foreground"
                  }`}
                >
                  {ed.quality.warnings.length}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="font-serif">Create New Edition</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Start date will be automatically derived (14 days inclusive).
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="title">Title (Optional)</Label>
              <Input
                id="title"
                placeholder="e.g. Early Jan 2024"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending || !newEndDate}>
              {createMutation.isPending ? "Creating..." : "Create Edition"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
