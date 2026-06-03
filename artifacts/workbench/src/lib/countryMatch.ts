// Country matching for the Country Report builder.
//
// The incidents feed stores `country` as a free-text, semicolon-separated
// list (e.g. "Papua New Guinea", "West Papua; Papua New Guinea",
// "United Arab Emirates; Iran"). A plain equality match misses compound
// tags and — worse for the Papua/PNG pair — a substring match would let
// "Papua New Guinea" leak into the Indonesian "Papua" report and vice
// versa. This module resolves a report's canonical country name to the
// set of acceptable country *tokens* and matches an incident only when
// one of its tokens is an exact (case-insensitive) member of that set.
//
// A record tagged with tokens from both groups (e.g. "West Papua; Papua
// New Guinea") is genuinely cross-border and is intentionally included in
// both reports. Single-group records never cross over.

// Canonical report name -> accepted country tokens. Names not listed here
// default to a single-token group of their own name, which still picks up
// compound tags (e.g. the UAE report matches "United Arab Emirates; Iran").
const COUNTRY_GROUPS: Record<string, string[]> = {
  "papua new guinea": ["papua new guinea", "png"],
  papua: [
    "papua",
    "west papua",
    "papua barat",
    "highland papua",
    "papua pegunungan",
    "central papua",
    "papua tengah",
    "south papua",
    "papua selatan",
    "southwest papua",
    "papua barat daya",
  ],
};

/** Split a free-text country field into normalised, lower-cased tokens. */
function countryTokens(field: string | null | undefined): string[] {
  if (!field) return [];
  return field
    .split(";")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** Accepted country tokens for a given report name. */
export function acceptedCountryTokens(reportName: string): string[] {
  const key = (reportName ?? "").trim().toLowerCase();
  return COUNTRY_GROUPS[key] ?? (key ? [key] : []);
}

/**
 * True when an incident's `country` field contains at least one token that
 * is an exact member of the report's accepted-token set. Cross-border
 * records (tokens from more than one group) match every group they touch.
 */
export function incidentMatchesCountry(
  incidentCountry: string | null | undefined,
  reportName: string,
): boolean {
  const accepted = acceptedCountryTokens(reportName);
  if (accepted.length === 0) return false;
  const acceptedSet = new Set(accepted);
  return countryTokens(incidentCountry).some((t) => acceptedSet.has(t));
}

// Indonesian West Papua context markers (provinces, cities, Indonesian
// state/security actors, and the RNZ "pacific_west-papua" feed path).
const WEST_PAPUA_CONTEXT_RE =
  /\b(west papua|papua barat|west[- ]papua|jayapura|biak|wamena|manokwari|sorong|merauke|nabire|timika|fakfak|free west papua|opm|tni|indonesian|indonesia)\b/i;

// Genuine Papua New Guinea markers (the state, its cities, provinces and
// institutions). If any of these appear, the record is directly relevant
// to PNG and must NOT be stripped as Indonesian West Papua noise.
const PNG_CONTEXT_RE =
  /\b(papua new guinea|png|port moresby|lae|mount hagen|mt hagen|bougainville|enga|hela|highlands highway|madang|morobe|kokopo|goroka|wewak|kimbe|tari|pngdf|rpngc|marape|bismarck archipelago)\b/i;

/**
 * True when a record's narrative is clearly about Indonesian West Papua
 * rather than the independent state of Papua New Guinea. Used to keep
 * mis-tagged West Papua items (e.g. RNZ "pacific_west-papua" stories that
 * carry a stray "Papua New Guinea" country tag) out of the PNG country
 * report, per the standing rule that Indonesian Papua / West Papua records
 * must not populate PNG unless they are explicitly cross-border or
 * directly PNG-relevant.
 */
export function isIndonesianWestPapuaContext(
  text: string | null | undefined,
): boolean {
  const t = text ?? "";
  return WEST_PAPUA_CONTEXT_RE.test(t) && !PNG_CONTEXT_RE.test(t);
}

// Distant foreign countries / nationalities / conflict theatres. When one of
// these dominates a record's TITLE the article is about that country, not the
// report's. Indonesia / West Papua are deliberately ABSENT — they are handled
// by the dedicated cross-border West Papua guard above.
const FOREIGN_TITLE_COUNTRY_RE =
  /\b(myanmar|burma|burmese|thai|thailand|vietnam|vietnamese|cambodia|cambodian|laos|\blao\b|china|chinese|\bindia\b|indian|philippine|philippines|filipino|malaysia|malaysian|brunei|bangladesh|pakistan|pakistani|nepal|sri lanka|\bjapan\b|japanese|korea|korean|taiwan|hong kong|ukraine|russia|russian|israel|israeli|gaza|\biran\b|iranian|iraq|syria|syrian|afghanistan|yemen|lebanon|sudan|nigeria|ethiopia|somalia|venezuela|haiti)\b/i;

// STRICT Papua New Guinea markers — proper nouns unlikely to appear as a
// substring of foreign place names. Deliberately EXCLUDES short / ambiguous
// city tokens like "lae" (which matches inside "Thicha Lae camp", the exact
// geocoder mis-tag that wrongly filed a Myanmar story under PNG).
const PNG_STRICT_LOCAL_RE =
  /\b(papua new guinea|png|port moresby|bougainville|pngdf|rpngc|marape|national capital district)\b/i;

// STRICT Indonesian Papua markers (province capitals and proper nouns).
const PAPUA_STRICT_LOCAL_RE =
  /\b(west papua|papua barat|jayapura|biak|wamena|manokwari|sorong|merauke|nabire|timika|fakfak)\b/i;

/** Count the non-overlapping matches of a regex in a string. */
function countMatches(re: RegExp, text: string): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return (text.match(g) ?? []).length;
}

/**
 * True when a record is clearly about a DISTANT foreign country and is only
 * filed under the report's country by a geocoder mis-tag — e.g. a
 * Myanmar/Thailand conflict story filed under PNG because the city substring
 * "Lae" matched "Thicha Lae camp". Only applies to the two existing country
 * reports (Papua New Guinea, Indonesian Papua).
 *
 * A foreign nationality alone must NOT drop a genuine local incident (e.g.
 * "Chinese investor robbed in Lae market"), so once a record is foreign-flagged
 * we decide by SIGNAL DOMINANCE, not mere presence:
 *   - an unambiguous STRICT local proper noun (e.g. "Port Moresby") always
 *     rescues the record outright; otherwise
 *   - we drop it only when distinct foreign cues OUTNUMBER local-context cues
 *     across the narrative. The Myanmar story is saturated with foreign cues
 *     (Myanmar, Thai, Thailand, ...) against a single stray "Lae"; the Lae
 *     robbery has one foreign nationality against >=1 local cue, so it stays.
 */
export function isForeignDominantContext(
  title: string | null | undefined,
  fullText: string | null | undefined,
  incidentCountry: string | null | undefined,
  reportName: string,
): boolean {
  // A record is foreign-flagged when a distant country is named in its TITLE
  // (e.g. "Myanmar clashes ... near Thai border") OR carried in its stored
  // `country` field (e.g. "Pakistan; Papua New Guinea", where the headline
  // never names Pakistan but the classifier tagged it).
  const foreignFlagged =
    FOREIGN_TITLE_COUNTRY_RE.test(title ?? "") ||
    FOREIGN_TITLE_COUNTRY_RE.test(incidentCountry ?? "");
  if (!foreignFlagged) return false;
  const key = (reportName ?? "").trim().toLowerCase();
  // Narrative only — the stored `country` field literally contains the report's
  // own country for these mis-tags and would otherwise rescue them. The country
  // field is folded into the FOREIGN count only (never the local count).
  const narrative = `${title ?? ""} ${fullText ?? ""}`;
  const foreignCount = countMatches(FOREIGN_TITLE_COUNTRY_RE, `${narrative} ${incidentCountry ?? ""}`);

  if (key.includes("new guinea")) {
    if (PNG_STRICT_LOCAL_RE.test(narrative)) return false;
    return foreignCount > countMatches(PNG_CONTEXT_RE, narrative);
  }
  if (key === "papua" || key.includes("west papua")) {
    if (PAPUA_STRICT_LOCAL_RE.test(narrative)) return false;
    return foreignCount > countMatches(WEST_PAPUA_CONTEXT_RE, narrative);
  }
  return false;
}

const PNG_TOKEN_SET = new Set(COUNTRY_GROUPS["papua new guinea"]);
const PAPUA_TOKEN_SET = new Set(COUNTRY_GROUPS["papua"]);

/**
 * True when an incident's `country` field explicitly spans both the Papua
 * New Guinea group and the Indonesian Papua group (e.g.
 * "West Papua; Papua New Guinea"). Such records are genuinely cross-border
 * and must NOT be stripped from the PNG report by the West Papua content
 * guard, per the standing "unless explicitly cross-border" exception.
 */
export function isCrossBorderPapuaPng(
  incidentCountry: string | null | undefined,
): boolean {
  const toks = countryTokens(incidentCountry);
  return (
    toks.some((t) => PNG_TOKEN_SET.has(t)) &&
    toks.some((t) => PAPUA_TOKEN_SET.has(t))
  );
}
