// Text-quality checker for the country-brief narrative sweep
// (verifyCountryBriefs.sh). Reads a pdftotext extraction of a headlessly
// exported country brief and fails loudly when:
//   - any §30 banned phrase appears in the PDF text, or
//   - the theatre had NO prior-window data yet the ASSESSED PROSE contains
//     §16 trend/comparison wording.
//
// The lists are imported from @workspace/country-engine so this checker can
// never drift from the authoritative definitions.
//
// Usage:
//   tsx scripts/checkCountryNarrativeText.ts <text-file> <hasPriorData:true|false> <label>
import { readFileSync } from "node:fs";
import { findBannedPhrases } from "@workspace/country-engine/bannedPhrases";
import { TREND_WORDS } from "@workspace/country-engine/narrative";

const [, , textPath, hasPriorDataRaw, label] = process.argv;
if (!textPath || !hasPriorDataRaw) {
  console.error(
    "Usage: checkCountryNarrativeText.ts <text-file> <hasPriorData> <label>",
  );
  process.exit(2);
}
const hasPriorData = hasPriorDataRaw === "true";
const name = label ?? textPath;

// pdftotext breaks lines mid-sentence (and the two-column layout can insert
// hard breaks inside a phrase), so collapse ALL whitespace before matching.
const raw = readFileSync(textPath, "utf8");
const text = raw.replace(/\s+/g, " ");

const problems: string[] = [];

// §30 — banned phrases must never appear anywhere in the rendered PDF.
const banned = findBannedPhrases(text);
if (banned.length > 0) {
  problems.push(`banned phrases (§30): ${banned.join("; ")}`);
}

// §16 — trend/comparison wording is only legal with prior-window data. Scan
// the ASSESSED PROSE only: source headlines and quoted incident summaries may
// legitimately contain words like "spreading" or "continues" — the §16 rule
// governs the engine's own analytical sentences, which live in the sections
// before the incident tables. We approximate that boundary by cutting the
// text at the incident-detail / situational-context headings when present.
if (!hasPriorData) {
  const CUT_MARKERS = [
    "INCIDENT DETAILS",
    "SITUATIONAL CONTEXT",
    "RELATED INCIDENTS",
  ];
  let proseText = text;
  let cutAt = -1;
  for (const m of CUT_MARKERS) {
    const idx = proseText.toUpperCase().indexOf(m);
    if (idx >= 0 && (cutAt < 0 || idx < cutAt)) cutAt = idx;
  }
  if (cutAt >= 0) proseText = proseText.slice(0, cutAt);
  const hits: string[] = [];
  for (const word of TREND_WORDS) {
    const re = new RegExp(
      `\\b${word.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`,
      "i",
    );
    if (re.test(proseText)) hits.push(word);
  }
  if (hits.length > 0) {
    problems.push(
      `trend wording without prior-window data (§16): ${hits.join("; ")}`,
    );
  }
}

if (problems.length > 0) {
  console.error(`FAIL ${name}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `PASS ${name}: no banned phrases${hasPriorData ? "" : ", no unsupported trend wording"}`,
);
