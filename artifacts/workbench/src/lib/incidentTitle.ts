// Browser-safe mirror of the ingest title-translation DETECTION predicate.
//
// The authoritative copy lives in `lib/ingest/src/titleTranslate.ts`
// (`needsTitleTranslation`, `NON_LATIN_RANGES`, `INDONESIAN_MARKER_WORDS`). That
// module imports `@workspace/db` and the OpenAI client, so it cannot be pulled
// into the browser bundle. This file re-implements ONLY the pure, dependency-free
// detection half so the workbench can fail closed if a foreign-language
// headline reaches a presentation boundary without a usable `display_title`.
//
// SYNC CONTRACT: if you change the non-Latin ranges or the Indonesian marker list
// in `lib/ingest/src/titleTranslate.ts`, mirror the change here (and vice versa),
// or the client-side fail-closed check will drift from what ingest actually
// rewrites. Keep the two constant blocks identical.

// Unicode ranges that are unambiguously non-English script: Cyrillic, Arabic,
// Thai, Hiragana, Katakana, CJK, Hangul. Mirror of NON_LATIN_RANGES.
const NON_LATIN_RANGES: ReadonlyArray<readonly [string, string]> = [
  ["\u0400", "\u04FF"], // Cyrillic
  ["\u0600", "\u06FF"], // Arabic
  ["\u0E00", "\u0E7F"], // Thai
  ["\u3040", "\u30FF"], // Hiragana + Katakana
  ["\u3400", "\u9FFF"], // CJK Unified Ideographs
  ["\uAC00", "\uD7AF"], // Hangul
];

const NON_LATIN_CLASS = NON_LATIN_RANGES.map(([a, b]) => `${a}-${b}`).join("");

// Bahasa Indonesia / Malay is Latin-script and ASCII, so script detection alone
// misses it. Mirror of INDONESIAN_MARKER_WORDS — distinctly Indonesian words that
// are rare-to-absent in English headlines.
const INDONESIAN_MARKER_WORDS: readonly string[] = [
  "yang", "dengan", "untuk", "tidak", "telah", "sudah", "adalah", "menjadi",
  "terhadap", "kepada", "diduga", "ditangkap", "tewas", "korban", "warga",
  "polisi", "aparat", "aksi", "wilayah", "kabupaten", "provinsi", "kembali",
  "terkait", "buntut", "imbas", "ratusan", "ribuan", "puluhan", "karena",
  "hingga", "pekan",
  "konflik", "bersenjata", "senjata", "negara", "pemerintah", "keamanan",
  "pasukan", "serangan", "penyerangan", "penembakan", "ditembak", "kekerasan",
  "pembunuhan", "menewaskan", "peneliti", "menjelaskan", "rekomendasikan",
  "situasi", "masyarakat", "dilaporkan", "anggota", "pernah",
  "pergeseran", "adat", "budaya", "umumkan", "mengumumkan",
  "duka", "nasional", "gugur", "gugurnya",
  "demonstrasi", "unjuk", "kerusuhan", "bentrok", "rusuh", "ricuh",
  "kericuhan", "mahasiswa", "menuntut", "tuntut", "penghasutan",
  "menggeruduk", "geruduk",
  "kebakaran", "terbakar", "karhutla", "hangus", "kobaran",
  "banjir", "bandang", "gempa", "longsor", "bencana", "mengungsi",
  "pengungsi", "erupsi", "letusan",
  "kabut", "polusi", "pencemaran", "limbah",
  "mogok", "buruh", "pekerja", "upah", "serikat", "pesangon", "pemecatan",
  "teroris", "ledakan", "peledakan", "densus", "bunuh",
  "pencurian", "perampokan", "begal", "pembegalan", "maling", "penipuan",
  "narkoba", "tersangka", "pelaku", "penganiayaan", "pencabulan",
  "kecelakaan", "tabrakan", "tergelincir", "pelabuhan", "bandara",
  "pesawat", "kapal",
  "menteri", "pejabat", "presiden", "kabinet", "korupsi", "pencegahan",
  "sidang", "penjara", "vonis", "terdakwa", "kasus", "dugaan", "suap",
  "perkara", "penahanan", "geledah", "hakim", "kejaksaan", "penyidik",
  "saksi", "tahun", "miliar", "rupiah",
  "tembak", "menembak", "penembak", "tertembak",
  "tangkap", "menangkap", "penangkapan", "tertangkap",
  "prajurit", "satgas", "jenazah",
  "evakuasi", "dievakuasi", "mengevakuasi",
  "sindikat", "desak", "mendesak", "asing",
  "sakiti", "menyakiti", "terbang", "penerbangan",
  "langgar", "larangan", "berhasil", "ketinggian",
];

const NON_LATIN_RE = new RegExp(`[${NON_LATIN_CLASS}]`);
const INDONESIAN_RE = new RegExp(`\\b(${INDONESIAN_MARKER_WORDS.join("|")})\\b`, "i");

/**
 * True when a title is non-English. Mirror of ingest `needsTitleTranslation`.
 */
export function isLikelyNonEnglish(title?: string | null): boolean {
  const t = (title ?? "").trim();
  if (t.length < 3) return false;
  return NON_LATIN_RE.test(t) || INDONESIAN_RE.test(t);
}

/**
 * True when an incident has no usable English `displayTitle` and its raw title
 * is non-English. Normal API reads exclude these rows; this is defense in depth
 * for locally assembled or stale data.
 */
export function isUntranslatedTitle(
  title?: string | null,
  displayTitle?: string | null,
): boolean {
  const display = (displayTitle ?? "").trim();
  // A usable English display title was produced — nothing to flag.
  if (display && !isLikelyNonEnglish(display)) return false;
  return isLikelyNonEnglish(title);
}

/**
 * The headline to render: the English `displayTitle` when present. English raw
 * titles remain a safe fallback. A detected foreign-language raw title fails
 * closed with an empty value; normal API reads exclude the entire row.
 */
export function displayIncidentTitle(
  title?: string | null,
  displayTitle?: string | null,
): string {
  const display = (displayTitle ?? "").trim();
  if (display) return cleanIncidentTitle(display);
  const raw = (title ?? "").trim();
  return isLikelyNonEnglish(raw) ? "" : cleanIncidentTitle(raw);
}

// A title is the one piece of incident text that is rendered in every client
// surface. Keep this deliberately mechanical: remove feed/social packaging,
// not facts (actors, places, actions, dates, or numbers). `rawTitle` remains
// the immutable source headline and `source`/`sourceUrl` remain the attribution
// fields; this function only prepares the client-facing copy.
export function cleanIncidentTitle(title: string): string {
  let t = (title ?? "").trim();
  if (!t) return "";

  // Publisher / aggregator framing is navigation, not the event. Keep this
  // source-shaped and conservative: known outlet tails and explicit menu
  // prefixes are removed, while an ordinary "headline - clause" remains.
  t = t.replace(/^[\w.]+\s*scoops?\s*[\u00bb\u203a>]\s*/i, "").trim();
  const outletTail =
    /\s+[-\u2013|»\u203a]\s+(?:the\s+)?(?:[A-Z0-9][\w.'&-]*\s+){0,8}(?:news|times|post|herald|gazette|telegraph|tribune|journal|standard|observer|guardian|broadcast(?:ing)?|corporation|corp|scoops?|\.com|\.net|\.org|abc|bbc|reuters|afp)\b[^-]*$/i;
  for (let i = 0; i < 8; i++) {
    const next = t.replace(outletTail, "").trim();
    if (next === t) break;
    t = next;
  }

  // A feed occasionally puts the article URL in the headline itself. Remove
  // protocol/www links, including truncated links ending in an ellipsis. The
  // URL's query string is therefore removed with it, while a normal sentence
  // containing '?' is retained.
  t = t
    .replace(/(?:https?:\/\/|www\.)[^\s<>"'“”‘’]+/gi, "")
    .replace(/(?:^|\s)[\w.-]+\.(?:com|net|org|io|co|ly)(?:[/?#]\S*)?/gi, " ")
    .replace(
      /[?&](?:utm_[a-z0-9_]+|fbclid|gclid|dclid|mc_cid|mc_eid|oc)=[^\s&#]+/gi,
      "",
    );

  // Social captions append calls to action that are not part of the event
  // headline. Keep this end-anchored so "comment", "follow", or "link" in a
  // factual sentence cannot be mistaken for boilerplate.
  t = t
    .replace(
      /\s*(?:[|:\u2013\u2014-]\s*)?(?:read\s+more|read|see|view|full\s+story|more\s+details?|details?|link)\s+(?:the\s+)?(?:link\s+)?in\s+(?:the\s+)?comments?\b[\s\S]*$/i,
      "",
    )
    .replace(
      /\s*(?:[|:\u2013\u2014-]\s*)?(?:link|full\s+story|more\s+details?)\s+in\s+(?:the\s+)?bio\b[\s\S]*$/i,
      "",
    )
    .replace(
      /\s*(?:[|:\u2013\u2014-]\s*)?(?:click|tap)\s+(?:the\s+)?link\b[\s\S]*$/i,
      "",
    )
    .replace(
      /\s*(?:[|:\u2013\u2014-]\s*)?(?:follow|subscribe)\s+(?:us\s+)?(?:for|to)\b[\s\S]*$/i,
      "",
    )
    .replace(
      /\s*(?:[|:\u2013\u2014-]\s*)?(?:share|retweet|repost)\s+(?:this|the\s+post)\b[\s\S]*$/i,
      "",
    );

  // Leading social-post labels. Requiring a separator means factual copy such
  // as "Watch groups protest" and "Update on the strike" is not rewritten.
  t = t.replace(
    /^\s*(?:breaking(?:\s+news)?|developing|just\s+in|update|latest|live|thread|rt|repost|fyi|icymi|must[- ]?watch|watch\s+now|watch|exclusive\s+video|video\s+exclusive|video)\s*[:|-\u2013\u2014]\s*/i,
    "",
  );

  // Hashtags are distribution metadata, not incident facts. Remove the tag
  // token rather than its word from ordinary prose.
  t = t.replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, "$1");

  // Navigation fragments commonly survive RSS extraction ("Home > News >"
  // and "| Latest News"). Only remove known navigation labels; a real
  // publisher, place, or event name is left alone.
  t = t
    .replace(
      /^\s*(?:(?:home|homepage|news|latest|latest\s+news|world|world\s+news|politics|video|menu)\s*(?:[|>\/\u00bb\u203a]\s*)?){2,}/i,
      "",
    )
    .replace(
      /\s*(?:[|]\s*)(?:home|homepage|news|latest(?:\s+news)?|world(?:\s+news)?|politics|video|menu|subscribe|sign\s+in|search|account|contact|about|privacy|terms|comments?|share)(?:\s*[|]\s*(?:home|homepage|news|latest(?:\s+news)?|world(?:\s+news)?|politics|video|menu|subscribe|sign\s+in|search|account|contact|about|privacy|terms|comments?|share))*\s*$/i,
      "",
    );

  // The final short segment of a Google-News style title is often the
  // publisher name ("… | Example News" or "… - Example.com"). This mirrors
  // the legacy Flashpoint masthead handling, now shared by every topic.
  for (let i = 0; i < 5; i++) {
    const m = t.match(/^(.*\S)\s+[-|»\u203a]\s+(.+)$/);
    if (!m) break;
    const head = m[1].trim();
    const tail = m[2].trim();
    if (tail.split(/\s+/).length > 6 || head.split(/\s+/).length < 2) break;
    if (!/(?:news|times|post|herald|gazette|telegraph|tribune|journal|standard|observer|guardian|broadcast|corporation|corp|scoop|\.com\b|\.net\b|\.org\b|abc\b|bbc\b|reuters\b|afp\b)/i.test(tail)) break;
    t = head;
  }
  const pipeParts = t.split(/\s+\|\s+/);
  if (
    pipeParts.length > 1 &&
    pipeParts[0]!.split(/\s+/).length >= 2 &&
    pipeParts.slice(1).every((part) =>
      /^(?:home|news|latest(?:\s+news)?|world|politics|video|menu|section|opinion|sports?|pro\s+sports|business|subscribe|comments?|share|[\w.-]+\.(?:com|net|org|io|co|ly))$/i.test(part.trim()),
    )
  ) {
    t = pipeParts[0]!.trim();
  }

  // A broken source adapter can prepend the same source twice. Drop the
  // duplicated pair; attribution is retained in the separate source fields.
  for (let i = 0; i < 3; i++) {
    const duplicate = t.match(
      /^\s*(.{2,60}?)\s*(?::|\||\s[-\u2013\u2014]\s)\s*\1\s*(?::|\||\s[-\u2013\u2014]\s)\s*/i,
    );
    if (!duplicate) break;
    t = t.slice(duplicate[0].length).trim();
  }

  return stripWireCruft(t
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s|:;\-,\u2013\u2014]+|[\s|:;\-,\u2013\u2014]+$/g, "")
    .trim());
}

// Wire / social headlines carry video call-to-action cruft that is meaningless
// in a static report ("Watch: ...", "... VIDEO BY <credit>", "... (VIDEO)") and
// also breaks dedupe — a "Watch:" copy and a plain copy of the SAME event
// produce different keys, so the same event survives twice. Strip it for BOTH
// the rendered title and the dedup signature. Conservative: a leading keyword is
// only removed when a separator (": - | —") follows it, so a real headline such
// as "Watch out for protests" is never touched.
//
// This is the SINGLE shared copy. Every report topic (flashpoint, shipping,
// cargo, fuel, conflict, country) cleans titles through THIS function so the
// behaviour — and the preview/PDF parity it guarantees — never drifts between
// surfaces. The regression suite is __tests__/workbench/incidentTitleClean.test.ts
// (cross-topic) and __tests__/workbench/flashpointTitleClean.test.ts.
export function stripWireCruft(title: string): string {
  let t = (title ?? "").trim();
  // Trailing "VIDEO BY <credit>" attribution (publisher already peeled off).
  // Case-sensitive: a capitalised "VIDEO"/"Video" followed by "BY"/"by" and a
  // capitalised credit name (1-5 tokens) running to the END. This strips a real
  // credit ("VIDEO BY ALLEN LIMOS", "Video by Allen Limos") but leaves lowercase
  // prose ("...video by citizen journalist goes viral") and a sentence-start
  // "Video by far the biggest protest" untouched — no-fabrication safe.
  t = t
    .replace(
      /\s*(?:[-\u2013\u2014|(\[]\s*)?(?:VIDEO|Video)\s+(?:BY|by)\s+[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,4}\s*$/,
      "",
    )
    .trim();
  // Trailing standalone "(VIDEO)", "[WATCH]", " - WATCH NOW", " | VIDEO".
  t = t.replace(/\s*[-\u2013\u2014|(\[]\s*(?:watch(?:\s+now)?|video)\s*[)\]]?\s*$/i, "").trim();
  // Leading "WATCH:", "Video -", "MUST WATCH:", "VIDEO EXCLUSIVE -".
  t = t.replace(
    /^\s*(?:must[- ]?watch|watch\s+now|watch|exclusive\s+video|video\s+exclusive|video)\s*[:\-\u2013\u2014|]\s*/i,
    "",
  ).trim();
  return t;
}

/**
 * Remove explicit source packaging when prose crosses into a client-facing
 * section. This is intentionally much narrower than cleanIncidentTitle:
 * narrative text may contain punctuation and publisher names as facts, so only
 * labels/attribution wrappers are removed. Incident facts themselves are not
 * rewritten here.
 */
export function cleanClientFacingProse(prose: string): string {
  let text = (prose ?? "").trim();
  if (!text) return "";
  text = text
    .replace(
      /(^|[\n])\s*(?:source|raw|publisher|wire)\s+(?:headline|title)\s*:\s*["“]([^"”\n]+)["”]/gi,
      "$1$2",
    )
    .replace(
      /(^|[\n])\s*(?:source|raw|publisher|wire)\s+(?:headline|title)\s*:\s*/gi,
      "$1",
    )
    .replace(
      /(^|[\n])\s*(?:reuters|bloomberg|associated press|afp|ap)\s*:\s*/gi,
      "$1",
    )
    .replace(
      /["“]([^"\n“”]+)["”]\s*(?:[-–—|]\s*)?(?:reuters|bloomberg|associated press|afp|ap)\b/gi,
      "$1",
    );
  return text.replace(/[ \t]{2,}/g, " ").trim();
}
