// Non-fresh "massacre" reference sanitizer.
//
// The reserved Extreme tier (and the "Homicide / violent crime" category rule)
// fire on the bare token "massacre". But news routinely mentions a massacre that
// is NOT a fresh mass-casualty event:
//   - a HISTORICAL / COMMEMORATIVE memory of a past atrocity
//     ("the Biak massacre is still a living collective memory", a massacre
//      anniversary, "decades after the … massacre");
//   - the AFTERMATH of a named past event, where the fresh subject is something
//     else ("Maguindanao massacre witness survives an ambush", "UN ramps up
//      assistance to survivors of the … massacre", "rights groups back a probe
//      into the … massacre", "no redress for … in the … massacre");
//   - a CULTURAL proper noun ("The Birthday Massacre", a band — "hits right
//      notes with 'Fascination'");
//   - a NEWS-DIGEST roundup lead that bundles unrelated stories
//     ("Afternoon Update: Papua New Guinea massacre; … forest protest arrest; …").
//
// Each of these wrongly painted an opinion / aftermath / culture item with the
// reserved subdued-red Extreme chip. This module strips ONLY those non-fresh
// massacre mentions (per occurrence) so the severity classifier and the category
// rulebook can re-test on the sanitized text. A genuine fresh massacre — one
// whose mention sits next to a casualty toll or a fatal verb ("Dozens of
// children killed in daycare massacre", "Thailand shooting: how the massacre
// unfolded", "the latest tribal massacre") — is left untouched and keeps its
// Extreme rating. Pure string -> string so both @workspace/ingest severity and
// structured-extract layers (and the one-time DB heal) share one definition.

// Historical / commemorative framing (English + Indonesian). A massacre near any
// of these reads as remembered history, not a fresh attack.
const HISTORICAL_CUE_RE =
  /(memor(?:y|ies|ial)|memori|kolektif|collective memory|anniversar|peringatan|mengenang|commemorat|in remembrance|trauma|sejarah|legac(?:y|ies)|decades?|years? ago|long ago|histor(?:y|ic|ical))/i;

// Aftermath / process framing — the fresh subject is the witness, survivor,
// probe, trial or redress, not a new killing.
const AFTERMATH_CUE_RE =
  /(witness|survivor|aftermath|probe|inquir|investigation|tribunal|trial|verdict|sentenc|convict|acquit|redress|justice|reparation|compensation|assistance to|ramps? up assistance)/i;

// Cultural proper-noun framing (band / album / film / review).
const CULTURE_CUE_RE =
  /(album|single|song|track|band|tour|concert|gig|review|fascination|soundtrack|record label|listen|movie|film|novel|book|video game|series|episode|hits right notes)/i;

// A FRESH mass-casualty signal adjacent to the massacre word — a fatal verb or a
// plausible body count (1-3 digits, NOT a 19xx/20xx year, or dozens/scores/
// hundreds). Its presence means the massacre reads as a real event, so it is
// KEPT regardless of any cue.
const FRESH_SIGNAL_RE =
  /\b(?:killed|kill|kills|killing|dead|deaths?|slain|gunned down|shot dead|fatalit(?:y|ies)?|massacred|dozens?|scores?|hundreds?|(?!(?:19|20)\d\d\b)\d{1,3})\b/i;

// News-digest / roundup lead: a multi-story bulletin where no single mention is
// the event itself. Anchored to the start of the (title) line.
const DIGEST_LEAD_RE =
  /^\s*[\w'’"().\-– ]{0,30}?(?:afternoon|morning|evening|weekend|midday|midweek|daily|weekly|nightly)\s+(?:update|briefing|wrap|digest|round[- ]?up|bulletin|news)\b/i;
const DIGEST_GENERIC_RE =
  /\b(?:news round[- ]?up|news digest|news wrap|in brief|news in brief|headlines today|daily briefing|live updates?)\b/i;

const MASSACRE_TOKEN_RE = /\bthe birthday massacre\b|\bmassacres?\b/gi;

/**
 * Remove non-fresh "massacre" mentions from `text`, leaving every genuine
 * fresh-event mention intact. Returns the text unchanged when it contains no
 * massacre token.
 */
export function stripNonFreshMassacreReferences(text: string): string {
  if (!/massacre/i.test(text)) return text;
  const firstLine = text.split("\n", 1)[0] ?? text;
  const digestLead = DIGEST_LEAD_RE.test(firstLine) || DIGEST_GENERIC_RE.test(text);
  return text.replace(MASSACRE_TOKEN_RE, (match: string, offset: number) => {
    // "The Birthday Massacre" is a band proper noun — never a security event.
    if (/^the birthday massacre$/i.test(match)) return " ";
    const win = text.slice(Math.max(0, offset - 80), offset + match.length + 80);
    // A fresh toll / fatal verb beside the word means a real massacre — keep it.
    if (FRESH_SIGNAL_RE.test(win)) return match;
    if (
      HISTORICAL_CUE_RE.test(win) ||
      AFTERMATH_CUE_RE.test(win) ||
      CULTURE_CUE_RE.test(win) ||
      digestLead
    )
      return " ";
    return match;
  });
}
