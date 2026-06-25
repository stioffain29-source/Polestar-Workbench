// Clean English advisory titles for non-English incident headlines.
//
// Several regional feeds (e.g. Jubi.id, Cenderawasih Pos, Suara Papua for
// Indonesian West Papua) carry Bahasa Indonesia headlines, and other desks can
// surface Arabic / Thai / CJK / Cyrillic. Those raw headlines read poorly in an
// English advisory product. This stage produces a concise, faithful English
// advisory title and stores it on `incidents.display_title`, leaving the
// original `title` untouched. The UI prefers `display_title` and falls back to
// `title` so English rows and not-yet-processed rows are unaffected.
//
// Uses the Replit OpenAI integration (AI_INTEGRATIONS_OPENAI_* env vars are
// auto-provisioned). Self-contained fetch client with bounded concurrency,
// retries with backoff, and a per-request abort timeout — mirrors
// translateScreen.ts so a hung/unavailable model degrades gracefully instead of
// stalling the ingest. This step ONLY rewords the headline; it never decides
// scope, severity, country or coordinates — those authorities run elsewhere.
//
// Detection is the SAME predicate in JS (needsTitleTranslation) and in the SQL
// candidate query, both built from the constants below. CRITICAL: the query
// selects ONLY rows that match the predicate, so the per-run limit is never
// spent scanning permanently-English rows — every fetched row is a genuine
// candidate that drops out of the set once display_title is written. This makes
// the backfill converge (no starvation of older non-English rows behind a wall
// of newer English ones).

import { sql } from "drizzle-orm";
import { db, incidentsTable } from "@workspace/db";
import { isLlmAvailable, openAiFastModel, readOpenAiConfig } from "./openaiConfig";

const MODEL = openAiFastModel();
const REQUEST_TIMEOUT_MS = 20000;
// gpt-5-mini is a REASONING model: max_completion_tokens covers reasoning tokens
// FIRST, then the visible answer. A small cap (we previously used 200) is spent
// entirely on reasoning, so the model returns finish_reason="length" with EMPTY
// content and every translation fails (observed in prod: translated=0 failed=3,
// raw Bahasa headlines shipped to readers). Per the OpenAI integration skill, set
// this to 8192 and never lower — a one-line headline only emits ~30 answer tokens,
// so the extra budget is reasoning headroom, not extra cost on the output.
const MAX_COMPLETION_TOKENS = 8192;

// Unicode ranges that are unambiguously non-English script: Cyrillic, Arabic,
// Thai, Hiragana, Katakana, CJK, Hangul. Stored as [start,end] codepoint pairs
// so the JS regex and the Postgres regex are built from one source.
const NON_LATIN_RANGES: ReadonlyArray<readonly [string, string]> = [
  ["\u0400", "\u04FF"], // Cyrillic
  ["\u0600", "\u06FF"], // Arabic
  ["\u0E00", "\u0E7F"], // Thai
  ["\u3040", "\u30FF"], // Hiragana + Katakana
  ["\u3400", "\u9FFF"], // CJK Unified Ideographs
  ["\uAC00", "\uD7AF"], // Hangul
];

// Character-class body, e.g. "\u0400-\u04FF\u0600-\u06FF…" using the ACTUAL
// boundary characters (not literal "\u" escapes), valid in both JS and Postgres
// regex character classes.
const NON_LATIN_CLASS = NON_LATIN_RANGES.map(([a, b]) => `${a}-${b}`).join("");

// Bahasa Indonesia / Malay is Latin-script and ASCII, so script detection alone
// misses it (see MEMORY: "translate by SCRIPT + Indonesian markers, NOT
// non-ASCII"). These distinctive function/news words are strongly Indonesian and
// rare-to-absent in English headlines; the ambiguous short ones (para, dari,
// massa, saat, soal …) are deliberately excluded so genuine English titles are
// not needlessly rewritten.
const INDONESIAN_MARKER_WORDS: readonly string[] = [
  "yang", "dengan", "untuk", "tidak", "telah", "sudah", "adalah", "menjadi",
  "terhadap", "kepada", "diduga", "ditangkap", "tewas", "korban", "warga",
  "polisi", "aparat", "aksi", "wilayah", "kabupaten", "provinsi", "kembali",
  "terkait", "buntut", "imbas", "ratusan", "ribuan", "puluhan", "karena",
  "hingga", "pekan",
  // West Papua conflict vocabulary. The Bahasa headlines from the Papua desks
  // (e.g. "Konflik bersenjata di Tanah Papua…", "Negara tak pernah menjelaskan…")
  // carried NONE of the function words above, so the candidate query never
  // selected them and they shipped untranslated. Every word below is distinctly
  // Indonesian — none is an English word — so adding them cannot snag a genuine
  // English headline.
  "konflik", "bersenjata", "senjata", "negara", "pemerintah", "keamanan",
  "pasukan", "serangan", "penyerangan", "penembakan", "ditembak", "kekerasan",
  "pembunuhan", "menewaskan", "peneliti", "menjelaskan", "rekomendasikan",
  "situasi", "masyarakat", "dilaporkan", "anggota", "pernah",
  // Papua culture / casualty / announcement vocabulary. Two live West Papua
  // headlines ("Pergeseran Nilai ... Adat dan Budaya Papua" and "TPNPB Umumkan
  // Duka Nasional atas Gugurnya ...") carried NONE of the words above, so the
  // candidate query never selected them and raw Bahasa shipped to readers. Each
  // word below is distinctly Indonesian (no English collision), so adding them
  // cannot snag a genuine English headline. ("nilai" is omitted on purpose —
  // it is also a Malaysian town name; the headline is still caught by the
  // distinctly-Indonesian "pergeseran"/"adat"/"budaya".)
  "pergeseran", "adat", "budaya", "umumkan", "mengumumkan",
  "duka", "nasional", "gugur", "gugurnya",
  // Broad Indonesian local-coverage vocabulary (the `indonesia_local` topic
  // feeds Jakarta + Indonesia country reports from Bahasa-first sources across
  // many families). Without these, the bulk of Bahasa headlines — protest,
  // hazard, fire, haze, labour, terrorism, crime, transport and corruption —
  // carried none of the function words above and shipped raw (measured ~56% of
  // live rows). Every word below is distinctly Indonesian (no English spelling
  // collision), so adding them cannot snag a genuine English headline.
  // protest / civil unrest
  "demonstrasi", "unjuk", "kerusuhan", "bentrok", "rusuh", "ricuh",
  "kericuhan", "mahasiswa", "menuntut", "tuntut", "penghasutan",
  "menggeruduk", "geruduk",
  // fire
  "kebakaran", "terbakar", "karhutla", "hangus", "kobaran",
  // natural hazard (flood / quake / landslide / eruption)
  "banjir", "bandang", "gempa", "longsor", "bencana", "mengungsi",
  "pengungsi", "erupsi", "letusan",
  // environmental / haze ("asap" is omitted on purpose — it collides with the
  // English "ASAP"; "kabut"/"karhutla" already catch every haze headline)
  "kabut", "polusi", "pencemaran", "limbah",
  // labour
  "mogok", "buruh", "pekerja", "upah", "serikat", "pesangon", "pemecatan",
  // terrorism / militancy
  "teroris", "ledakan", "peledakan", "densus", "bunuh",
  // crime
  "pencurian", "perampokan", "begal", "pembegalan", "maling", "penipuan",
  "narkoba", "tersangka", "pelaku", "penganiayaan", "pencabulan",
  // transport / aviation / port ("kapal" can sit inside an English place name
  // such as "Bulak Kapal" — a rare, harmless false select that the translator
  // returns unchanged)
  "kecelakaan", "tabrakan", "tergelincir", "pelabuhan", "bandara",
  "pesawat", "kapal",
  // government / legal process / corruption + high-coverage Indonesian tokens
  "menteri", "pejabat", "presiden", "kabinet", "korupsi", "pencegahan",
  "sidang", "penjara", "vonis", "terdakwa", "kasus", "dugaan", "suap",
  "perkara", "penahanan", "geledah", "hakim", "kejaksaan", "penyidik",
  "saksi", "tahun", "miliar", "rupiah",
];

const NON_LATIN_RE = new RegExp(`[${NON_LATIN_CLASS}]`);
const INDONESIAN_RE = new RegExp(`\\b(${INDONESIAN_MARKER_WORDS.join("|")})\\b`, "i");

/** True when a title is non-English and should get an English advisory title. */
export function needsTitleTranslation(title?: string | null): boolean {
  const t = (title ?? "").trim();
  if (t.length < 3) return false;
  return NON_LATIN_RE.test(t) || INDONESIAN_RE.test(t);
}

type TranslateOutcome =
  | { ok: true; titleEn: string }
  | { ok: false; error: string; retryAfterMs?: number };

const SYSTEM_PROMPT = `You are an editor for an English-language security intelligence product.
Rewrite the given non-English news HEADLINE as a single concise, neutral English advisory title.
Rules: translate faithfully; preserve only facts present in the headline/summary; add NO new facts, numbers, places or speculation; drop the publisher/source name; no quotation marks; sentence case; <= 16 words.
Return STRICT JSON: {"titleEn": string}.`;

async function callOnce(title: string, summary: string): Promise<TranslateOutcome> {
  const cfg = readOpenAiConfig();
  if (!cfg) return { ok: false, error: "llm-unavailable" };
  const { baseUrl: base, apiKey: key } = cfg;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `HEADLINE: ${title}\nSUMMARY: ${summary || "(none)"}` },
        ],
      }),
      signal: ac.signal,
    });

    if (res.status === 429 || res.status >= 500) {
      const ra = res.headers.get("retry-after");
      let retryAfterMs: number | undefined;
      if (ra) {
        const secs = Number(ra);
        if (Number.isFinite(secs)) retryAfterMs = secs * 1000;
        else {
          const when = Date.parse(ra);
          if (Number.isFinite(when)) retryAfterMs = Math.max(0, when - Date.now());
        }
      }
      return { ok: false, error: `http-${res.status}`, retryAfterMs };
    }
    if (!res.ok) return { ok: false, error: `http-${res.status}` };

    const json = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: "empty-content" };

    let parsed: { titleEn?: unknown };
    try {
      parsed = JSON.parse(content) as { titleEn?: unknown };
    } catch {
      return { ok: false, error: "bad-json" };
    }
    const titleEn = typeof parsed.titleEn === "string" ? parsed.titleEn.trim() : "";
    if (!titleEn) return { ok: false, error: "empty-title" };
    return { ok: true, titleEn };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: ac.signal.aborted ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

const RETRYABLE = new Set(["timeout", "bad-json", "empty-content", "empty-title"]);

async function translateWithRetry(title: string, summary: string, retries = 3): Promise<TranslateOutcome> {
  let last: TranslateOutcome = { ok: false, error: "not-attempted" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await callOnce(title, summary);
    if (last.ok) return last;
    const retryable = RETRYABLE.has(last.error) || last.error.startsWith("http-");
    if (!retryable || attempt === retries) return last;
    const serverHint = !last.ok ? last.retryAfterMs : undefined;
    const backoff = serverHint ?? 1000 * Math.pow(2, attempt);
    const jitter = Math.random() * 500;
    await new Promise((r) => setTimeout(r, Math.min(backoff, 15000) + jitter));
  }
  return last;
}

export interface TitleTranslationSummary {
  candidates: number;
  translated: number;
  failed: number;
  skipped: boolean;
  logLines: string[];
}

/**
 * Backfill / refresh `display_title` for incidents whose original title is
 * non-English. The SQL query selects ONLY non-English rows that still have a
 * NULL display_title (the predicate matches needsTitleTranslation), so the
 * per-run `limit` is spent exclusively on genuine candidates and the work
 * converges across runs: each translated row leaves the candidate set. English
 * rows never match and so are never re-scanned. Safe to run repeatedly.
 *
 * Does NOT close the shared DB pool — the long-lived server keeps it open; CLI
 * wrappers call pool.end() themselves.
 */
export async function runTitleTranslation(
  opts: { commit?: boolean; limit?: number; concurrency?: number } = {},
): Promise<TitleTranslationSummary> {
  const commit = opts.commit ?? false;
  const limit = Math.max(1, opts.limit ?? 150);
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const logLines: string[] = [];

  if (!isLlmAvailable()) {
    logLines.push(
      "title-translate: LLM unavailable (set AI_INTEGRATIONS_OPENAI_* or OPENAI_API_KEY) — skipped",
    );
    return { candidates: 0, translated: 0, failed: 0, skipped: true, logLines };
  }

  // Detection lives in the WHERE so only real candidates are returned. Patterns
  // are passed as bound parameters (not interpolated into SQL text), so there is
  // no escaping to get wrong. `~` is case-sensitive (script ranges); `~*` is
  // case-insensitive (Indonesian markers); `\y` is the Postgres word boundary.
  const scriptPattern = `[${NON_LATIN_CLASS}]`;
  const markerPattern = `\\y(${INDONESIAN_MARKER_WORDS.join("|")})\\y`;

  // Newest first so freshly ingested foreign headlines are normalised promptly;
  // older candidates drain on subsequent runs (the set strictly shrinks because
  // each success writes a non-NULL display_title).
  const candidates = await db
    .select({
      id: incidentsTable.id,
      title: incidentsTable.title,
      summary: incidentsTable.summary,
    })
    .from(incidentsTable)
    .where(
      sql`${incidentsTable.displayTitle} IS NULL AND (${incidentsTable.title} ~ ${scriptPattern} OR ${incidentsTable.title} ~* ${markerPattern})`,
    )
    .orderBy(sql`${incidentsTable.createdAt} DESC`)
    .limit(limit);

  logLines.push(`title-translate: ${candidates.length} non-English candidate(s)`);

  let translated = 0;
  let failed = 0;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < candidates.length) {
      const r = candidates[next++];
      const outcome = await translateWithRetry(r.title, r.summary ?? "");
      if (!outcome.ok) {
        failed++;
        logLines.push(`  id=${r.id} FAILED (${outcome.error})`);
        continue;
      }
      translated++;
      if (commit) {
        await db
          .update(incidentsTable)
          .set({ displayTitle: outcome.titleEn })
          .where(sql`${incidentsTable.id} = ${r.id} AND ${incidentsTable.displayTitle} IS NULL`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));

  logLines.push(
    `title-translate: ${commit ? "committed" : "dry-run"} — translated ${translated}, failed ${failed}`,
  );
  return { candidates: candidates.length, translated, failed, skipped: false, logLines };
}
