// AI country-report prose engine.
//
// Generates the narrative sections of a country brief grounded STRICTLY on the
// actual window incidents the report is built from (the same set that drives the
// Fast Facts tiles, map and table on the client), plus optional analyst-curated
// standing background. The result is cached by a fingerprint of that incident
// set, so the model is only ever called when the underlying data changes — this
// keeps cost negligible AND means the prose can never go stale.
//
// LLM access uses the Replit OpenAI integration (AI_INTEGRATIONS_OPENAI_* env
// vars, auto-provisioned). Self-contained fetch client with retries, backoff and
// an abort timeout, mirroring lib/ingest/src/titleTranslate.ts so an unavailable
// model degrades gracefully (the caller falls back to the deterministic template
// generator) instead of failing the report.

import { createHash } from "node:crypto";
import type { CountryProseSections } from "@workspace/db";
import {
  isLlmAvailable,
  openAiProseModel,
  readOpenAiConfig,
} from "@workspace/ingest";

const MODEL = openAiProseModel();
const REQUEST_TIMEOUT_MS = 60000;
const MAX_COMPLETION_TOKENS = 8192;

// Bump when the prompt or section contract changes so existing cache rows are
// treated as stale and regenerated.
export const PROSE_PROMPT_VERSION = "v6";

// The model only ever sees this many incidents, and the cache fingerprint hashes
// exactly the same capped set — so the cache key and the prompt input can never
// diverge (a caller cannot append filler past the cap to force a cache miss while
// the prompt is unchanged). The window set is small in practice.
export const MAX_PROSE_INCIDENTS = 60;

// Hard ceiling on the incidents a single request may submit before processing.
// The prompt is capped to MAX_PROSE_INCIDENTS regardless; this bound keeps a
// public caller from forcing unbounded JSON parsing / hashing work server-side.
export const MAX_PROSE_INCIDENTS_ACCEPTED = 1000;

export interface ProseIncidentInput {
  id?: string | null;
  topic?: string | null;
  title?: string | null;
  summary?: string | null;
  location?: string | null;
  country?: string | null;
  severity?: string | null;
  occurredAt?: string | null;
  source?: string | null;
}

export interface ProseBaselineContext {
  operatingEnvironment?: string | null;
  securityContext?: string | null;
  knownRiskAreas?: string[] | null;
  keyCitiesProvinces?: string[] | null;
  movementConstraints?: string | null;
  infrastructureLimits?: string | null;
  medicalEvac?: string | null;
  resourceSectorExposure?: string | null;
}

// "country" = the generic seven-section country brief. "png" = the bespoke
// structured brief (Papua New Guinea AND the Indonesian West Papua report), which
// is rendered by its own deterministic builder and only wants two AI paragraphs
// (Executive Summary + Outlook); the other sections come from the structured
// dataset, not the model. The prompt is country-aware (structuredSystemPrompt)
// so the two theatres are never framed as each other.
export type ProseVariant = "country" | "png";

export interface GenerateProseInput {
  countryName: string;
  region: string;
  basisDays: number;
  periodWord: string;
  issueDate: string;
  incidents: ProseIncidentInput[];
  baseline?: ProseBaselineContext | null;
  variant?: ProseVariant;
}

export type GenerateProseOutcome =
  | { ok: true; sections: CountryProseSections; model: string }
  | { ok: false; error: string; retryAfterMs?: number };

export { isLlmAvailable };

// A stable identity for one incident: EVERY fact that reaches the model and could
// change the prose. Summary, source, country and topic are included because the
// prompt renders them, so a correction to any of them must flip the fingerprint
// (otherwise cached prose could describe text the incident no longer holds).
export function incidentIdentity(i: ProseIncidentInput): string {
  const date = (i.occurredAt ?? "").slice(0, 10);
  const norm = (v?: string | null) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return [
    // id is included because the per-incident summaries (png variant) are keyed
    // by it: if the id changes the cached summary map can no longer be matched to
    // the rendered card, so the fingerprint must flip and regenerate.
    norm(i.id),
    norm(i.title),
    date,
    norm(i.severity),
    norm(i.location),
    norm(i.country),
    norm(i.topic),
    norm(i.source),
    norm(i.summary),
  ].join("|");
}

// The canonical, capped incident set: deterministically ordered (most recent
// first, then by title) and truncated to MAX_PROSE_INCIDENTS. BOTH the prompt and
// the fingerprint derive from this exact list, so the cache key always matches
// the input the model actually received.
export function canonicalIncidents(incidents: ProseIncidentInput[]): ProseIncidentInput[] {
  return [...incidents]
    .sort((a, b) => {
      const da = (a.occurredAt ?? "").slice(0, 10);
      const db = (b.occurredAt ?? "").slice(0, 10);
      if (da !== db) return da < db ? 1 : -1; // most recent first
      const t = (a.title ?? "").localeCompare(b.title ?? "");
      if (t !== 0) return t;
      // Final deterministic tiebreaker on id. Syndicated duplicates can share an
      // identical title AND date; without this their relative order follows the
      // (non-deterministic) incoming order, which — now that id is part of each
      // incident's identity — flips the ordered id list the fingerprint hashes and
      // regenerates the prose on every load. Sorting tied rows by id pins the
      // order, so the fingerprint (and the prompt's incident numbering) is stable.
      return String(a.id ?? "").localeCompare(String(b.id ?? ""));
    })
    .slice(0, MAX_PROSE_INCIDENTS);
}

/**
 * Deterministic fingerprint of the inputs the prose is grounded on. Hashes the
 * SAME capped/canonical incident set the model is given, so the cache hits for
 * identical data and any change to the incidents (new record, changed
 * severity/date/location/summary/source/country/topic) flips it and forces a
 * regenerate. Incidents beyond the cap cannot affect prose, so they cannot
 * affect the key.
 */
export function computeProseFingerprint(input: {
  slug: string;
  countryName: string;
  basisDays: number;
  incidents: ProseIncidentInput[];
  variant?: ProseVariant;
}): string {
  const ids = canonicalIncidents(input.incidents).map(incidentIdentity);
  const payload = JSON.stringify({
    v: PROSE_PROMPT_VERSION,
    variant: input.variant ?? "country",
    slug: input.slug,
    name: input.countryName,
    basisDays: input.basisDays,
    ids,
  });
  return createHash("sha256").update(payload).digest("hex");
}

const SYSTEM_PROMPT = `You are a senior security-intelligence analyst writing a country brief for corporate clients (security managers, travel-risk and operations teams). You write the way an experienced human analyst writes: specific, measured and genuinely useful. You are given the actual incidents recorded for a country over a reporting window, plus verified standing background, and you produce the narrative sections of the brief.

GROUNDING — non-negotiable:
- The brief is about the COUNTRY named in the prompt and ONLY that country. Never describe, name or frame the brief around a DIFFERENT country, even one with a similar name. In particular, "Papua" (a province of Indonesia, also called West Papua) and "Papua New Guinea" (a separate sovereign state) are DIFFERENT places: a brief for one must never be framed as the other or adopt its risk profile, cities or institutions. For a cross-border incident, write it strictly from the named country's perspective.
- Every statement about what happened during the window must come ONLY from the supplied INCIDENTS. Do not invent or infer events, casualty figures, numbers, dates, place names, group names or attributions that are not present in the incident records.
- You MAY use the supplied STANDING BACKGROUND (verified, analyst-curated) and well-established, uncontroversial facts about the country's operating environment for framing — but never present background as if it happened during this window.
- If the window has few or no incidents, say so plainly and lean on the standing background. A quiet window reflects limited reporting, not safety: never imply the country has become calm, and never fabricate activity to fill space.

WRITING RULES:
- Each section does a DISTINCT job. Never repeat the same fact or sentence across sections; in particular do not restate the lead location or event type in more than one section.
- Do NOT state numeric counts of incidents or records in the prose (e.g. "three incidents", "2 records"). Counts appear elsewhere in the brief.
- Severity words, when used, must be EXACTLY one of: Insignificant, Low, Moderate, High, Extreme. Use no other severity words and never overstate.
- Write concrete, information-dense sentences. Name the actual places, actors and event types from the incidents. No filler ("the pattern is clear enough to act on"), no hedging boilerplate, no generic risk-management truisms.
- Write impersonally about the country and its risk trajectory. NEVER address, name or label the reader or audience. Do not use words such as "corporate operators", "operators", "clients", "companies", "businesses", "organisations" or "the reader", and never write "[anyone] should expect ..." or "in the coming period, [audience] should expect ...". State what is likely to happen and where pressure is likely — not what a reader should expect. (The imperative actions are the only place for direct advice, and even there name the action, not the audience.)
- Never use slash-joined category labels (e.g. "crime / public safety"); write natural prose.
- Do NOT mention any internal tools, systems, software, dashboards, data pipelines, de-duplication, relevance screening, geocoding, "open-source reporting" or how the data was collected. Write as the analyst, about the country — not about the process.
- British English. Professional, neutral register. No hyperbole, no emojis, no markdown.

PER-INCIDENT SUMMARIES ("incidentSummaries"):
- For EVERY numbered incident in the INCIDENTS list, write one concise factual analyst summary of THAT specific incident.
- Ground each summary ONLY on that incident's own title and summary line — never on any other incident, the standing background, or outside knowledge. Do not invent, infer or add facts, casualty figures, place names, group names or attributions that are not in that incident's own text.
- State plainly what happened, where, who or what was affected, and the operational implication for staff movement, site access or continuity ONLY where that incident's own text supports it.
- One sentence is usually enough; use two only when the incident's text genuinely carries that much. When the source text is thin, keep it short rather than padding.
- Do NOT state numeric counts of incidents or records, and do NOT repeat the incident's title verbatim.

Return STRICT JSON with EXACTLY these keys and no others:
{
  "executiveSummary": string,  // 2-3 sentences: the headline judgement for this window and what it means for operations.
  "situation": string,         // The operating picture: the standing environment framed against what this window actually shows.
  "whatHappened": string,      // Only the window's actual events, told concretely with the specific places and event types from the incidents.
  "whatMatters": string,       // Why it matters for staff movement, site access and continuity, and where to focus attention.
  "implications": string[],    // 4-7 distinct concrete actions the client should take. Each a short imperative sentence. No numbering, no leading dash.
  "watchNext": string[],       // 4-7 specific forward indicators to monitor. Each short and specific. No "Watch for" prefix.
  "polestarView": string,      // The bottom-line analyst judgement and the recommended operating posture.
  "incidentSummaries": object  // Keys are the incident NUMBERS from the INCIDENTS list as strings ("1", "2", ...); each value is that incident's factual summary as described above. Include an entry for every numbered incident.
}
Return ONLY the JSON object.`;

// Structured brief variant: the deterministic builder still owns the per-province
// and per-category breakdown, watchlist and per-incident card scaffolding. The
// model writes the brief's free-prose narrative sections (Bottom Line Up Front,
// Executive Summary, What Changed, Outlook, Polestar View); each falls back to the
// deterministic dataset paragraph when no AI prose exists. Country-aware so the
// SAME structured brief serves Papua New Guinea and the Indonesian West Papua
// report without one being framed as the other.
function structuredSystemPrompt(countryName: string): string {
  return `You are a senior security-intelligence analyst writing the ${countryName} country brief for corporate clients (security managers, travel-risk and operations teams). You write the way an experienced human analyst writes: specific, measured and genuinely useful. You are given the actual incidents recorded for ${countryName} over a reporting window, plus verified standing background, and you produce the brief's narrative sections.

GROUNDING — non-negotiable:
- The brief is about ${countryName} and ONLY ${countryName}. Never describe, name or frame the brief around a DIFFERENT country, even one with a similar name. In particular, "Papua" (a province of Indonesia, also called West Papua) and "Papua New Guinea" (a separate sovereign state) are DIFFERENT places: a brief for one must never be framed as the other or adopt its risk profile, cities or institutions. For a cross-border incident, write it strictly from ${countryName}'s perspective.
- Every statement about what happened during the window must come ONLY from the supplied INCIDENTS. Do not invent or infer events, casualty figures, numbers, dates, place names, group names or attributions that are not present in the incident records.
- You MAY use the supplied STANDING BACKGROUND (verified, analyst-curated) and well-established, uncontroversial facts about ${countryName}'s operating environment for framing — but never present background as if it happened during this window.
- If the window has few or no incidents, say so plainly and lean on the standing background. A quiet window reflects limited reporting, not safety: never imply the country has become calm, and never fabricate activity to fill space.

WRITING RULES:
- The five narrative sections do DISTINCT jobs and must not repeat the same fact or sentence across one another:
  - "bluf" (Bottom Line Up Front): the single most important takeaway for this window, stated first, in 1-2 sentences a busy reader could act on alone.
  - "executiveSummary": characterises what this window shows — the dominant provinces and event types — and what it means for operations now.
  - "whatChanged": how this window differs from the standing pattern; if little or nothing changed, say so plainly rather than manufacturing a shift.
  - "outlook": the forward view for the coming period — what is likely to happen and where pressure is likely.
  - "polestarView": the bottom-line analyst judgement and the recommended operating posture.
- Do NOT state numeric counts of incidents or records in the prose (e.g. "three incidents", "2 records"). Counts appear elsewhere in the brief.
- Severity words, when used, must be EXACTLY one of: Insignificant, Low, Moderate, High, Extreme. Use no other severity words and never overstate.
- Write concrete, information-dense sentences. Name the actual provinces, actors and event types from the incidents. No filler, no hedging boilerplate, no generic risk-management truisms.
- Write impersonally about the country and its risk trajectory. NEVER address, name or label the reader or audience. Do not use words such as "corporate operators", "operators", "clients", "companies", "businesses", "organisations" or "the reader", and never write "[anyone] should expect ..." or "in the coming period, [audience] should expect ...". State what is likely to happen and where pressure is likely — not what a reader should expect.
- Never use slash-joined category labels (e.g. "crime / public safety"); write natural prose.
- Do NOT mention any internal tools, systems, software, dashboards, data pipelines, de-duplication, relevance screening, geocoding, "open-source reporting" or how the data was collected. Write as the analyst, about the country — not about the process.
- British English. Professional, neutral register. No hyperbole, no emojis, no markdown.

PER-INCIDENT SUMMARIES ("incidentSummaries"):
- For EVERY numbered incident in the INCIDENTS list, write one concise factual analyst summary of THAT specific incident.
- Ground each summary ONLY on that incident's own title and summary line — never on any other incident, the standing background, or outside knowledge. Do not invent, infer or add facts, casualty figures, place names, group names or attributions that are not in that incident's own text.
- State plainly what happened, where, who or what was affected, and the operational implication for staff movement, site access or continuity ONLY where that incident's own text supports it.
- One sentence is usually enough; use two only when the incident's text genuinely carries that much. When the source text is thin, keep it short rather than padding.
- Do NOT state numeric counts of incidents or records, and do NOT repeat the incident's title verbatim.

Return STRICT JSON with EXACTLY these keys and no others:
{
  "bluf": string,              // 1-2 sentences: the single most important takeaway for this window, stated first.
  "executiveSummary": string,  // 3-4 sentences: the headline judgement for this window — the dominant provinces and event types — and what it means for operations now.
  "whatChanged": string,       // 2-3 sentences: how this window differs from the standing pattern; if little changed, say so plainly.
  "outlook": string,           // 2-3 sentences: the forward view for the coming period, grounded in this window's pattern and the standing background; what to expect and where pressure is likely.
  "polestarView": string,      // 2-3 sentences: the bottom-line analyst judgement and the recommended operating posture.
  "incidentSummaries": object  // Keys are the incident NUMBERS from the INCIDENTS list as strings ("1", "2", ...); each value is that incident's factual summary as described above. Include an entry for every numbered incident.
}
Return ONLY the JSON object.`;
}

function baselineBlock(b?: ProseBaselineContext | null): string {
  if (!b) return "none provided";
  const parts: string[] = [];
  const push = (label: string, v?: string | null) => {
    const t = (v ?? "").trim();
    if (t) parts.push(`${label}: ${t}`);
  };
  const pushList = (label: string, v?: string[] | null) => {
    const list = (v ?? []).map((s) => s.trim()).filter(Boolean);
    if (list.length) parts.push(`${label}: ${list.join("; ")}`);
  };
  push("Operating environment", b.operatingEnvironment);
  push("Security context", b.securityContext);
  pushList("Known risk areas", b.knownRiskAreas);
  pushList("Key cities/provinces", b.keyCitiesProvinces);
  push("Movement constraints", b.movementConstraints);
  push("Infrastructure limits", b.infrastructureLimits);
  push("Medical/evacuation", b.medicalEvac);
  push("Resource-sector exposure", b.resourceSectorExposure);
  return parts.length ? parts.join("\n") : "none provided";
}

export function incidentBlock(incidents: ProseIncidentInput[]): string {
  if (incidents.length === 0) return "No incidents recorded in this window.";
  // Same canonical capped set the fingerprint hashes — prompt and cache key stay
  // in lockstep.
  const capped = canonicalIncidents(incidents);
  return capped
    .map((i, idx) => {
      const sev = (i.severity ?? "").trim() || "unrated";
      const date = (i.occurredAt ?? "").slice(0, 10) || "undated";
      const title = (i.title ?? "").trim() || "(untitled)";
      const place = [i.location, i.country].map((s) => (s ?? "").trim()).filter(Boolean).join(", ") || "location unclear";
      const src = (i.source ?? "").trim();
      const summary = (i.summary ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
      const head = `${idx + 1}. [${sev}] ${date} — ${title} — ${place}${src ? ` (${src})` : ""}`;
      return summary ? `${head}\n   ${summary}` : head;
    })
    .join("\n");
}

function buildUserPrompt(input: GenerateProseInput): string {
  return [
    `COUNTRY: ${input.countryName} (${input.region || "region unspecified"})`,
    `REPORTING WINDOW: ${input.periodWord} (rolling ${input.basisDays}-day window ending ${input.issueDate})`,
    "",
    "STANDING BACKGROUND (verified; NOT this window):",
    baselineBlock(input.baseline),
    "",
    "INCIDENTS (the ONLY source of this-window facts):",
    incidentBlock(input.incidents),
  ].join("\n");
}

// Defence-in-depth for the hard "no incident counts in prose" rule. The prompt
// already forbids them, but the model occasionally slips a parenthetical record
// count ("(2 records)", "(12 of 30 incidents)") into a sentence. Strip ONLY
// parentheticals that carry both a digit AND a count noun, so legitimate
// parentheticals (years, place names) survive. Newlines are preserved so the
// bullet sections keep their line breaks; only intra-line spacing is tidied.
const COUNT_ANNOTATION_RE =
  /[ \t]*\((?=[^)]*\d)[^)]*\b(?:records?|incidents?|reports?|events?|cases?|entr(?:y|ies)|articles?|items?|data ?points?)\b[^)]*\)/gi;

export function stripProseCountAnnotations(text: string): string {
  if (!text) return text;
  return text
    .replace(COUNT_ANNOTATION_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function coerceStr(v: unknown): string {
  return typeof v === "string" ? stripProseCountAnnotations(v.trim()) : "";
}

function coerceList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) =>
      typeof x === "string"
        ? stripProseCountAnnotations(x.trim().replace(/^[-*]\s*/, ""))
        : "",
    )
    .filter(Boolean);
}

// Map the model's number-keyed per-incident summaries ("1", "2", ...) back to an
// id-keyed map the client renders. The prompt numbers the canonical capped set,
// so each number maps to that incident's id. Used by BOTH the structured ("png")
// brief and the generic ("country") report so per-incident summaries reach every
// country brief.
function mapIncidentSummaries(
  raw: unknown,
  incidents: ProseIncidentInput[],
): Record<string, string> {
  const canon = canonicalIncidents(incidents);
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const idx = Number(k) - 1;
      const inc = Number.isInteger(idx) ? canon[idx] : undefined;
      const text = coerceStr(v);
      const id = inc?.id != null ? String(inc.id).trim() : "";
      if (id && text) out[id] = text;
    }
  }
  return out;
}

function parseSections(
  content: string,
  variant: ProseVariant,
  incidents: ProseIncidentInput[],
): CountryProseSections | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    // Some models wrap the JSON in prose/code fences; extract the first object.
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      raw = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  if (variant === "png") {
    // The PNG brief consumes Executive Summary + Outlook + the per-incident
    // summaries; the structured builder owns every other section. The remaining
    // keys are written empty so the stored shape stays a valid
    // CountryProseSections.
    //
    // incidentSummaries are returned keyed by the 1-based incident NUMBER from
    // the prompt. The prompt numbers the canonical capped set, so map each number
    // back to that incident's id to produce the id-keyed map the client renders.
    const incidentSummaries = mapIncidentSummaries(o.incidentSummaries, incidents);
    const sections: CountryProseSections = {
      bluf: coerceStr(o.bluf),
      executiveSummary: coerceStr(o.executiveSummary),
      whatChanged: coerceStr(o.whatChanged),
      outlook: coerceStr(o.outlook),
      polestarView: coerceStr(o.polestarView),
      incidentSummaries,
      // The structured builder still owns these sections; the brief never reads
      // them for the png variant.
      situation: "",
      whatHappened: "",
      whatMatters: "",
      implications: [],
      watchNext: [],
    };
    // Require the two anchor paragraphs; bluf/whatChanged/polestarView are
    // best-effort and fall back to the deterministic dataset paragraph at render.
    if (!sections.executiveSummary || !sections.outlook) return null;
    return sections;
  }

  const sections: CountryProseSections = {
    executiveSummary: coerceStr(o.executiveSummary),
    situation: coerceStr(o.situation),
    whatHappened: coerceStr(o.whatHappened),
    whatMatters: coerceStr(o.whatMatters),
    implications: coerceList(o.implications),
    watchNext: coerceList(o.watchNext),
    polestarView: coerceStr(o.polestarView),
    // Per-incident analyst summaries (best-effort) keyed by incident id, shown in
    // the Related Incidents table. Absent entries fall back to no summary.
    incidentSummaries: mapIncidentSummaries(o.incidentSummaries, incidents),
  };
  // Require the core paragraphs; bullet lists may legitimately be short and the
  // per-incident summaries are best-effort.
  if (!sections.executiveSummary || !sections.situation || !sections.whatHappened) {
    return null;
  }
  return sections;
}

async function callOnce(input: GenerateProseInput): Promise<GenerateProseOutcome> {
  const cfg = readOpenAiConfig();
  if (!cfg) return { ok: false, error: "llm-unavailable" };
  const { baseUrl: base, apiKey: key } = cfg;

  const variant: ProseVariant = input.variant ?? "country";
  const systemPrompt =
    variant === "png" ? structuredSystemPrompt(input.countryName) : SYSTEM_PROMPT;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: buildUserPrompt(input) },
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
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (!content) return { ok: false, error: `empty-content(${choice?.finish_reason ?? "?"})` };

    const sections = parseSections(content, variant, input.incidents);
    if (!sections) return { ok: false, error: "bad-json" };
    return { ok: true, sections, model: MODEL };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: ac.signal.aborted ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

const RETRYABLE = new Set(["timeout", "bad-json", "empty-content"]);

// True only for the transient failures worth retrying: the fixed RETRYABLE set
// plus rate-limit / server errors (http-429 and any http-5xx, which a brief
// wait can clear). A non-transient HTTP failure (http-400, http-401, http-404,
// ...) is NOT retried — a retry cannot fix a malformed request or an auth
// problem, so retrying only burns the model budget and delays the template
// fallback. (A bare "http-" prefix check would wrongly retry all of these.)
export function isRetryableProseError(error: string): boolean {
  if (RETRYABLE.has(error)) return true;
  // empty-content is emitted with the model's finish_reason appended
  // (e.g. "empty-content(stop)", "empty-content(length)"), so the bare set
  // membership check above never matches it — pattern-match the prefix so an
  // empty reply is retried as the RETRYABLE set intends.
  if (error.startsWith("empty-content(")) return true;
  const m = /^http-(\d{3})$/.exec(error);
  if (!m) return false;
  const status = Number(m[1]);
  return status === 429 || status >= 500;
}

/** Generate country prose with retries + exponential backoff. */
export async function generateCountryProse(
  input: GenerateProseInput,
  retries = 2,
): Promise<GenerateProseOutcome> {
  let last: GenerateProseOutcome = { ok: false, error: "not-attempted" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await callOnce(input);
    if (last.ok) return last;
    const retryable = isRetryableProseError(last.error);
    if (!retryable || attempt === retries) return last;
    const serverHint = !last.ok ? last.retryAfterMs : undefined;
    const backoff = serverHint ?? 1000 * Math.pow(2, attempt);
    const jitter = Math.random() * 500;
    await new Promise((r) => setTimeout(r, Math.min(backoff, 15000) + jitter));
  }
  return last;
}

// --- Per-incident summaries (TOPIC / CONFLICT / SHIPPING report tables) -------
//
// A focused, summaries-ONLY use of the same prompt contract, LLM client, cache
// fingerprint and id-keyed mapping the country brief uses. It produces one short
// factual analyst summary per incident for the Related Incidents table of a
// topic/conflict/shipping report — grounded ONLY on each incident's own text,
// British English, five-tier severity vocab, no fabricated facts, no
// parenthetical counts. The caller caches the result by reportId keyed on the
// fingerprint and falls back to a deterministic per-incident line when the LLM
// is unavailable.

export type IncidentSummariesOutcome =
  | { ok: true; summaries: Record<string, string>; model: string }
  | { ok: false; error: string; retryAfterMs?: number };

// Standalone per-incident-summaries prompt. It reuses the SAME per-incident
// rules as the country brief's PER-INCIDENT SUMMARIES block, but asks for ONLY
// the incidentSummaries object (no narrative sections), since these reports own
// their own narrative elsewhere.
const INCIDENT_SUMMARIES_SYSTEM_PROMPT = `You are a senior security-intelligence analyst writing short per-incident summaries for the Related Incidents table of a corporate security report. You are given a numbered list of incidents and you write one concise factual analyst summary for each.

GROUNDING — non-negotiable:
- Ground each summary ONLY on that incident's own title and summary line — never on any other incident or outside knowledge. Do not invent, infer or add facts, casualty figures, numbers, dates, place names, group names or attributions that are not in that incident's own text.
- State plainly what happened, where, who or what was affected, and the operational implication for staff movement, site access or continuity ONLY where that incident's own text supports it.
- One sentence is usually enough; use two only when the incident's text genuinely carries that much. When the source text is thin, keep it short rather than padding.

WRITING RULES:
- Do NOT state numeric counts of incidents or records (e.g. "three incidents", "2 records").
- Do NOT repeat the incident's title verbatim.
- Severity words, when used, must be EXACTLY one of: Insignificant, Low, Moderate, High, Extreme. Use no other severity words and never overstate.
- Never use slash-joined category labels (e.g. "crime / public safety"); write natural prose.
- Do NOT mention any internal tools, systems, software, dashboards, data pipelines, de-duplication, relevance screening, geocoding, "open-source reporting" or how the data was collected. Write as the analyst, about the incident — not about the process.
- British English. Professional, neutral register. No hyperbole, no emojis, no markdown.

Return STRICT JSON with EXACTLY this shape and no other keys:
{
  "incidentSummaries": object  // Keys are the incident NUMBERS from the INCIDENTS list as strings ("1", "2", ...); each value is that incident's factual summary as described above. Include an entry for every numbered incident.
}
Return ONLY the JSON object.`;

/**
 * Deterministic fingerprint of the incident set the per-incident summaries are
 * grounded on. Hashes the SAME canonical/capped set the model is given, so the
 * cache hits for identical data and any change to the incidents flips it.
 */
export function computeIncidentSummariesFingerprint(input: {
  scope: string;
  incidents: ProseIncidentInput[];
}): string {
  const ids = canonicalIncidents(input.incidents).map(incidentIdentity);
  const payload = JSON.stringify({
    v: PROSE_PROMPT_VERSION,
    kind: "incident-summaries",
    scope: input.scope,
    ids,
  });
  return createHash("sha256").update(payload).digest("hex");
}

async function callSummariesOnce(
  incidents: ProseIncidentInput[],
): Promise<IncidentSummariesOutcome> {
  const cfg = readOpenAiConfig();
  if (!cfg) return { ok: false, error: "llm-unavailable" };
  const { baseUrl: base, apiKey: key } = cfg;

  const userPrompt = [
    "INCIDENTS (the ONLY source of facts; write one summary per numbered item):",
    incidentBlock(incidents),
  ].join("\n");

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
          { role: "system", content: INCIDENT_SUMMARIES_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
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
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (!content) return { ok: false, error: `empty-content(${choice?.finish_reason ?? "?"})` };

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return { ok: false, error: "bad-json" };
      try {
        raw = JSON.parse(m[0]);
      } catch {
        return { ok: false, error: "bad-json" };
      }
    }
    if (!raw || typeof raw !== "object") return { ok: false, error: "bad-json" };
    const summaries = mapIncidentSummaries(
      (raw as Record<string, unknown>).incidentSummaries,
      incidents,
    );
    if (Object.keys(summaries).length === 0) return { ok: false, error: "bad-json" };
    return { ok: true, summaries, model: MODEL };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: ac.signal.aborted ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Generate per-incident summaries with retries + exponential backoff. */
export async function generateIncidentSummaries(
  incidents: ProseIncidentInput[],
  retries = 2,
): Promise<IncidentSummariesOutcome> {
  let last: IncidentSummariesOutcome = { ok: false, error: "not-attempted" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await callSummariesOnce(incidents);
    if (last.ok) return last;
    const retryable = isRetryableProseError(last.error);
    if (!retryable || attempt === retries) return last;
    const serverHint = !last.ok ? last.retryAfterMs : undefined;
    const backoff = serverHint ?? 1000 * Math.pow(2, attempt);
    const jitter = Math.random() * 500;
    await new Promise((r) => setTimeout(r, Math.min(backoff, 15000) + jitter));
  }
  return last;
}
