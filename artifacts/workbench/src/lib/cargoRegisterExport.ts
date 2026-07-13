import type { CargoAppendixRow } from "@/lib/cargoPatternModel";

// Export the FULL deduplicated cargo incident register as CSV. This is the
// Workbench-only companion to the report's curated "Selected Incidents": the
// standard PDF carries only the six cards, while the analyst can pull the
// complete register here. Nothing is fabricated — blank source fields export
// as empty cells.

const REGISTER_HEADERS = [
  "Date",
  "Country",
  "Location",
  "Category",
  "Incident summary",
  "Severity",
  "Confidence",
  "Status",
  "Cargo type",
  "Company/operator",
  "Source reference",
] as const;

// Escape one CSV cell: neutralise spreadsheet formula injection by prefixing a
// single quote when a value begins with =, +, -, or @, then quote-wrap when the
// value contains a comma, quote or newline (doubling embedded quotes).
function escapeCell(value: string): string {
  let v = value ?? "";
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

function registerRow(r: CargoAppendixRow): string[] {
  const date = r.date ? r.date.slice(0, 10) : "";
  const sourceRef = r.source || r.sourceUrl || "";
  return [
    date,
    r.country ?? "",
    r.location ?? "",
    r.category ?? "",
    r.summary ?? "",
    r.severityLabel ?? "",
    r.confidenceLabel ?? "",
    r.status ?? "",
    r.cargoType ?? "",
    r.company ?? "",
    sourceRef,
  ];
}

export function buildCargoRegisterCsv(rows: CargoAppendixRow[]): string {
  const lines: string[][] = [REGISTER_HEADERS.slice()];
  for (const r of rows) lines.push(registerRow(r));
  return lines.map((cells) => cells.map(escapeCell).join(",")).join("\r\n");
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCargoRegisterCsv(
  rows: CargoAppendixRow[],
  filename: string,
): void {
  // Prepend a UTF-8 BOM so Excel opens accented place names correctly.
  const csv = "\uFEFF" + buildCargoRegisterCsv(rows);
  triggerDownload(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    filename,
  );
}
