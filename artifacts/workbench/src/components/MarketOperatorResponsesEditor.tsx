// Compact editor for the Fuel Watch "Market and Operator Responses" table.
//
// UI-ONLY simplification of the old always-open override grid: each response
// renders as ONE collapsed row (include checkbox, actor, category, date,
// short action summary, Edit). Selecting Edit opens an expandable panel whose
// fields are PREPOPULATED with the values the report currently renders
// (override when saved, generated otherwise) — the user never sees blank
// fields or needs to know that "blank = auto".
//
// Persistence is unchanged: overrides still live in
// sectionOverrides.marketOperatorOverrides keyed by marketOperatorRowKey, and
// a field equal to the generated value is stored as ABSENT (so unedited
// fields keep following the generated text — the same blank=auto mechanics,
// now applied on Save instead of exposed in the UI). Report generation,
// preview and PDF logic are untouched.

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  marketOperatorRowKey,
  type MarketOperatorRowOverride,
} from "@/lib/topicSectionOverrides";
import type { ProducerBuyerActionRow } from "@/lib/fuelNarratives";

const CATEGORY_OPTIONS = [
  "Producer action",
  "Buyer action",
  "Government / policy action",
  "Infrastructure / routing action",
  "Market / supply signal",
] as const;

interface DraftFields {
  actor: string;
  category: string;
  date: string;
  action: string;
  read: string;
}

export function effectiveFields(
  row: ProducerBuyerActionRow,
  ov: MarketOperatorRowOverride,
): DraftFields {
  const pick = (o: string | undefined, auto: string) =>
    (o ?? "").trim() ? (o as string) : auto;
  return {
    actor: pick(ov.actor, row.actor),
    category: pick(ov.category, row.category),
    date: pick(ov.date, row.date),
    action: pick(ov.action, row.action),
    read: pick(ov.read, row.operationalRead),
  };
}

/** Convert edited fields back to the sparse override shape: a field equal to
 *  the GENERATED value is dropped so it keeps following future auto text. */
export function toOverride(
  row: ProducerBuyerActionRow,
  draft: DraftFields,
  suppressed: boolean | undefined,
): MarketOperatorRowOverride {
  const diff = (edited: string, auto: string) => {
    const t = edited.trim();
    return t && t !== auto ? t : undefined;
  };
  return {
    ...(diff(draft.actor, row.actor) ? { actor: draft.actor.trim() } : {}),
    ...(diff(draft.category, row.category)
      ? { category: draft.category.trim() }
      : {}),
    ...(diff(draft.date, row.date) ? { date: draft.date.trim() } : {}),
    ...(diff(draft.action, row.action) ? { action: draft.action.trim() } : {}),
    ...(diff(draft.read, row.operationalRead)
      ? { read: draft.read.trim() }
      : {}),
    ...(suppressed ? { suppressed: true } : {}),
  };
}

export function MarketOperatorResponsesEditor(props: {
  rows: ProducerBuyerActionRow[];
  overrides: Record<string, MarketOperatorRowOverride> | undefined;
  onSetOverride: (key: string, value: MarketOperatorRowOverride) => void;
}) {
  const { rows, overrides, onSetOverride } = props;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftFields | null>(null);

  if (rows.length === 0) return null;

  return (
    <div className="border-t border-border pt-3 mt-1">
      <div className="text-[11px] font-sans uppercase tracking-widest text-muted-foreground mb-1">
        Market and Operator Responses
      </div>
      <p className="text-[11px] text-muted-foreground mb-2">
        Uncheck to remove a row from the report. Select Edit to change what it
        says.
      </p>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const k = marketOperatorRowKey(row);
          const ov = overrides?.[k] ?? {};
          const eff = effectiveFields(row, ov);
          const edited =
            Boolean(ov.actor || ov.category || ov.date || ov.action || ov.read);
          const isEditing = editingKey === k && draft;

          const openEditor = () => {
            setEditingKey(k);
            setDraft(effectiveFields(row, ov));
          };
          const closeEditor = () => {
            setEditingKey(null);
            setDraft(null);
          };

          return (
            <div
              key={k}
              className="border border-border rounded-sm"
              style={{ opacity: ov.suppressed ? 0.5 : 1 }}
              data-testid={`mor-row-${k}`}
            >
              <div className="flex items-center gap-2 px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={!ov.suppressed}
                  aria-label="Include row in report"
                  onChange={(e) =>
                    onSetOverride(k, {
                      ...ov,
                      ...(e.target.checked
                        ? { suppressed: undefined }
                        : { suppressed: true }),
                    })
                  }
                />
                <div className="min-w-0 flex-1 text-[12px] text-foreground truncate">
                  <span className="font-medium">{eff.actor}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {eff.category} · {eff.date} — {eff.action}
                  </span>
                  {edited && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider text-amber-700">
                      edited
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11px] rounded-sm shrink-0"
                  onClick={() => (isEditing ? closeEditor() : openEditor())}
                >
                  {isEditing ? "Close" : "Edit"}
                </Button>
              </div>

              {isEditing && draft && (
                <div className="border-t border-border px-2 py-2 flex flex-col gap-1.5 bg-muted/30">
                  <div className="grid grid-cols-3 gap-1.5">
                    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Actor
                      <Input
                        value={draft.actor}
                        onChange={(e) =>
                          setDraft({ ...draft, actor: e.target.value })
                        }
                        className="rounded-sm text-[12px] h-8 normal-case tracking-normal"
                      />
                    </label>
                    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Category
                      <select
                        value={draft.category}
                        onChange={(e) =>
                          setDraft({ ...draft, category: e.target.value })
                        }
                        className="h-8 rounded-sm border border-input bg-background px-2 text-[12px] normal-case tracking-normal"
                      >
                        {!CATEGORY_OPTIONS.includes(
                          draft.category as (typeof CATEGORY_OPTIONS)[number],
                        ) && (
                          <option value={draft.category}>{draft.category}</option>
                        )}
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Date
                      <Input
                        value={draft.date}
                        onChange={(e) =>
                          setDraft({ ...draft, date: e.target.value })
                        }
                        className="rounded-sm text-[12px] h-8 normal-case tracking-normal"
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Action
                    <Textarea
                      value={draft.action}
                      onChange={(e) =>
                        setDraft({ ...draft, action: e.target.value })
                      }
                      rows={2}
                      className="rounded-sm text-[12px] normal-case tracking-normal"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Operational Read
                    <Textarea
                      value={draft.read}
                      onChange={(e) =>
                        setDraft({ ...draft, read: e.target.value })
                      }
                      rows={2}
                      className="rounded-sm text-[12px] normal-case tracking-normal"
                    />
                  </label>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-3 text-[11px] rounded-sm"
                      onClick={() => {
                        onSetOverride(k, toOverride(row, draft, ov.suppressed));
                        closeEditor();
                      }}
                    >
                      Save Changes
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-3 text-[11px] rounded-sm"
                      onClick={closeEditor}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-3 text-[11px] rounded-sm text-muted-foreground"
                      onClick={() => {
                        // Clear this row's text overrides (include state is
                        // preserved) and reload the generated values into the
                        // open editor.
                        onSetOverride(
                          k,
                          ov.suppressed ? { suppressed: true } : {},
                        );
                        setDraft(effectiveFields(row, {}));
                      }}
                    >
                      Restore Generated Version
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
