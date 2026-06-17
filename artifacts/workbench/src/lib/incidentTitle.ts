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
