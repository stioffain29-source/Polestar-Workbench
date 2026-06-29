// Browser-safe mirror of the ingest title-translation DETECTION predicate.
//
// The authoritative copy lives in `lib/ingest/src/titleTranslate.ts`
// (`needsTitleTranslation`, `NON_LATIN_RANGES`, `INDONESIAN_MARKER_WORDS`). That
// module imports `@workspace/db` and the OpenAI client, so it cannot be pulled
// into the browser bundle. This file re-implements ONLY the pure, dependency-free
// detection half so the workbench can flag an incident whose foreign-language
// headline has NOT yet been translated (i.e. it still needs a `display_title` but
// none was produced — usually because the AI integration is unconfigured).
//
// SYNC CONTRACT: if you change the non-Latin ranges or the Indonesian marker list
// in `lib/ingest/src/titleTranslate.ts`, mirror the change here (and vice versa),
// or the on-screen "untranslated" hint will drift from what ingest actually
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
 * True when an incident's headline still reads in a foreign language on screen —
 * i.e. there is no usable English `displayTitle` AND the raw `title` is non-
 * English. Surfaces the "untranslated" hint so readers know an English advisory
 * title was expected but not produced (typically: AI integration unconfigured).
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
 * The headline to render: the English `displayTitle` when present, else the raw
 * `title`. Mirrors the ingest contract (UI prefers display_title, falls back to
 * title).
 */
export function displayIncidentTitle(
  title?: string | null,
  displayTitle?: string | null,
): string {
  const display = (displayTitle ?? "").trim();
  return display || (title ?? "").trim();
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
