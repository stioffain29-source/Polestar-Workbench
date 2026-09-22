import { useState } from "react";
import { 
  DbPortsEdition,
  DbPortsCoverageStatus,
  useRecordDbPortsCoverage,
  useGetDbPortsSettings,
  getGetDbPortsEditionQueryKey
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Check, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  edition: DbPortsEdition;
}

export default function DbPortsCoverage({ edition }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mutation = useRecordDbPortsCoverage();
  const { data: settings } = useGetDbPortsSettings();
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<DbPortsCoverageStatus>("checked");
  const [notes, setNotes] = useState("");
  
  const handleRecord = (sourceId: string) => {
    mutation.mutate(
      { 
        id: edition.id, 
        data: {
          revision: edition.revision,
          sourceId,
          status,
          notes
        } 
      },
      {
        onSuccess: (updated) => {
          qc.setQueryData(getGetDbPortsEditionQueryKey(edition.id), updated);
          setEditingId(null);
          toast({ title: "Coverage recorded" });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Error", description: err?.data?.error });
        }
      }
    );
  };

  const sources = settings?.sources || [];

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-lg font-serif font-bold text-primary">Source Coverage</h2>
          <p className="text-sm text-muted-foreground">Log explicit verification of required sources.</p>
        </div>
      </div>
      
      <div className="space-y-2">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Country/Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Last Checked</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {sources.map(src => {
              const cov = edition.coverage.find(c => c.sourceId === src.id);
              const isEditing = editingId === src.id;
              
              return (
                <tr key={src.id} className="border-b border-border/50 hover:bg-muted/10">
                  <td className="px-3 py-3 font-medium">
                    <a href={src.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{src.name}</a>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{src.country} • {src.sourceType}</td>
                  
                  {isEditing ? (
                    <td colSpan={4} className="px-3 py-2 bg-muted/30">
                      <div className="flex items-center gap-3">
                        <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="checked">Checked (OK)</SelectItem>
                            <SelectItem value="no_material">No Material</SelectItem>
                            <SelectItem value="unavailable">Unavailable/Failed</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input className="flex-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes..." />
                        <Button size="sm" onClick={() => handleRecord(src.id)} disabled={mutation.isPending}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-3">
                        {cov ? (
                          <span className={`flex items-center gap-1 text-xs font-bold uppercase ${
                            cov.status === 'checked' ? 'text-emerald-500' :
                            cov.status === 'unavailable' ? 'text-destructive' : 'text-amber-500'
                          }`}>
                            {cov.status === 'checked' ? <Check className="w-3 h-3"/> :
                             cov.status === 'unavailable' ? <X className="w-3 h-3"/> : <AlertCircle className="w-3 h-3"/>}
                            {cov.status.replace("_", " ")}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Unchecked</span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                        {cov ? format(new Date(cov.checkedAt), "dd MMM HH:mm") : "-"}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                        {cov?.notes || "-"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => {
                          setStatus(cov?.status || "checked");
                          setNotes(cov?.notes || "");
                          setEditingId(src.id);
                        }}>
                          {cov ? "Update" : "Record"}
                        </Button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
