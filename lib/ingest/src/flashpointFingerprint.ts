import { createHash } from "node:crypto";

export function flashpointContentFingerprint(input: Record<string, unknown>): string {
  const normalise = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (Array.isArray(value)) return value.map(normalise);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalise(v)]),
    );
    return value ?? null;
  };
  return createHash("sha256").update(JSON.stringify(normalise(input))).digest("hex");
}