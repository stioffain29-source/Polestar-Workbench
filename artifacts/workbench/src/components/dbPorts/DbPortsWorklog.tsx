import { useState } from "react";
import { 
  DbPortsEdition, 
  DbPortsWorklogActivity,
  useAddDbPortsWorklog,
  useDeleteDbPortsWorklog,
  getGetDbPortsEditionQueryKey
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Clock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  edition: DbPortsEdition;
}

export default function DbPortsWorklog({ edition }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const addMutation = useAddDbPortsWorklog();
  const delMutation = useDeleteDbPortsWorklog();
  
  const [activity, setActivity] = useState<DbPortsWorklogActivity>("research");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  
  const handleAdd = () => {
    const mins = parseInt(minutes, 10);
    if (!mins || isNaN(mins)) return;
    
    addMutation.mutate(
      { 
        id: edition.id, 
        data: {
          revision: edition.revision,
          activity,
          minutes: mins,
          notes
        } 
      },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsEditionQueryKey(edition.id), updated);
          setMinutes("");
          setNotes("");
          toast({ title: "Worklog entry added" });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Error", description: err?.data?.error });
        }
      }
    );
  };
  
  const handleDelete = (entryId: string) => {
    delMutation.mutate(
      { id: edition.id, entryId, data: { revision: edition.revision } },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsEditionQueryKey(edition.id), updated);
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Error", description: err?.data?.error });
        }
      }
    );
  };
  
  const totalMins = edition.quality.totalMinutes || 0;
  const hours = (totalMins / 60).toFixed(1);
  const overThreshold = totalMins > 2400; // 40 hours
  
  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-lg font-serif font-bold text-primary">Time & Effort Log</h2>
          <p className="text-sm text-muted-foreground">Log analyst effort against this edition.</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-sm text-muted-foreground font-sans">Corrections</div>
            <div className="text-lg font-mono font-bold">{edition.quality.corrections}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground font-sans">Missed Signals</div>
            <div className="text-lg font-mono font-bold">{edition.quality.missedSignals}</div>
          </div>
          <div className={`text-right ${overThreshold ? 'text-destructive' : 'text-foreground'}`}>
            <div className="text-sm text-muted-foreground font-sans">Total Hours</div>
            <div className="text-2xl font-mono font-bold">{hours}</div>
          </div>
        </div>
      </div>
      
      <div className="bg-muted/30 p-4 border border-border rounded-sm flex gap-4 items-end">
        <div className="w-1/4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Activity</label>
          <Select value={activity} onValueChange={(v: any) => setActivity(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.values(DbPortsWorklogActivity).map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-1/6">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Minutes</label>
          <Input type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="e.g. 45" />
        </div>
        <div className="flex-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Notes (Optional)</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was done?" />
        </div>
        <Button onClick={handleAdd} disabled={addMutation.isPending || !minutes}>
          <Plus className="w-4 h-4 mr-2" /> Add
        </Button>
      </div>
      
      <div className="space-y-2 mt-6">
        {edition.worklog.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">No worklog entries.</div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Activity</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {edition.worklog.map(entry => (
                <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-3 font-mono text-xs">{format(new Date(entry.createdAt), "dd MMM HH:mm")}</td>
                  <td className="px-3 py-3 font-medium capitalize">{entry.activity}</td>
                  <td className="px-3 py-3 font-mono text-xs">{entry.minutes}m</td>
                  <td className="px-3 py-3 text-muted-foreground">{entry.notes}</td>
                  <td className="px-3 py-3 text-right">
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(entry.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
