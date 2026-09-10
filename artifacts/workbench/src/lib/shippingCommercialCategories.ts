import type { ShippingSevenPageCommercialEffect } from "./shippingSevenPagePresentation";

/** These are reader-facing questions, not assumed consequences. */
const QUESTIONS: Array<[string, RegExp]> = [
  ["Route changes", /\brerout|route chang|divert|avoid(?:ing|ance)|route restrict|exclusion zone|restricted zone/i],
  ["Transit delays", /\bdelay|longer transit|transit time|additional days|extra days/i],
  ["War-risk premium pressure", /war.?risk.{0,45}premi|premi.{0,45}war.?risk/i],
  ["Marine insurance", /\binsuran|underwrit|cover(?:age)? withdraw/i],
  ["Chartering", /\bcharter|fixture|vessel availability/i],
  ["Freight costs", /\bfreight|shipping cost|transport cost|cargo rate/i],
];

export function buildShippingCommercialCategories(effects: ShippingSevenPageCommercialEffect[]) {
  const used = new Set<ShippingSevenPageCommercialEffect>();
  const toLines = (items: ShippingSevenPageCommercialEffect[]) => {
    const lines = [...new Set(items.map(item => `${item.status === "confirmed" ? "Confirmed" : "Assessed"} — ${item.claim}`))];
    return lines.length > 2 ? [...lines.slice(0, 2), `${lines.length - 2} additional source-backed effects.`] : lines;
  };
  const groups = QUESTIONS.map(([title, pattern]) => {
    const matching = effects.filter(effect => effect.claim && pattern.test(`${effect.kind ?? ""} ${effect.claim}`));
    matching.forEach(effect => used.add(effect));
    return { title, lines: toLines(matching) };
  });
  const other = effects.filter(effect => effect.claim && !used.has(effect));
  if (other.length) groups.push({ title: "Other documented effects", lines: toLines(other) });
  return groups;
}