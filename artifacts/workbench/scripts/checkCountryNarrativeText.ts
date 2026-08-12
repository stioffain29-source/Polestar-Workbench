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
import { TREND_WORDS, CATEGORY_IMPLICATIONS } from "@workspace/country-engine/narrative";

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

// Boilerplate-repetition gate (owner-flagged defect class, 28 Jul 2026): any
// full assessed sentence that appears VERBATIM more than once in the rendered
// PDF is boilerplate, not analysis. Scope: the engine's own derived-implication
// sentences ("For operators, ..."), which are the known repeat vector. A single
// occurrence is legal; two or more identical copies fail the sweep.
// Each regex names one known assessed-sentence family that has repeated
// verbatim in shipped output; any family sentence appearing more than once
// fails. (A blanket any-sentence scan would false-positive on legitimately
// repeated table actions, so the gate is family-scoped and grows as defect
// classes are caught.)
const BOILERPLATE_FAMILIES: RegExp[] = [
  /For operators,[^.]*\./g,
  /Reporting of this activity[^.]*\./g,
  /Against the previous week[^.]*\./g,
  /Week on week,[^.]*\./g,
  /Reporting volume [^.]*\./g,
  /Reporting this period reached[^.]*\./g,
  /The most serious of this reporting[^.]*\./g,
  /Validated reporting [^.]*\./g,
  /Reporting under this theme [^.]*\./g,
  /The previous week saw[^.]*\./g,
  /Compared with the week before[^.]*\./g,
  /This period carried [^.]*\./g,
  /At its worst this reporting[^.]*\./g,
  /The worst item under this theme[^.]*\./g,
  /This theme produced [^.]*\./g,
  /Severity under this theme[^.]*\./g,
  /The heaviest reporting under this theme[^.]*\./g,
  /This activity (?:drew|ran|was|had)[^.]*\./g,
  /This theme (?:drew|ran|was|is|gained|lost)[^.]*\./g,
  /Reporting places this event[^.]*\./g,
  /Escalation trigger[^.]*\./g,
];
// pdftotext wraps lines mid-sentence, so two identical sentences can differ
// only by where the line break falls — normalise ALL whitespace to single
// spaces before matching or verbatim repeats slip past the gate.
const flatText = text.replace(/\s+/g, " ");
const sentenceCounts = new Map<string, number>();
for (const family of BOILERPLATE_FAMILIES) {
  for (const m of flatText.match(family) ?? []) {
    const key = m.trim();
    sentenceCounts.set(key, (sentenceCounts.get(key) ?? 0) + 1);
  }
}
// Cross-framing repeat: the same category-implication CLAUSE can be wrapped in
// two different sentence frames ("For operators, an event of this kind ..."
// in Top 3 vs "For operations, the immediate significance is that the lead
// event ..." in the BLUF), so exact-sentence counting above cannot see it.
// Count each implication clause directly — one appearance is legal, two is
// the same boilerplate a few lines apart (12 Aug 2026 defect).
for (const clause of Object.values(CATEGORY_IMPLICATIONS)) {
  const n = flatText.split(clause).length - 1;
  if (n > 1) sentenceCounts.set(`…${clause}…`, n);
}
const repeated = [...sentenceCounts.entries()].filter(([, n]) => n > 1);
if (repeated.length > 0) {
  problems.push(
    `repeated boilerplate sentence(s): ${repeated
      .map(([s, n]) => `"${s}" x${n}`)
      .join("; ")}`,
  );
}

if (problems.length > 0) {
  console.error(`FAIL ${name}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `PASS ${name}: no banned phrases${hasPriorData ? "" : ", no unsupported trend wording"}`,
);
