// Surfaces Fuel Watch overrides whose saved key no longer matches any current
// AUTO surface — the Gulf & Hormuz bullet overrides (keyed by the bullet's
// AUTO line) and the Market and Operator Responses row overrides (keyed by
// date|actor|action). Keys go stale when a data refresh changes the incident
// title, date wording or classification: the saved owner edit silently stops
// applying. The owner can re-attach the edit to a current bullet/row or clear
// it. Nothing is migrated silently; re-attach/clear only mutate the in-memory
// override map and persist on the normal Save. Mirrors OrphanedFastFactsPanel.
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type GulfBulletOverride,
  type MarketOperatorRowOverride,
  marketOperatorRowKey,
  orphanedGulfBulletOverrideKeys,
  orphanedMarketOperatorOverrideKeys,
} from "@/lib/topicSectionOverrides";

function OrphanShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 border border-[#A33232] rounded-sm p-2">
      <div className="text-[11px] font-sans uppercase tracking-widest text-[#A33232] mb-1">
        {title}
      </div>
      <p className="text-[11px] text-muted-foreground mb-2">{intro}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function ReattachRow({
  options,
  onReattach,
  onClear,
  placeholder,
}: {
  options: ReadonlyArray<{ value: string; label: string }>;
  onReattach: (to: string) => void;
  onClear: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Select value="" onValueChange={onReattach}>
        <SelectTrigger className="rounded-sm text-[12px] h-8 flex-1">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-sm h-8 text-[12px]"
        onClick={onClear}
      >
        Clear
      </Button>
    </div>
  );
}

export function OrphanedGulfBulletsPanel({
  autoLines,
  overrides,
  onReattach,
  onClear,
}: {
  autoLines: ReadonlyArray<string>;
  overrides: Record<string, GulfBulletOverride> | null | undefined;
  onReattach: (from: string, to: string) => void;
  onClear: (key: string) => void;
}) {
  const orphans = orphanedGulfBulletOverrideKeys(autoLines, overrides);
  if (orphans.length === 0) return null;
  return (
    <OrphanShell
      title="Orphaned Gulf & Hormuz bullet edits"
      intro="These saved edits were keyed to a bullet whose auto text has changed. They are not applied. Re-attach each edit to a current bullet, or clear it."
    >
      {orphans.map((key) => {
        const ov = overrides?.[key] ?? {};
        const parts = [
          ov.text ? `text "${ov.text}"` : "",
          ov.suppressed ? "suppressed" : "",
        ].filter(Boolean);
        return (
          <div key={key} className="border border-border rounded-sm p-2">
            <div className="text-[11px] text-muted-foreground mb-1.5">
              Was: {key}
              {parts.length > 0 ? ` — edit: ${parts.join(", ")}` : ""}
            </div>
            <ReattachRow
              options={autoLines.map((l) => ({ value: l, label: l }))}
              onReattach={(to) => onReattach(key, to)}
              onClear={() => onClear(key)}
              placeholder="Re-attach to bullet…"
            />
          </div>
        );
      })}
    </OrphanShell>
  );
}

export function OrphanedMarketOperatorPanel({
  autoRows,
  overrides,
  onReattach,
  onClear,
}: {
  autoRows: ReadonlyArray<{ date: string; actor: string; action: string }>;
  overrides: Record<string, MarketOperatorRowOverride> | null | undefined;
  onReattach: (from: string, to: string) => void;
  onClear: (key: string) => void;
}) {
  const orphans = orphanedMarketOperatorOverrideKeys(autoRows, overrides);
  if (orphans.length === 0) return null;
  return (
    <OrphanShell
      title="Orphaned Market and Operator Responses edits"
      intro="These saved edits were keyed to a row whose auto date, actor or action has changed. They are not applied. Re-attach each edit to a current row, or clear it."
    >
      {orphans.map((key) => {
        const ov = overrides?.[key] ?? {};
        const parts = [
          ov.actor ? `actor "${ov.actor}"` : "",
          ov.category ? `category "${ov.category}"` : "",
          ov.action ? `action "${ov.action}"` : "",
          ov.read ? `read "${ov.read}"` : "",
          ov.date ? `date "${ov.date}"` : "",
          ov.suppressed ? "suppressed" : "",
        ].filter(Boolean);
        return (
          <div key={key} className="border border-border rounded-sm p-2">
            <div className="text-[11px] text-muted-foreground mb-1.5">
              Was: {key.split("|").join(" · ")}
              {parts.length > 0 ? ` — edit: ${parts.join(", ")}` : ""}
            </div>
            <ReattachRow
              options={autoRows.map((r) => ({
                value: marketOperatorRowKey(r),
                label: `${r.date} · ${r.actor} — ${r.action}`,
              }))}
              onReattach={(to) => onReattach(key, to)}
              onClear={() => onClear(key)}
              placeholder="Re-attach to row…"
            />
          </div>
        );
      })}
    </OrphanShell>
  );
}
