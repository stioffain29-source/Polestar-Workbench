/** Shared prose list helpers. */

/** Join values as natural English: "a", "a and b", "a, b and c". */
export function joinWithAnd(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
