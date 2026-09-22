import { 
  DbPortsEdition, 
  DbPortsItemContentDisposition 
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { DownloadCloud, FileText, Filter, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  edition: DbPortsEdition;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onImport: () => void;
  importing: boolean;
  importDisabled: boolean;
}

export default function DbPortsItemList({ edition, selectedId, onSelect, onImport, importing, importDisabled }: Props) {
  const groups: Record<DbPortsItemContentDisposition, any[]> = {
    inbox: [],
    selected: [],
    watch: [],
    hold: [],
    rejected: []
  };
  
  edition.items.forEach(item => {
    groups[item.disposition].push(item);
  });
  
  const groupOrder: DbPortsItemContentDisposition[] = ["inbox", "selected", "watch", "hold", "rejected"];
  
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border bg-card sticky top-0 z-10 flex flex-col gap-3">
        <Button onClick={onImport} disabled={importDisabled || importing} className="w-full text-xs h-8" variant="secondary">
          <DownloadCloud className="w-3.5 h-3.5 mr-2" />
          {importing ? "Importing..." : "Import 14-Day Feeds"}
        </Button>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {groupOrder.map(disp => {
          const items = groups[disp];
          if (items.length === 0) return null;
          
          return (
            <div key={disp} className="mb-4">
              <div className="px-3 py-1.5 bg-muted/50 border-y border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between items-center sticky top-0 z-0">
                <span>{disp}</span>
                <span className="bg-card px-1.5 rounded-sm border border-border">{items.length}</span>
              </div>
              <div className="flex flex-col">
                {items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className={`text-left p-3 border-b border-border/50 hover:bg-muted/30 transition-colors ${
                      selectedId === item.id ? 'bg-accent/10 border-l-2 border-l-accent' : 'border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="font-serif text-sm font-medium text-foreground line-clamp-2 leading-tight">
                      {item.headline || "Untitled"}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                        {item.country} • {item.location}
                      </div>
                      <div className="flex items-center gap-1">
                        {item.blockers && item.blockers.length > 0 && (
                          <AlertTriangle className="w-3 h-3 text-destructive" />
                        )}
                        <span className="text-[9px] uppercase font-bold text-muted-foreground bg-muted px-1 rounded-sm">
                          {item.theme}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {edition.items.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No candidates yet. Try importing feeds.
          </div>
        )}
      </div>
    </div>
  );
}
