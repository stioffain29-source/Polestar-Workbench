// Save-time guard notice for orphaned Fast Facts edits. Rendered by
// ReportEditor when the owner clicks Save while sectionOverrides still hold
// Fast Facts overrides keyed to a tile that no longer exists (a builder
// renamed the tile, so the edits render nowhere). Names each orphaned key so
// the owner sees exactly what would persist dead; "Save anyway" bypasses the
// guard once, Cancel dismisses. Fixing the orphans (re-attach/clear in the
// panel) auto-dismisses via the editor's effect, so a fixed form saves with
// no notice.
import { Button } from "@/components/ui/button";

export function OrphanSaveWarning({
  orphanKeys,
  onSaveAnyway,
  onCancel,
}: {
  orphanKeys: ReadonlyArray<string>;
  onSaveAnyway: () => void;
  onCancel: () => void;
}) {
  if (orphanKeys.length === 0) return null;
  const single = orphanKeys.length === 1;
  return (
    <div
      className="no-print border border-[#A33232] rounded-sm p-3"
      data-testid="orphan-save-warning"
    >
      <div className="text-[11px] font-sans uppercase tracking-widest text-[#A33232] mb-1">
        Orphaned Fast Facts edits — save paused
      </div>
      <p className="text-[12px] text-muted-foreground mb-2">
        {single
          ? "This saved edit is keyed to a tile that no longer exists and will not appear anywhere: "
          : "These saved edits are keyed to tiles that no longer exist and will not appear anywhere: "}
        {orphanKeys.map((k, i) => (
          <span key={k}>
            {i > 0 ? ", " : ""}
            <span className="font-medium text-foreground">&ldquo;{k}&rdquo;</span>
          </span>
        ))}
        . Re-attach or clear {single ? "it" : "them"} in the Fast Facts
        overrides section below, or save anyway to keep{" "}
        {single ? "the dead edit" : "the dead edits"} stored.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-sm h-8 text-[12px] border-[#A33232] text-[#A33232] hover:text-[#A33232]"
          onClick={onSaveAnyway}
        >
          Save anyway
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-sm h-8 text-[12px]"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
