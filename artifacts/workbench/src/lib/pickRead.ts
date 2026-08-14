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

/** True when prose matches the fixed templates emitted by flashpointReportDataset. */
export function looksLikeAutoFlashpointRead(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /^The main protest event across .+ was .+, rated (?:Insignificant|Low|Moderate|High|Extreme) severity\./m.test(t) ||
    /^Little protest, strike, student or sit-in activity was reported across/m.test(t) ||
    /^No single protest event stood out across/m.test(t) ||
    /^The most serious civil-unrest event across/m.test(t) ||
    /^Little riot, clash, crackdown, curfew or security-force activity was reported across/m.test(t) ||
    /^Civil unrest across .+ was limited/m.test(t) ||
    /^Confirmed upcoming events with stated dates are listed in the table above/m.test(t) ||
    /^Upcoming signals are listed in the table above/m.test(t) ||
    /^Upcoming signals without confirmed dates are listed in the table above/m.test(t) ||
    /^No confirmed upcoming protest calls, strike notices or scheduled hearings have been reported/m.test(t) ||
    /^The near-term outlook is for continued quiet/m.test(t) ||
    /This outlook is based on one reporting period and on confirmed announcements only/m.test(t) ||
    /^Activity this week is spread across/m.test(t) ||
    /^This week activity centres on/m.test(t) ||
    /^No activity could be tied to a specific country this week/m.test(t) ||
    /^Few events could be tied to a specific country this week/m.test(t) ||
    / — The (?:busiest|second-busiest|third-busiest) country this week \(/m.test(t)
  );
}

/**
 * Flashpoint section reads are seeded from the dataset builder. When dataset
 * logic changes, a previously saved auto paragraph must not block the fresh
 * read at export/preview time. Returns "" to fall back to live auto-prose;
 * returns the editor text only for genuine analyst overrides.
 */
export function resolveFlashpointReadOverride(
  editor: string | null | undefined,
  generated: string | null | undefined,
): string {
  const editorText = (editor ?? "").trim();
  const generatedText = (generated ?? "").trim();
  if (!editorText) return "";
  if (editorText === generatedText) return "";
  if (looksLikeAutoFlashpointRead(editorText)) return "";
  return editorText;
}

export function pickFlashpointRead(
  editor: string | null | undefined,
  auto: string | null | undefined,
): string {
  return pickRead(resolveFlashpointReadOverride(editor, auto), auto);
}
