// Surfaces Fast Facts overrides whose saved key (the auto tile label at the
// time of the edit) no longer matches any current auto tile — i.e. a dataset
// builder renamed the tile and the saved owner edit silently stopped applying.
// The owner can re-attach the edit to a current tile or clear it. Nothing is
// migrated silently; re-attach/clear only mutate the in-memory override map
// and persist on the normal Save.
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type FastFactOverride,
  orphanedFastFactOverrideKeys,
} from "@/lib/topicSectionOverrides";

export function OrphanedFastFactsPanel({
  autoFastFacts,
  overrides,
  onReattach,
  onClear,
}: {
  autoFastFacts: ReadonlyArray<{ label: string }>;
  overrides: Record<string, FastFactOverride> | null | undefined;
  onReattach: (from: string, to: string) => void;
  onClear: (key: string) => void;
}) {
  const orphans = orphanedFastFactOverrideKeys(autoFastFacts, overrides);
  if (orphans.length === 0) return null;
  return (
    <div className="mt-2 border border-[#A33232] rounded-sm p-2">
      <div className="text-[11px] font-sans uppercase tracking-widest text-[#A33232] mb-1">
        Orphaned Fast Facts edits
      </div>
      <p className="text-[11px] text-muted-foreground mb-2">
        These saved edits were keyed to a tile that no longer exists (the tile
        was renamed). They are not applied. Re-attach each edit to a current
        tile, or clear it.
      </p>
      <div className="flex flex-col gap-2">
        {orphans.map((key) => {
          const ov = overrides?.[key] ?? {};
          const parts = [
            ov.label ? `label "${ov.label}"` : "",
            ov.value ? `value "${ov.value}"` : "",
            ov.note ? `note "${ov.note}"` : "",
          ].filter(Boolean);
          return (
            <div key={key} className="border border-border rounded-sm p-2">
              <div className="text-[11px] text-muted-foreground mb-1.5">
                Was: {key}
                {parts.length > 0 ? ` — edit: ${parts.join(", ")}` : ""}
              </div>
              <div className="flex items-center gap-1.5">
                <Select value="" onValueChange={(to) => onReattach(key, to)}>
                  <SelectTrigger className="rounded-sm text-[12px] h-8 flex-1">
                    <SelectValue placeholder="Re-attach to tile…" />
                  </SelectTrigger>
                  <SelectContent>
                    {autoFastFacts.map((c) => (
                      <SelectItem key={c.label} value={c.label}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-sm h-8 text-[12px]"
                  onClick={() => onClear(key)}
                >
                  Clear
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
