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
 * Tokens from a DIFFERENT country group that are a more specific super-phrase
 * of one of this report's own tokens — e.g. for the "papua" (West Papua)
 * report, PNG's "papua new guinea" (which contains the short "papua" token).
 *
 * When such a token appears in a free-text source/feed name, that source
 * belongs to the OTHER country, not this report. Callers that match source
 * names by substring/word use this to stop the short "papua" token leaking
 * Papua New Guinea sources into the Indonesian West Papua report (and vice
 * versa). Cross-border tokens shared by both groups are never disqualifying.
 */
export function competingSupersetTokens(reportName: string): string[] {
  const ownKey = (reportName ?? "").trim().toLowerCase();
  const own = acceptedCountryTokens(reportName);
  if (own.length === 0) return [];
  const ownSet = new Set(own);
  const out: string[] = [];
  for (const [groupKey, tokens] of Object.entries(COUNTRY_GROUPS)) {
    if (groupKey === ownKey) continue;
    for (const t of tokens) {
      if (ownSet.has(t)) continue; // shared / cross-border token — not disqualifying
      if (own.some((o) => t === o || t.includes(o))) out.push(t);
    }
  }
  return out;
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
  /\b(west papua|papua barat|west[- ]papua|jayapura|biak|wamena|manokwari|sorong|merauke|nabire|timika|fakfak|free west papua|opm|tpnpb|tni|indonesian|indonesia|intan jaya|bilogai|nduga|puncak jaya|paniai|ilaga|sugapa|yahukimo|dekai|kiwirok|maybrat|beoga|kenyam|mulia|damai cartenz|koops habema|kodam cenderawasih|lanny jaya|tolikara|pegunungan bintang|dogiyai|deiyai|mappi|keerom|sarmi|waropen|supiori|boven digoel)\b/i;

// Genuine Papua New Guinea markers (the state, its cities, provinces and
// institutions). If any of these appear, the record is directly relevant
// to PNG and must NOT be stripped as Indonesian West Papua noise.
// Kept in EXACT lockstep with PNG_MARKERS in lib/ingest/src/flashpoint.ts.
// Generic NCD homonyms (ncd, "national capital district", "nine mile"/"six
// mile", bare "gordon") are deliberately excluded here too.
const PNG_CONTEXT_RE =
  /\b(papua new guinea|png|port moresby|gerehu|boroko|waigani|hohola|erima|tokarara|korobosea|hanuabada|badili|bomana|gordons|koki|morata|kaugere|sabama|moresby|lae|taraka|mount hagen|mt hagen|bougainville|enga|hela|highlands highway|madang|morobe|kokopo|goroka|wewak|kimbe|tari|pngdf|rpngc|marape|bismarck archipelago)\b/i;

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

/**
 * Symmetric counterpart to {@link isIndonesianWestPapuaContext}: true when a
 * record's narrative is clearly about the independent state of Papua New Guinea
 * (Port Moresby, Lae, Morobe, Enga, MOMASE, PNG institutions) rather than
 * Indonesian Papua / West Papua. Used to keep genuinely-PNG items that carry a
 * stray "Papua" / "West Papua" country tag out of the Indonesian Papua country
 * report — the mirror of the West Papua strip the PNG report already applies,
 * so the Papua brief can never be framed as Papua New Guinea. Cross-border
 * records (handled by {@link isCrossBorderPapuaPng}) are exempted by the caller.
 */
export function isPapuaNewGuineaDominantContext(
  text: string | null | undefined,
): boolean {
  const t = text ?? "";
  return PNG_CONTEXT_RE.test(t) && !WEST_PAPUA_CONTEXT_RE.test(t);
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
  /\b(west papua|papua barat|jayapura|biak|wamena|manokwari|sorong|merauke|nabire|timika|fakfak|intan jaya|bilogai|nduga|puncak jaya|paniai|ilaga|sugapa|yahukimo|dekai|kiwirok|maybrat|beoga|kenyam|mulia|damai cartenz|koops habema|kodam cenderawasih|lanny jaya|tolikara|pegunungan bintang|dogiyai|deiyai|mappi|keerom|sarmi|waropen|supiori|boven digoel)\b/i;

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

/**
 * True when a record's narrative is about the Indonesian Papua theatre (the
 * Papua highlands separatist conflict, OPM / TPNPB, the Papuan provinces)
 * rather than the wider Indonesian operating picture. The Indonesia Operating
 * Risk Watch EXCLUDES these: Papua-related reporting belongs in the dedicated
 * Indonesian Papua (West Papua) brief, never the national report. Genuine
 * Papua New Guinea records (which also contain the "papua" substring inside
 * "Papua New Guinea") are exempt and stay in the PNG report. Unlike
 * {@link isIndonesianWestPapuaContext}, this never fires on the bare
 * "indonesia" / "indonesian" / "tni" tokens — so it cannot strip an ordinary
 * national-Indonesia story that merely names the state.
 */
export function isIndonesianPapuaTheatreContext(
  text: string | null | undefined,
): boolean {
  const t = text ?? "";
  if (PNG_CONTEXT_RE.test(t)) return false;
  // "papua", "papuan", "papuans" (the adjective form is common in headlines:
  // "Papuan separatists", "West Papuan rebels").
  return /\bpapuan?s?\b/i.test(t) || PAPUA_STRICT_LOCAL_RE.test(t);
}
