// Fuel Watch "Market and Operator Responses" editor.
//
// Analysts edit the generated text in place. Each row is a checkbox plus
// the action and operational-read text the report currently renders.
// Persistence is unchanged: overrides live in
// sectionOverrides.marketOperatorOverrides keyed by marketOperatorRowKey,
// and a field equal to the generated value is stored as ABSENT so unedited
// fields keep following the generated text.

import { Textarea } from "@/components/ui/textarea";
import {
  marketOperatorRowKey,
  type MarketOperatorRowOverride,
} from "@/lib/topicSectionOverrides";
import type { ProducerBuyerActionRow } from "@/lib/fuelNarratives";

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

  if (rows.length === 0) return null;

  return (
    <div className="border-t border-border pt-3 mt-1">
      <div className="text-[11px] font-sans uppercase tracking-widest text-muted-foreground mb-1">
        Market and Operator Responses
      </div>
      <p className="text-[11px] text-muted-foreground mb-2">
        Uncheck to omit a row. Edit the generated text directly.
      </p>
      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const k = marketOperatorRowKey(row);
          const ov = overrides?.[k] ?? {};
          const eff = effectiveFields(row, ov);

          const patchText = (field: "action" | "read", value: string) => {
            onSetOverride(
              k,
              toOverride(row, { ...eff, [field]: value }, ov.suppressed),
            );
          };

          return (
            <div
              key={k}
              className="border border-border rounded-sm p-2"
              style={{ opacity: ov.suppressed ? 0.5 : 1 }}
              data-testid={`mor-row-${k}`}
            >
              <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!ov.suppressed}
                  aria-label="Include row in report"
                  onChange={(e) =>
                    onSetOverride(
                      k,
                      toOverride(
                        row,
                        eff,
                        e.target.checked ? undefined : true,
                      ),
                    )
                  }
                />
                <span className="min-w-0 flex-1 text-[12px] text-foreground truncate">
                  <span className="font-medium">{eff.actor}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {eff.category} · {eff.date}
                  </span>
                </span>
              </label>
              <Textarea
                value={eff.action}
                onChange={(e) => patchText("action", e.target.value)}
                rows={2}
                aria-label="Action"
                className="rounded-sm text-[12px] mb-1.5"
              />
              <Textarea
                value={eff.read}
                onChange={(e) => patchText("read", e.target.value)}
                rows={2}
                aria-label="Operational read"
                className="rounded-sm text-[12px]"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
