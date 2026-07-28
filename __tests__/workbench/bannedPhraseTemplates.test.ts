// §30 follow-up — the fail-closed banned-phrase gate covers engine-authored
// prose, but several RENDERED surfaces are still built from template strings
// outside the engine: assessed-theme paragraphs (countryThemeSynthesis →
// incidentThemesOverride), theme what/significance maps
// (countryIncidentThemes), operating-risk priority/action/trigger templates
// (operatingRiskProse) and the watchlist why/action lines (pngReportDataset).
// A banned phrase edited into any of those templates would ship straight into
// Papua/Indonesia/Thailand PDFs (it happened once: "This activity was more
// prominent"). This suite scans every string literal in those files with the
// engine's findBannedPhrases so the next template edit fails CI instead.
import { readFileSync } from "fs";
import { join } from "path";
import { findBannedPhrases } from "../../lib/country-engine/src/bannedPhrases";
import { THEME_WHAT, THEME_SIGNIFICANCE } from "../../artifacts/workbench/src/lib/countryIncidentThemes";
import { operatingRiskAction, operatingRiskTrigger } from "../../artifacts/workbench/src/lib/operatingRiskProse";

const LIB = join(__dirname, "../../artifacts/workbench/src/lib");

// Extract the contents of every string literal (single, double, backtick) in a
// TS source file. Comments are excluded so a doc-comment QUOTING a banned
// phrase (e.g. while explaining this very rule) cannot false-positive.
function stringLiterals(source: string): string[] {
  const noComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const out: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

const TEMPLATE_FILES = [
  "countryThemeSynthesis.ts", // assessed-theme trajectory sentences
  "countryIncidentThemes.ts", // theme what/significance templates
  "operatingRiskProse.ts", // priority/action/trigger templates
  "pngReportDataset.ts", // watchlist why/action lines + structured-brief prose
  "jakartaBrief.ts", // remaining consumed Jakarta templates
];

describe("banned phrases can never enter non-engine template surfaces (§30 follow-up)", () => {
  it.each(TEMPLATE_FILES)("%s contains no banned phrase in any string literal", (file) => {
    const src = readFileSync(join(LIB, file), "utf8");
    const offenders: string[] = [];
    for (const lit of stringLiterals(src)) {
      const hits = findBannedPhrases(lit);
      if (hits.length > 0) offenders.push(`${hits.join(", ")} ← "${lit.slice(0, 80)}"`);
    }
    expect(offenders).toEqual([]);
  });

  it("theme what/significance maps are clean", () => {
    for (const text of [...Object.values(THEME_WHAT), ...Object.values(THEME_SIGNIFICANCE)]) {
      expect(findBannedPhrases(text)).toEqual([]);
    }
  });

  it("operating-risk action/trigger templates are clean for arbitrary labels", () => {
    for (const label of ["violent crime", "civil unrest", "unknown-label"]) {
      expect(findBannedPhrases(operatingRiskAction(label))).toEqual([]);
      expect(findBannedPhrases(operatingRiskTrigger(label))).toEqual([]);
    }
  });
});
