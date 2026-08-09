// Sentence-grade list joining, shared by every narrative builder.
//
// "Iraq, Saudi Arabia carry the most activity" reads as a typo; prose lists
// take "and" before the final item ("Iraq and Saudi Arabia carry...",
// "Iraq, Iran and Saudi Arabia carry..."). Any country/name list embedded in
// a sentence must go through this helper rather than a bare join(", ").
export function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
