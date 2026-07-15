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
 * Tokens used to SCOPE a server-side superset pre-fetch for a country report
 * (the `countryLike` query param). Returns the country's own accepted tokens,
 * EXCEPT the Jakarta city brief: Jakarta records carry the country field
 * "Indonesia" (never "Jakarta") and the page matches them against the Indonesia
 * group, so the fetch must be scoped to the Indonesia tokens or the brief is
 * starved to zero. Each returned token is, by construction, an exact segment
 * that {@link incidentMatchesCountry} accepts, so a `country ILIKE %token%`
 * per token returns a guaranteed SUPERSET of the rows the page keeps — trimming
 * payload without touching the authoritative client-side country gate.
 */
export function countryFetchTokens(reportName: string): string[] {
  const tokens = acceptedCountryTokens(reportName);
  if (tokens.includes("jakarta")) return acceptedCountryTokens("indonesia");
  return tokens;
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

// ---------------------------------------------------------------------------
// Indonesia operating-risk foreign-subject guard
// ---------------------------------------------------------------------------
// The `indonesia_local` topic is fed by Bahasa-first Indonesian outlets that
// also cover OVERSEAS events (foreign earthquakes, foreign sport, foreign
// politics). The classifier files every such record under country="Indonesia",
// so the national / Jakarta operating-risk brief otherwise fills with foreign
// "slop": a flood of Japan/Venezuela/California earthquakes, a New York sports
// riot, a Japan-vs-Sweden match. These are only detectable in the ENGLISH
// translation (`ln`); the stored Bahasa title hides the foreign subject from
// the English excludes that run upstream.
const INDO_FOREIGN_SUBJECT_RE =
  /\b(japan|japanese|jepang|honshu|china|chinese|tiongkok|korea|korean|taiwan|hong kong|thailand|thai|vietnam|vietnamese|cambodia|laos|myanmar|burma|burmese|philippine|philippines|filipino|singapore|singapura|malaysia|malaysian|brunei|india|indian|pakistan|pakistani|bangladesh|nepal|sri lanka|sweden|swedish|swedia|norway|finland|denmark|germany|german|jerman|france|french|spain|spanish|italy|italian|portugal|netherlands|belanda|england|britain|british|united states|usa|america|american|amerika|new york|california|texas|florida|missouri|canada|canadian|mexico|brazil|argentina|venezuela|chile|peru|colombia|bolivia|australia|australian|new zealand|russia|russian|ukraine|israel|israeli|gaza|iran|iranian|iraq|syria|syrian|saudi|yemen|yaman|houthi|houthis|hodeidah|hudaydah|lebanon|egypt|turkey|nigeria|ethiopia|somalia|sudan|south africa|haiti|beijing|shanghai|guangzhou|shenzhen|chengdu|chongqing|wuhan|tianjin|macau|macao|saigon|ho chi minh|hanoi|da nang|bangkok|phuket|pattaya|chiang mai|manila|cebu|davao|quezon city|tokyo|osaka|kyoto|nagoya|yokohama|sapporo|fukuoka|seoul|busan|incheon|pyongyang|taipei|kaohsiung|mumbai|new delhi|delhi|kolkata|chennai|bengaluru|bangalore|hyderabad|ahmedabad|pune|karachi|lahore|islamabad|rawalpindi|dhaka|chittagong|kathmandu|colombo|phnom penh|vientiane|yangon|naypyidaw|mandalay|kuala lumpur|johor bahru|penang|moscow|kyiv|kiev|london|paris|berlin|madrid|rome|tehran|baghdad|jerusalem|tel aviv|riyadh|jeddah|dubai|abu dhabi|doha|istanbul|ankara|cairo|lagos|nairobi|johannesburg|cape town|sydney|melbourne|brisbane|perth|auckland|ubisoft|assassin'?s creed)\b/i;

// Indonesian domestic geography / nationality anchors. Their presence shows the
// record is genuinely about Indonesia even when a foreign country is also named
// (e.g. a foreign national involved in an Indonesian incident). Papua-theatre
// place names are DELIBERATELY absent — those records are routed to the
// dedicated West Papua brief by isIndonesianPapuaTheatreContext upstream.
const INDO_LOCAL_ANCHOR_RE =
  /\b(indonesia|indonesian|jakarta|surabaya|bandung|medan|semarang|makassar|palembang|depok|tangerang|bekasi|bogor|batam|pekanbaru|padang|malang|denpasar|bali|lombok|sumatra|sumatera|java|jawa|sulawesi|kalimantan|borneo|aceh|riau|lampung|yogyakarta|jogja|maluku|banten|cirebon|surakarta|manado|balikpapan|samarinda|pontianak|banjarmasin|jambi|bengkulu|gorontalo|kupang|labuan bajo|mataram|ambon|ternate)\b/i;

/**
 * True when an Indonesia-filed record is dominated by a FOREIGN subject and so
 * must not populate the Indonesia / Jakarta operating-risk brief. Pass the
 * translated `ln`/`displayTitle` + the original Bahasa title, but NOT the
 * summary: the foreign subject is only visible once translated, and the summary
 * carries the appended outlet masthead ("CNN Indonesia", "CNBC Indonesia")
 * whose "Indonesia" would be a FALSE local anchor that defeats the dominance
 * test. A foreign nationality named in passing must NOT drop a genuine domestic
 * story, so — exactly like the PNG / West Papua guard above — we decide by
 * SIGNAL DOMINANCE: drop only when foreign-country cue matches OUTNUMBER
 * Indonesian-place cue matches across the text (the same occurrence-count basis
 * the PNG/Papua guard uses). NOTE: a record whose translated title names no
 * country or foreign entity in any language (e.g. a bare "Plane crash kills 11"
 * syndicating a foreign crash) cannot be dropped here — inventing a foreign tag
 * from zero evidence would breach the no-fabrication rule.
 */
export function isForeignSubjectForIndonesia(
  text: string | null | undefined,
): boolean {
  const t = text ?? "";
  const foreignCount = countMatches(INDO_FOREIGN_SUBJECT_RE, t);
  if (foreignCount === 0) return false;
  return foreignCount > countMatches(INDO_LOCAL_ANCHOR_RE, t);
}

// ---------------------------------------------------------------------------
// Foreign maritime / conflict theatre guard
// ---------------------------------------------------------------------------
//
// The incidents feed cross-tags a single regional event onto EVERY nationality
// it names. The live example is the Strait of Hormuz / Persian Gulf war: a
// South-Korean-flagged tanker attacked in Hormuz is tagged "South Korea; Iran",
// India's diplomatic response to a Fujairah strike is tagged "India; Iran", and
// so on. Such a record did NOT happen in — and is not primarily about — the
// peripheral country; it happened in the Gulf. Under the aggressive country
// filter the report must show only incidents that happened in / are primarily
// about that country, so these belong only to the theatre's own littoral states
// (Iran, the UAE, Oman, ...), never South Korea / India / Japan / China.
//
// Mention-count and tag-order both FAIL here: the peripheral country is named
// most ("South Korea", "Korean vessel", "Seoul's stance") and is listed first,
// because the story is framed around its reaction. The reliable signal is
// GEOGRAPHY — the named theatre — so we strip a record from a report whose
// country is not a member of any theatre the record names.
type ForeignTheatre = { re: RegExp; members: ReadonlySet<string> };

const FOREIGN_THEATRES: readonly ForeignTheatre[] = [
  {
    // Persian Gulf / Strait of Hormuz / Gulf of Oman maritime theatre plus the
    // adjoining Bab-el-Mandeb / Gulf of Aden choke-points, and their named
    // ports and pipeline terminals. `members` must list EVERY littoral state of
    // any marker in `re` — otherwise that state's report wrongly drops its own
    // local incident. Persian Gulf / Hormuz littorals: Iran, Oman, the UAE,
    // Saudi Arabia, Qatar, Bahrain, Kuwait, Iraq. Bab-el-Mandeb / Gulf of Aden
    // littorals: Yemen, Djibouti, Somalia, Eritrea.
    re: /\b(strait of hormuz|hormuz|gulf of oman|persian gulf|arabian gulf|fujairah|habshan|bandar abbas|bab[- ]?el[- ]?mandeb|gulf of aden)\b/i,
    members: new Set([
      "iran",
      "oman",
      "united arab emirates",
      "uae",
      "saudi arabia",
      "qatar",
      "bahrain",
      "kuwait",
      "iraq",
      "yemen",
      "djibouti",
      "somalia",
      "eritrea",
    ]),
  },
];

/**
 * True when a record is anchored to a named foreign maritime / conflict theatre
 * that the report's country is NOT a member of. Such a record happened in that
 * theatre (e.g. the Strait of Hormuz), not in the report's country, and is only
 * cross-tagged onto a nationality it mentions — so it must be stripped from the
 * non-member country's report. The theatre's own littoral states (Iran, the
 * UAE, Oman, ...) keep it. Records that name no foreign theatre are unaffected,
 * so a genuinely domestic story is never dropped (no-fabrication: only strip
 * when the narrative positively places the event in a foreign theatre).
 */
export function isForeignTheatreContext(
  text: string | null | undefined,
  reportName: string,
): boolean {
  const t = text ?? "";
  if (!t) return false;
  const own = new Set(acceptedCountryTokens(reportName));
  // The report name may be an alias absent from the accepted-token set
  // (e.g. "UAE" vs "United Arab Emirates"); fold the raw key in too.
  const key = (reportName ?? "").trim().toLowerCase();
  if (key) own.add(key);
  for (const theatre of FOREIGN_THEATRES) {
    if (!theatre.re.test(t)) continue;
    let isMember = false;
    for (const tok of own) {
      if (theatre.members.has(tok)) {
        isMember = true;
        break;
      }
    }
    if (!isMember) return true;
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Foreign countries / capitals / non-state actors that, when named as the
// SUBJECT of a headline, signal the event happened ABROAD. Deliberately lists
// COUNTRY / place / actor nouns, NOT bare tourist-nationality adjectives
// (american / british / chinese / japanese), so a genuine LOCAL incident that
// merely involves a foreigner ("British tourist robbed") is never dropped. The
// ambiguous pronoun-like "us"/"usa" tokens are omitted for the same reason —
// a US-subject story reliably names a second anchor (Iran, Washington, …).
const FOREIGN_SUBJECT_RE =
  /\b(?:united states|u\.s\.a?\.|washington|iran|tehran|israel|gaza|west bank|hamas|hezbollah|hizbollah|houthi|ukraine|kyiv|kiev|russia|kremlin|moscow|china|beijing|north korea|pyongyang|south korea|seoul|japan|tokyo|india|new delhi|pakistan|islamabad|afghanistan|kabul|taliban|syria|iraq|baghdad|yemen|lebanon|beirut|egypt|cairo|turkey|t\u00fcrkiye|myanmar|burma|cambodia|phnom penh|laos|vientiane|vietnam|hanoi|malaysia|kuala lumpur|singapore|united kingdom|\buk\b|britain|london|france|paris|germany|berlin|venezuela|sudan|khartoum|nigeria|somalia|ethiopia)\b/i;

// Per-report HOME anchors: the country name, nationality, provinces and major
// cities. Their presence in a headline (or its translation) proves the story is
// domestic even when it also names a foreign country, so the drop is suppressed.
const LOCAL_ANCHORS: Record<string, RegExp> = {
  thailand:
    /\b(?:thailand|thai|bangkok|krung thep|chiang mai|chiang rai|phuket|pattaya|chonburi|nonthaburi|nakhon ratchasima|korat|khon kaen|udon thani|hat yai|songkhla|surat thani|ayutthaya|rayong|samut prakan|pathum thani|nakhon si thammarat|ubon ratchathani|isan|isaan|pattani|yala|narathiwat|hua hin|krabi|koh samui)\b/i,
  philippines:
    /\b(?:philippines?|filipin[oa]s?|manila|quezon city|cebu|davao|mindanao|luzon|visayas|makati|taguig|pasig|caloocan|zamboanga|cagayan|iloilo|bacolod|baguio|pampanga|batangas|cavite|laguna|bulacan|palawan|sulu|marawi|cotabato|general santos|tacloban|pangasinan)\b/i,
};

/**
 * True when a record should be stripped from a GENERIC country brief (one
 * without a bespoke branch — currently Thailand / Philippines) because its
 * TITLE names a foreign country / capital / non-state actor as the SUBJECT yet
 * the record carries NO home anchor at all: no home country / province / city
 * token in the title or its English translation, AND no resolved local
 * `location`. Such a record ("US launches new Iran strikes", "UK announces a
 * teen social-media curfew") was filed under this country only by a stray
 * free-text country tag; it is not a local incident. No-fabrication: the strip
 * fires only when the narrative POSITIVELY names a foreign subject and offers
 * zero domestic anchor, so a genuine local story is never removed.
 */
export function isForeignSubjectNoHomeAnchor(
  title: string | null | undefined,
  displayTitle: string | null | undefined,
  location: string | null | undefined,
  reportName: string,
): boolean {
  const rawTitle = title ?? "";
  if (!rawTitle.trim()) return false;
  // A resolved structured location is itself a home anchor: the geocoder fills
  // `location` only when it matched a place inside the report's own country.
  if ((location ?? "").trim()) return false;
  // Only strip when the TITLE positively names a foreign subject.
  if (!FOREIGN_SUBJECT_RE.test(rawTitle)) return false;
  const anchorHaystack = `${displayTitle ?? ""} ${rawTitle}`;
  const anchors = LOCAL_ANCHORS[(reportName ?? "").trim().toLowerCase()];
  if (anchors) {
    if (anchors.test(anchorHaystack)) return false;
  } else {
    // Generic fallback for any other future country: its own accepted tokens.
    const own = acceptedCountryTokens(reportName);
    if (own.length) {
      const ownRe = new RegExp(
        `\\b(?:${own.map(escapeRegExp).join("|")})\\b`,
        "i",
      );
      if (ownRe.test(anchorHaystack)) return false;
    }
  }
  return true;
}
