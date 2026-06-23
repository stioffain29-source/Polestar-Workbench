// LLM translate-and-screen stage for local-language cargo-crime feeds.
//
// Local-language news (Bahasa Indonesia, Arabic, Thai) surfaces genuine in-scope
// cargo incidents that the English Google-News feed never shows. Each candidate is
// passed to the model, which (a) translates the headline + summary to English,
// (b) judges whether it is a real in-scope cargo-crime incident (slop filter), and
// (c) extracts the country and city.
//
// Uses the shared OpenAI config (Replit AI_INTEGRATIONS_OPENAI_* or local
// OPENAI_API_KEY). Self-contained fetch client with bounded concurrency,
// retries with backoff, and a per-request abort timeout so a hung or unavailable
// model degrades gracefully instead of stalling the ingest. Severity is NOT decided
// here — the existing English classifier runs on the translated text downstream, so
// there is a single severity authority across English and translated incidents.

import { isLlmAvailable, openAiFastModel, readOpenAiConfig } from "./openaiConfig";

const MODEL = openAiFastModel();
const REQUEST_TIMEOUT_MS = 20000;
// gpt-5-mini is a REASONING model — max_completion_tokens is consumed by reasoning
// tokens before the JSON verdict is emitted. A low cap risks finish_reason="length"
// with empty content, which silently drops in-scope local-language cargo items. Per
// the OpenAI integration skill, keep this at 8192 (reasoning headroom; the JSON
// verdict itself is tiny) and never lower it.
const MAX_COMPLETION_TOKENS = 8192;

export type ScreenInput = { title: string; summary: string };

export type ScreenVerdict = {
  inScope: boolean;
  titleEn: string;
  summaryEn: string;
  country: string | null;
  city: string | null;
  reason: string;
};

export type ScreenOutcome =
  | { ok: true; verdict: ScreenVerdict }
  | { ok: false; error: string; retryAfterMs?: number };

export { isLlmAvailable };

const SYSTEM_PROMPT = `You screen foreign-language news items for a CARGO-CRIME intelligence feed covering ONLY the Asia-Pacific and Middle East regions.
Return STRICT JSON: {"inScope":boolean,"titleEn":string,"summaryEn":string,"country":string|null,"city":string|null,"reason":string}.
KEEP (inScope=true) ONLY a concrete, real-world cargo/freight/logistics theft incident: truck/lorry hijacking or robbery, warehouse/depot break-in, container or shipment theft, freight/cargo pilferage — that occurred in an Asia-Pacific or Middle East country.
REJECT (inScope=false, slop) ALL of: opinion/analysis/commentary/statistics/"rising theft" think-pieces; product/insurance/webinar/press-release marketing; incidents OUTSIDE APAC/Middle East (US, Latin America, Europe, Africa); NON-cargo theft (utility/fuel-line/electricity/water/ration-PDS/coal/data/identity/shoplifting/retail-store theft, pickpocketing); generic crime with no cargo/freight/warehouse target.
country = canonical English country name of the incident location, or null if unclear. city = English city/place name or null. Translate titleEn/summaryEn faithfully to English. reason = <=12 words why kept/rejected.`;

async function callOnce(input: ScreenInput): Promise<ScreenOutcome> {
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
          { role: "user", content: `TITLE: ${input.title}\nSUMMARY: ${input.summary || "(none)"}` },
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
    if (!res.ok) {
      return { ok: false, error: `http-${res.status}` };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (!content) {
      return { ok: false, error: `empty-content(${choice?.finish_reason ?? "?"})` };
    }

    let parsed: Partial<ScreenVerdict>;
    try {
      parsed = JSON.parse(content) as Partial<ScreenVerdict>;
    } catch {
      return { ok: false, error: "bad-json" };
    }

    return {
      ok: true,
      verdict: {
        inScope: Boolean(parsed.inScope),
        titleEn: typeof parsed.titleEn === "string" ? parsed.titleEn : "",
        summaryEn: typeof parsed.summaryEn === "string" ? parsed.summaryEn : "",
        country: typeof parsed.country === "string" && parsed.country.trim() ? parsed.country.trim() : null,
        city: typeof parsed.city === "string" && parsed.city.trim() ? parsed.city.trim() : null,
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: ac.signal.aborted ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

const RETRYABLE = new Set(["timeout", "bad-json"]);

/** Screen a single item with retries + exponential backoff. */
export async function screenItem(input: ScreenInput, retries = 3): Promise<ScreenOutcome> {
  let last: ScreenOutcome = { ok: false, error: "not-attempted" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await callOnce(input);
    if (last.ok) return last;
    const retryable = RETRYABLE.has(last.error) || last.error.startsWith("http-");
    if (!retryable || attempt === retries) return last;
    // Honour a server Retry-After when present (429); otherwise exponential
    // backoff. Jitter spreads concurrent workers so they don't retry in lockstep
    // and re-trigger the same rate-limit burst (thundering herd).
    const serverHint = !last.ok ? last.retryAfterMs : undefined;
    const backoff = serverHint ?? 1000 * Math.pow(2, attempt);
    const jitter = Math.random() * 500;
    await new Promise((r) => setTimeout(r, Math.min(backoff, 15000) + jitter));
  }
  return last;
}

/** Screen a batch with bounded concurrency. Order is preserved. */
export async function screenBatch(
  items: ScreenInput[],
  opts: { concurrency?: number } = {},
): Promise<ScreenOutcome[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const out: ScreenOutcome[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await screenItem(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
