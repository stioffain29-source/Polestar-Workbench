// PNG (Papua New Guinea) display-layer severity correction.
//
// The stored `incidents.severity` for PNG is unreliable: the upstream ingest
// classifier rates violence-PREVENTION / aid / training / ceremonial PR items
// (e.g. "Community leaders trained to help stop sorcery violence", "Tribal
// foundation helped displaced SARV victims") as HIGH, while genuine crime
// ("Armed suspect shot during robbery") is rated LOW. That inversion makes the
// PNG brief read as hyperbole (asserting High-severity violence when the only
// High rows are assistance PR) and buries real crime.
//
// This is a NO-FABRICATION correction: it only ever DEMOTES clearly non-kinetic
// assistance/PR copy so it can no longer lead a security brief or raise the
// "reached High severity" prose flags. It never UP-rates anything (that would
// invent severity). The durable fix is the ingest severity classifier; this is
// the display-side hedge, gated to PNG only (via the config flag / call-site
// guard) so every other theatre is byte-identical.

const SEV_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};

// Assistance / prevention / ceremonial / development-PR lexicon. A hit here
// (with NO kinetic veto below) marks an item as non-kinetic wire copy.
const ASSISTANCE_LEXICON_RE =
  /\b(?:train(?:ed|ing)|workshop|awareness|help(?:ed|ing)|assist\w*|aid|relief|donat\w*|partnership|launch\w*|celebrat\w*|graduat\w*|handover|hand-over|commission\w*|outreach|scholarship|mentor\w*|goodwill)\b/i;

// Kinetic veto: perpetrator ACT verbs and violent-actor nouns only. If any of
// these appear, the item describes a real event and is NEVER demoted, even when
// the assistance lexicon also matches (e.g. "training camp attacked by
// gunmen"). Deliberately EXCLUDES victim-state nouns (violence, victims,
// displaced, injured) so "trained to stop sorcery violence" still demotes.
const KINETIC_ACT_RE =
  /\b(?:shot|shoot(?:ing)?|gunned|killed|kills|killing(?:s)?|murder\w*|massacre\w*|manslaughter|stabb(?:ed|ing)|attack(?:ed|ing|s)?|assault(?:ed|ing|s)?|robbed|robber(?:y|ies)|raid(?:ed|s)?|kidnap\w*|abduct\w*|hijack\w*|clash(?:ed|es)?|riot(?:ed|ing|s)?|torch(?:ed)?|ambush\w*|arson|bomb(?:ed|ing)?|storm(?:ed)?|hold-up|gunmen|gunman|militant\w*|insurgent\w*|raskol\w*|shootout|gunfire)\b/i;

// Explicit casualty COUNTS also veto (a bare victim noun does not, per above).
const CASUALTY_COUNT_RE =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|dozens?|several)\s+(?:dead|killed|injured|wounded|hurt|fatalit\w*|casualt\w*)\b/i;

// "held up" / "opened fire" as multi-word act phrases (word-boundary-safe).
const KINETIC_PHRASE_RE = /(?:held up|opened fire|armed men)/i;

// Prevention-context carve-out. A violent term that appears ONLY as the OBJECT
// of a prevention verb ("workshop to combat armed robbery", "training to prevent
// tribal fighting", "campaign against gun violence") is a PREVENTION programme,
// not a real event — yet the kinetic veto above would fire on the crime noun
// ("robbery", "fighting") and block demotion. This matches those prevention →
// violent-object spans so they can be stripped BEFORE the veto runs. Tightly
// bound: a small optional adjective set and a fixed crime-noun set, so militarised
// phrasing where the noun is NOT a prevention object ("combat troops killed",
// "attacked by gunmen") is left intact and still vetoes.
const PREVENTION_VERB =
  "(?:stop|prevent(?:ing)?|curb(?:ing)?|tackl(?:e|es|ing)|combat(?:s|ing|ting|ted)?|counter(?:s|ing)?|reduc(?:e|es|ing)|deter(?:s|ring|red)?|eradicat(?:e|es|ing)|clamp\\s+down\\s+on|crack\\s+down\\s+on|fight\\s+against|against)";
const PREVENTION_ADJ =
  "(?:armed|tribal|gang|gun|gender[-\\s]?based|domestic|sorcery|violent|ethnic|communal|family|street|petty|organis(?:e|ed)|organiz(?:e|ed)|sexual|drug|alcohol[-\\s]?related)";
const PREVENTION_OBJECT_NOUN =
  "(?:violence|robber(?:y|ies)|crimes?|killings?|murders?|manslaughter|fighting|attacks?|abuse|thefts?|assaults?|stabbings?|shootings?|lawlessness|banditry|kidnapp?ings?|abductions?|arson)";
const PREVENTION_CONTEXT_RE = new RegExp(
  `\\b${PREVENTION_VERB}\\s+(?:the\\s+|a\\s+)?(?:${PREVENTION_ADJ}\\s+){0,2}${PREVENTION_OBJECT_NOUN}\\b`,
  "gi",
);

/**
 * True when the incident is non-kinetic assistance / prevention / PR copy that
 * should not carry a severity above Low. Veto-guarded: any concrete kinetic act
 * (verb, violent actor, or explicit casualty count) returns false so genuine
 * events are never demoted. When unsure, returns false (do not demote).
 */
export function isNonKineticAssistanceItem(
  title: string | null | undefined,
  summary?: string | null,
): boolean {
  const text = `${title ?? ""} ${summary ?? ""}`;
  // Strip prevention → violent-object spans so the crime noun inside them cannot
  // trigger the kinetic veto. Demote-only: removing a veto can never RAISE
  // severity, and the item is still demoted only if the assistance lexicon (read
  // from the ORIGINAL text) also hits.
  const vetoText = text.replace(PREVENTION_CONTEXT_RE, " ");
  if (
    KINETIC_ACT_RE.test(vetoText) ||
    CASUALTY_COUNT_RE.test(vetoText) ||
    KINETIC_PHRASE_RE.test(vetoText)
  ) {
    return false;
  }
  return ASSISTANCE_LEXICON_RE.test(text);
}

/**
 * Cap a severity string at "low". Anything above Low collapses to "low";
 * Insignificant/Low and unknown values are returned unchanged (lower-cased).
 * NEVER raises severity.
 */
export function correctSeverity(sev: string | null | undefined): string {
  const s = (sev ?? "").toLowerCase();
  const rank = SEV_RANK[s] ?? 0;
  return rank > SEV_RANK.low ? "low" : s;
}

/**
 * Map a list of incident-like rows, demoting non-kinetic assistance items to
 * Low. Rows that are not assistance items (and rows whose severity is already
 * at or below Low) are returned by reference unchanged. Used at the PNG Fast
 * Facts / map call sites, which read RAW incidents rather than the corrected
 * report dataset.
 */
export function correctPngIncidentSeverities<
  T extends { title: string; summary?: string | null; severity: string },
>(items: T[]): T[] {
  return items.map((it) => {
    if (!isNonKineticAssistanceItem(it.title, it.summary)) return it;
    const corrected = correctSeverity(it.severity);
    if (corrected === (it.severity ?? "").toLowerCase()) return it;
    return { ...it, severity: corrected };
  });
}
