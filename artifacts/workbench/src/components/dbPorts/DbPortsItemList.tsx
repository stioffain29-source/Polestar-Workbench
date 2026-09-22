import type { DbPortsEdition, DbPortsItem, DbPortsItemContentDisposition } from "@workspace/api-client-react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsRight, Eye, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  edition: DbPortsEdition;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onGenerate: () => void;
  onAddManual: () => void;
  onMove: (item: DbPortsItem, disposition: DbPortsItemContentDisposition) => void;
  onReorder: (item: DbPortsItem, direction: -1 | 1) => void;
  generating: boolean;
  busy: boolean;
  actionsDisabled: boolean;
}

const GROUPS: Array<{ key: DbPortsItemContentDisposition; label: string; note?: string }> = [
  { key: "selected", label: "Report items" },
  { key: "watch", label: "Watchlist" },
  { key: "hold", label: "Held — collected but not drafted in" },
  { key: "inbox", label: "Collected material" },
  { key: "rejected", label: "Removed" },
];

export default function DbPortsItemList({
  edition,
  selectedId,
  onSelect,
  onGenerate,
  onAddManual,
  onMove,
  onReorder,
  generating,
  busy,
  actionsDisabled,
}: Props) {
  const groups = new Map<DbPortsItemContentDisposition, DbPortsItem[]>(
    GROUPS.map((group) => [group.key, [] as DbPortsItem[]]),
  );
  for (const item of edition.items) {
    groups.get(item.disposition)?.push(item);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-card p-3">
        <Button
          onClick={onGenerate}
          disabled={actionsDisabled || generating}
          className="h-8 w-full text-xs"
          data-testid="button-generate-draft"
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {generating ? "Drafting…" : "Generate Draft"}
        </Button>
        <Button
          onClick={onAddManual}
          disabled={actionsDisabled || busy}
          className="h-8 w-full text-xs"
          variant="outline"
          data-testid="button-add-item"
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add item from collected material
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {GROUPS.map((group) => {
          const items = groups.get(group.key) ?? [];
          if (!items.length) return null;
          return (
            <div key={group.key} className="mb-4">
              <div className="flex items-center justify-between border-y border-border bg-muted/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <span>{group.label}</span>
                <span className="rounded-sm border border-border bg-card px-1.5">{items.length}</span>
              </div>
              <div className="flex flex-col">
                {items.map((item, index) => (
                  <div
                    key={item.id}
                    className={`border-b border-border/50 border-l-2 p-3 transition-colors hover:bg-muted/30 ${
                      selectedId === item.id ? "border-l-accent bg-accent/10" : "border-l-transparent"
                    }`}
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => onSelect(item.id)}
                      data-testid={`button-item-${item.id}`}
                    >
                      <div className="line-clamp-2 font-serif text-sm font-medium leading-tight text-foreground">
                        {item.headline || "Untitled item"}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="truncate font-mono text-[10px] text-muted-foreground">
                          {[item.country, item.location].filter(Boolean).join(" • ") || "Location not recorded"}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {item.warnings.length > 0 && (
                            <span
                              className="flex items-center gap-0.5 text-[10px] font-bold text-amber-600"
                              title={item.warnings.map((warning) => warning.message).join("\n")}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {item.warnings.length}
                            </span>
                          )}
                          <span className="rounded-sm bg-muted px-1 text-[9px] font-bold uppercase text-muted-foreground">
                            {item.severity ?? "unrated"}
                          </span>
                        </div>
                      </div>
                    </button>
                    <div className="mt-2 flex items-center gap-1">
                      {group.key === "selected" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title="Move up"
                            disabled={busy || index === 0}
                            onClick={() => onReorder(item, -1)}
                            data-testid={`button-up-${item.id}`}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title="Move down"
                            disabled={busy || index === items.length - 1}
                            onClick={() => onReorder(item, 1)}
                            data-testid={`button-down-${item.id}`}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            disabled={busy}
                            onClick={() => onMove(item, "watch")}
                            data-testid={`button-to-watch-${item.id}`}
                          >
                            <ChevronsRight className="mr-1 h-3 w-3" /> To watchlist
                          </Button>
                        </>
                      )}
                      {group.key !== "selected" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          disabled={busy}
                          onClick={() => onMove(item, "selected")}
                          data-testid={`button-to-report-${item.id}`}
                        >
                          <Eye className="mr-1 h-3 w-3" /> To report
                        </Button>
                      )}
                      {group.key !== "watch" && group.key !== "selected" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          disabled={busy}
                          onClick={() => onMove(item, "watch")}
                          data-testid={`button-hold-to-watch-${item.id}`}
                        >
                          To watchlist
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {edition.items.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nothing collected yet. Generate a draft to pull this period's material from the Workbench.
          </div>
        )}
      </div>
    </div>
  );
}
