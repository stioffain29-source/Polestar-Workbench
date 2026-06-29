// Resolve a data-driven report "read" paragraph. An analyst's editor override
// (when non-blank) replaces the generated read outright; a blank value falls
// back to the live dataset read so nothing is fabricated and the on-screen
// preview always equals the exported PDF. Shared by every topic preview + PDF
// exporter so the override semantics can never drift between the two surfaces.
export function pickRead(
  editor: string | null | undefined,
  auto: string | null | undefined,
): string {
  const t = (editor ?? "").trim();
  return t ? t : (auto ?? "");
}
