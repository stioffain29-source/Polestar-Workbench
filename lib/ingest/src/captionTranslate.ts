// Clean English translations for non-English social-media captions.
//
// Social sources (KAMMI Instagram, and any future Bahasa-first feed) carry post
// captions in Bahasa Indonesia (occasionally mixed English). The relevance
// router and the incident title must be in English — an incident stored with a
// Bahasa title would also fail to re-score on a RELEVANCE_RULE_VERSION bump — so
// this stage produces a faithful English rendering of a caption before routing.
//
// Mirrors titleTranslate.ts's LLM harness (SAME Replit OpenAI client via
// openaiConfig, SAME retry/backoff + abort-timeout). It DELIBERATELY drops the
// title path's marker-word language gate: that gate exists to avoid spending the
// model on the high-volume, mostly-English incident-title stream, but the social
// caption stream is small and single-source Bahasa, and the same gate was too
// leaky here — genuinely-Bahasa captions that happened not to contain a listed
// function word shipped raw. So every caption is translated; the prompt returns
// already-English captions unchanged.
//
// STRICT no-fabrication: this step only re-expresses the existing caption in
// English. It never adds facts, and it decides no scope, status, severity,
// country or promotion — those authorities run elsewhere and are unchanged.

import { isLlmAvailable, openAiFastModel, readOpenAiConfig } from "./openaiConfig";

const MODEL = openAiFastModel();
// Captions are long-form (multi-paragraph event announcements run 1,000+ chars),
// unlike the short incident titles the sibling title path handles. A reasoning
// model needs real wall-clock time to translate that much text, so a tight
// timeout aborts the longest captions on every attempt and they ship raw. Give
// the caption path generous headroom (the title path keeps its own tighter cap).
const REQUEST_TIMEOUT_MS = 60000;
// gpt-5-mini is a REASONING model: max_completion_tokens covers reasoning tokens
// FIRST, then the visible answer. A small cap is spent entirely on reasoning, so
// the model returns finish_reason="length" with EMPTY content and every
// translation silently fails. Per the OpenAI integration skill and MEMORY, set
// this to 8192 and never lower — a caption emits only a few hundred answer
// tokens, so the extra budget is reasoning headroom, not extra output cost.
const MAX_COMPLETION_TOKENS = 8192;

type TranslateOutcome =
  | { ok: true; captionEn: string }
  | { ok: false; error: string; retryAfterMs?: number };

const SYSTEM_PROMPT = `You translate Indonesian/Malay social-media post captions into clear, faithful English for an English-reading security analyst.
Rules: translate faithfully and completely; preserve every fact, date, time, place name and organiser/organisation name exactly; add NO new facts, numbers or interpretation; if the text is already English, return it unchanged; you may lightly tidy whitespace and drop decorative emoji, but keep meaningful hashtags; no preamble or commentary.
Return STRICT JSON: {"captionEn": string}.`;

async function callOnce(caption: string): Promise<TranslateOutcome> {
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
          { role: "user", content: `CAPTION: ${caption}` },
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

    let parsed: { captionEn?: unknown };
    try {
      parsed = JSON.parse(content) as { captionEn?: unknown };
    } catch {
      return { ok: false, error: "bad-json" };
    }
    const captionEn = typeof parsed.captionEn === "string" ? parsed.captionEn.trim() : "";
    if (!captionEn) return { ok: false, error: "empty-caption" };
    return { ok: true, captionEn };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: ac.signal.aborted ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

const RETRYABLE = new Set(["timeout", "bad-json", "empty-content", "empty-caption"]);

async function translateWithRetry(caption: string, retries = 3): Promise<TranslateOutcome> {
  let last: TranslateOutcome = { ok: false, error: "not-attempted" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await callOnce(caption);
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

/**
 * Translate one caption to clean English. Pure and side-effect free (no DB): the
 * one translate authority every social source calls before routing. Returns the
 * English rendering, or `null` when the LLM is unavailable/unset, the caption is
 * empty, or translation fails after retries — the caller then falls back to the
 * raw caption (which mostly drops at the relevance gate), never fabricating.
 */
export async function translateCaptionToEnglish(caption: string): Promise<string | null> {
  if (!isLlmAvailable()) return null;
  const trimmed = caption.trim();
  if (!trimmed) return null;
  const outcome = await translateWithRetry(trimmed);
  return outcome.ok ? outcome.captionEn : null;
}
