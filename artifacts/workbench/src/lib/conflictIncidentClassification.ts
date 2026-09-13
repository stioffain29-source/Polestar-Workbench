/**
 * Deterministic admission classes for Conflict Watch.
 *
 * Conflict relevance is intentionally broader than "a current incident": a
 * report about a historical toll, a minister's warning, or a peace-process
 * development can still be useful context.  Those records must not, however,
 * inflate the incident count or become the severity/latest/activity driver.
 *
 * Keep this classifier generic.  It is shared by the report dataset and the
 * true-incidents resolver, so neither surface gets to invent its own notion of
 * a current event.
 */

export const CONFLICT_INCIDENT_CLASSES = {
  CURRENT: "CURRENT INCIDENT",
  CONTEXT: "CONTEXT/BACKGROUND",
  OFFICIAL: "OFFICIAL STATEMENT",
  POLITICAL: "POLITICAL/STRATEGIC DEVELOPMENT",
} as const;

export type ConflictIncidentClass =
  (typeof CONFLICT_INCIDENT_CLASSES)[keyof typeof CONFLICT_INCIDENT_CLASSES];

export interface ConflictIncidentClassificationInput {
  title: string;
  summary?: string | null;
  displayTitle?: string | null;
}

function textOf(input: ConflictIncidentClassificationInput): string {
  return [input.title, input.displayTitle, input.summary]
    .filter((s): s is string => !!s)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOf(input: ConflictIncidentClassificationInput): string {
  return (input.displayTitle || input.title || "").replace(/\s+/g, " ").trim();
}

// A concrete occurrence, rather than a view about conflict.  This is
// deliberately phrased in terms of event verbs and casualties, not countries,
// dates, actors or particular headline templates.
const CURRENT_EVENT_RE =
  /\b(?:attack(?:s|ed|ing)?|ambush(?:es|ed|ing)?|airstrike(?:s|d)?|bomb(?:s|ed|ing)?|blast(?:s|ed|ing)?|explos(?:ion|ions|ive)|shoot(?:s|ing)?|shot\s+dead|gunfire|firefight|gunbattle|gunfight|clash(?:es|ed|ing)?|fight(?:s|ing)?|raid(?:s|ed|ing)?|assault(?:s|ed|ing)?|offensive|massacre(?:s|d)?|kill(?:s|ed|ing)?|slain|murder(?:s|ed|ing)?|wound(?:s|ed|ing)?|injur(?:y|ies|ed)|abduct(?:s|ed|ion|ions)?|kidnap(?:s|ped|ping)?|hostage(?:s)?|evacuat(?:e|ed|ion|ions)|displac(?:e|ed|ement)|repel(?:s|led|ling)?|retaliat(?:e|ed|ion)|seiz(?:e|ed|ure)|arrest(?:s|ed|ing)?|detain(?:s|ed|ing)?|surrender(?:s|ed|ing)?|capture(?:s|d|ing)?|incursion|burn(?:s|ed|ing)?\s+(?:down|out)?|destroy(?:s|ed|ing)?|demolish(?:es|ed|ing)?|(?:military|security|counterinsurgency)\s+operation(?:s)?)\b/i;
// Ordinary kinetic constructions that cannot be admitted through a bare
// "strike" token (which would re-admit labour action and political rhetoric).
const BOUNDED_KINETIC_EVENT_RE =
  /\b(?:(?:drone|missile|rocket|artillery|air)\s+strike(?:s|d)?|(?:artillery|mortar)\s+shell(?:s|ed|ing)?|(?:ied|improvised\s+explosive\s+device)\s+(?:detonat(?:e|es|ed|ing)|explod(?:e|es|ed|ing))|open(?:s|ed|ing)?\s+fire)\b/i;

// A reaction, report, or cumulative account that describes an earlier event.
// These checks run before CURRENT_EVENT_RE because context routinely repeats
// words such as "killed", "attack", and "massacre".
const CUMULATIVE_CONTEXT_RE =
  /\b(?:death|casualty|fatality)\s+toll\b[^.!?]{0,100}\b(?:rise|rose|risen|increas|reach|reached|climb|climbed|stand|stood|surviv|report)/i;
const HISTORICAL_CONTEXT_RE =
  /\b(?:histor(?:y|ical)|background(?:er)?|explainer|timeline|analysis|opinion|decades?\s*(?:long|of)|years?\s*(?:long|of)|months?\s*(?:long|of)|over\s+(?:the\s+)?(?:past|last)|since\s+(?:last|early|the)|in\s+the\s+(?:past|last)|long[-\s]?running|renewed\s+warfare|pattern\s+of|annual|commemorat|anniversary|memorial|vigil|mourn|condemn|demand(?:s|ed)?\s+justice|tribute|funeral|buried)\b/i;
const CUMULATIVE_NUMBER_RE =
  /\b(?:\d[\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|dozens?|scores?)\b[^.!?]{0,35}\b(?:killed|dead|deaths?|casualt(?:y|ies)|massacre(?:s)?|victims?)\b[^.!?]{0,70}\b(?:since|over|during|in the (?:past|last)|across)\b/i;
// Totals are also commonly written with the number first ("over 4,700
// militants killed in three years") or with the count after the victim noun
// ("militants killed 4,700 over three years"). Neither describes one current
// incident.
const CUMULATIVE_TOTAL_RE =
  /\b(?:over|more\s+than|at\s+least)\s+\d[\d,]*\b[^.!?]{0,120}\b(?:killed|dead|deaths?|casualt(?:y|ies)|victims?)\b[^.!?]{0,80}\b(?:in|over|across|during)\s+(?:the\s+)?(?:\d+\s+|one\s+|two\s+|three\s+|four\s+|five\s+|several\s+)?(?:years?|months?|decades?)\b|\b(?:killed|dead|deaths?|casualt(?:y|ies)|victims?)\b[^.!?]{0,60}\b\d[\d,]*\b[^.!?]{0,80}\b(?:in|over|across|during)\s+(?:the\s+)?(?:\d+\s+|one\s+|two\s+|three\s+|four\s+|five\s+|several\s+)?(?:years?|months?|decades?)\b/i;
const LARGE_AGGREGATE_CASUALTY_RE =
  /\b(?:\d{1,3}(?:,\d{3})+|\d{3,}|hundreds?|thousands?)\b[^.!?]{0,90}\b(?:killed|dead|deaths?|casualt(?:y|ies)|victims?)\b[^.!?]{0,100}\b(?:attacks?|clashes?|incidents?|operations?|battles?|violence|militant(?:\s+group)?s?)\b/i;
const THREAT_STATEMENT_RE =
  /\b(?:threat(?:en|ens|ened|ening)?|vow(?:s|ed|ing)?|warn(?:s|ed|ing)?|pledge(?:s|d|ing)?|promise(?:s|d|ing)?)\b[^.!?]{0,100}\b(?:attack(?:s|ed|ing)?|strike(?:s|d|ing)?|retaliat(?:e|ed|ion)|violence|revenge|war)\b/i;
const CONCRETE_PAST_EVENT_RE =
  /\b(?:kill(?:s|ed|ing)?|dead|wound(?:ed|ing)?|injur(?:y|ies|ed)|shot|blast(?:ed)?|explod(?:ed|es|ing)|struck|hit)\b/i;
const KINETIC_OVERRIDE_RE =
  /\b(?:attack(?:s|ed|ing)?|ambush(?:es|ed|ing)?|airstrike(?:s|d)?|bomb(?:s|ed|ing)?|blast(?:s|ed|ing)?|explos(?:ion|ions|ive)|shoot(?:s|ing)?|shot\s+dead|gunfire|firefight|gunbattle|gunfight|clash(?:es|ed|ing)?|raid(?:s|ed|ing)?|assault(?:s|ed|ing)?|massacre(?:s|d)?|kill(?:s|ed|ing)?|slain|murder(?:s|ed|ing)?|wound(?:s|ed|ing)?|injur(?:y|ies|ed)|abduct(?:s|ed|ion|ions)?|kidnap(?:s|ped|ping)?|hostage(?:s)?)\b/i;
const STRATEGIC_DEVELOPMENT_RE =
  /\b(?:surrender(?:s|ed|ing)?|lay(?:s|ing)?\s+down\s+arms?|disarm(?:s|ed|ing)?|demobil(?:is|iz)(?:e|es|ed|ing|ation)|decommission(?:s|ed|ing)?|reintegrat(?:e|ed|ion)|peace[-\s]?process|peace\s+talks?|dialogue|negotiat(?:e|ed|ing|ions?)|ceasefire|truce)\b/i;
const POLITICAL_RHETORIC_RE =
  /\b(?:say(?:s|ing)?|said|respond(?:s|ed|ing)?|accus(?:e|es|ed|ing)|slam(?:s|med|ming)?|jib(?:e|es|ed|ing)|remark(?:s|ed|ing)?|label(?:s|led|ling)?|call(?:s|ed|ing)?|alleg(?:e|es|ed|ing))\b/i;
const PHYSICAL_KINETIC_RE =
  /\b(?:attack(?:s|ed|ing)?|assault(?:s|ed|ing)?|raid(?:s|ed|ing)?|strike(?:s|d|ing)?|ambush(?:es|ed|ing)?|airstrike(?:s|d)?|bomb(?:s|ed|ing)?|blast(?:s|ed|ing)?|explos(?:ion|ions|ive)|shoot(?:s|ing)?|shot\s+dead|gunfire|firefight|gunbattle|gunfight|clash(?:es|ed|ing)?|kill(?:s|ed|ing)?|slain|wound(?:s|ed|ing)?|injur(?:y|ies|ed)|massacre(?:s|d)?)\b/i;

function withoutQuotedLabels(text: string): string {
  // A quoted label ("X attack") is not evidence that an attack occurred.
  // Publishers also put only the label in quotes and leave the rhetorical word
  // immediately after it ("'X' attack"). Remove both forms before looking for
  // physical evidence. This remains generic to any quoted slogan or label.
  return text.replace(
    /(?:"[^"]{1,160}"|“[^”]{1,160}”|‘[^’]{1,160}’|'[^']{1,160}')(?:\s+attack)?/gi,
    " ",
  );
}
// Relevance can (correctly) reject a bare official headline that lacks a
// kinetic verb. Keep an explicitly conflict-framed statement available as
// context, without admitting generic politics or unrelated government news.
const CONFLICT_CONTEXT_CUE_RE =
  /\b(?:armed|conflict|war|insurgenc\w*|militant\w*|insurgent\w*|terror\w*|extremis\w*|rebel\w*|separatist\w*|ceasefire|truce|frontline|troops?|army|military|security\s+forces?|border|encroach\w*|attack\w*|strike\w*|violence|clash\w*|hostage\w*|kidnap\w*|abduct\w*|surrender\w*|disarm\w*|demobil\w*|decommission\w*|peace[-\s]?process|peace\s+talks?|dialogue|negotiat\w*)\b/i;

// A stated position or a diplomatic/strategic move.  These are not made
// current merely by mentioning an armed actor or a conflict theatre.
const POLITICAL_RE =
  /\b(?:policy|policies|strategy|strategic|plan|plans|agreement|accord|treat(?:y|ies)|negotiat(?:e|ed|ing|ions?)|talks?|dialogue|peace\s+process|ceasefire|truce|diplomatic|diplomacy|sanction(?:s|ed|ing)?|bilateral|trilateral|cooperat(?:e|ion)|relations?|summit|conciliat(?:e|ion)|dispute|border\s+tension|maritime\s+security|military\s+buildup|arms?\s+deal|procure(?:s|d|ment)|purchas(?:e|ed|ing)|appoint(?:s|ed|ment)|election|legislation|reform|governance|sovereignty|investment|trade)\b/i;

const OFFICIAL_RE =
  /\b(?:official(?:s)?|government|ministr(?:y|ies)|president|prime\s+minister|premier|army|military|police|security\s+forces?|spokes(?:person|man|woman)|ambassador|court|authorit(?:y|ies))\b[^.!?]{0,80}\b(?:say(?:s|ing)?|said|warn(?:s|ed|ing)?|claim(?:s|ed|ing)?|den(?:y|ies|ied|ying)|condemn(?:s|ed|ing)?|urge(?:s|d|ing)?|call(?:s|ed|ing)?\s+for|announce(?:s|d|ment)?|insist(?:s|ed|ing)?|reaffirm(?:s|ed|ing)?|accuse(?:s|d|ing)?|reject(?:s|ed|ing)?)\b/i;
const STATEMENT_LEAD_RE =
  /^(?:official(?:s)?|government|ministr(?:y|ies)|president|prime\s+minister|premier|army|military|police|security\s+forces?|spokes(?:person|man|woman)|ambassador|court|authorit(?:y|ies)|[A-Z][\w.'’-]+)\b[^.!?]{0,55}\b(?:say(?:s|ing)?|said|warn(?:s|ed|ing)?|claim(?:s|ed|ing)?|condemn(?:s|ed|ing)?|urge(?:s|d|ing)?|call(?:s|ed|ing)?\s+for|announce(?:s|d|ment)?|insist(?:s|ed|ing)?|accuse(?:s|d|ing)?)\b/i;

/**
 * Classify a relevant conflict record before deduplication and metrics.
 *
 * The current class is intentionally conservative: a concrete event verb can
 * admit a row, but historical/cumulative and reaction framing wins first.
 */
export function classifyConflictIncident(
  input: ConflictIncidentClassificationInput,
): ConflictIncidentClass {
  const text = textOf(input);
  const title = titleOf(input);
  if (!text) return CONFLICT_INCIDENT_CLASSES.CONTEXT;

  // The headline is the strongest signal of what the record is reporting.
  // Article snippets often add background ("the conflict has a long history")
  // to an otherwise discrete attack; that background must not demote the
  // attack. Conversely, cumulative/historical framing in the headline wins
  // even when the snippet recounts the underlying violence.
  const titleIsContext =
    CUMULATIVE_CONTEXT_RE.test(title) ||
    HISTORICAL_CONTEXT_RE.test(title) ||
    CUMULATIVE_NUMBER_RE.test(title) ||
    CUMULATIVE_TOTAL_RE.test(title) ||
    LARGE_AGGREGATE_CASUALTY_RE.test(title);
  if (titleIsContext) return CONFLICT_INCIDENT_CLASSES.CONTEXT;
  if (
    POLITICAL_RHETORIC_RE.test(title) &&
    !PHYSICAL_KINETIC_RE.test(withoutQuotedLabels(title)) &&
    !BOUNDED_KINETIC_EVENT_RE.test(withoutQuotedLabels(title))
  ) {
    return CONFLICT_INCIDENT_CLASSES.POLITICAL;
  }
  if (THREAT_STATEMENT_RE.test(title) && !CONCRETE_PAST_EVENT_RE.test(title)) {
    return OFFICIAL_RE.test(title)
      ? CONFLICT_INCIDENT_CLASSES.OFFICIAL
      : CONFLICT_INCIDENT_CLASSES.CONTEXT;
  }
  if (
    STRATEGIC_DEVELOPMENT_RE.test(title) &&
    !KINETIC_OVERRIDE_RE.test(title) &&
    !BOUNDED_KINETIC_EVENT_RE.test(title)
  ) {
    return CONFLICT_INCIDENT_CLASSES.CONTEXT;
  }
  if (CURRENT_EVENT_RE.test(title) || BOUNDED_KINETIC_EVENT_RE.test(title)) {
    return CONFLICT_INCIDENT_CLASSES.CURRENT;
  }

  if (
    CUMULATIVE_CONTEXT_RE.test(text) ||
    HISTORICAL_CONTEXT_RE.test(text) ||
    CUMULATIVE_NUMBER_RE.test(text) ||
    CUMULATIVE_TOTAL_RE.test(text) ||
    LARGE_AGGREGATE_CASUALTY_RE.test(text)
  ) {
    return CONFLICT_INCIDENT_CLASSES.CONTEXT;
  }

  // A statement that only reports a position, warning, accusation, or denial
  // is not an incident. If it also states a concrete attack/casualty, retain
  // it as current event reporting ("army says militants killed five").
  if (
    STRATEGIC_DEVELOPMENT_RE.test(text) &&
    !KINETIC_OVERRIDE_RE.test(text) &&
    !BOUNDED_KINETIC_EVENT_RE.test(text)
  ) {
    return CONFLICT_INCIDENT_CLASSES.CONTEXT;
  }
  if (
    POLITICAL_RHETORIC_RE.test(text) &&
    !PHYSICAL_KINETIC_RE.test(withoutQuotedLabels(text)) &&
    !BOUNDED_KINETIC_EVENT_RE.test(withoutQuotedLabels(text))
  ) {
    return CONFLICT_INCIDENT_CLASSES.POLITICAL;
  }
  const hasCurrentEvent =
    CURRENT_EVENT_RE.test(text) || BOUNDED_KINETIC_EVENT_RE.test(text);
  if (hasCurrentEvent) return CONFLICT_INCIDENT_CLASSES.CURRENT;

  if (POLITICAL_RE.test(text)) return CONFLICT_INCIDENT_CLASSES.POLITICAL;
  if (OFFICIAL_RE.test(text) || STATEMENT_LEAD_RE.test(title)) {
    return CONFLICT_INCIDENT_CLASSES.OFFICIAL;
  }

  // Relevance may admit a sparse event headline without a standard English
  // verb. Treat it as context rather than allowing an unverified row to drive
  // the report's quantitative read.
  return CONFLICT_INCIDENT_CLASSES.CONTEXT;
}

export function isCurrentConflictIncident(
  input: ConflictIncidentClassificationInput,
): boolean {
  return classifyConflictIncident(input) === CONFLICT_INCIDENT_CLASSES.CURRENT;
}

/** True when a non-current row is explicitly conflict-framed context. */
export function isConflictContextCandidate(
  input: ConflictIncidentClassificationInput,
): boolean {
  return (
    !isCurrentConflictIncident(input) && CONFLICT_CONTEXT_CUE_RE.test(textOf(input))
  );
}