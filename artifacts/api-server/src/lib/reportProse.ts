// AI topic-report prose engine.
//
// Generates the narrative sections of a TOPIC report (shipping, conflict, fuel,
// cargo, energy, fertiliser, flashpoint/protests/strikes) grounded STRICTLY on
// the actual window incidents the report renders (the same set that drives the
// Fast Facts, charts and Related Incidents table). The result is cached by a
// fingerprint of that incident set keyed by report id, so the model is only ever
// called when the underlying data changes — keeping cost negligible AND ensuring
// the prose can never go stale.
//
// This is the topic-report sibling of countryProse.ts. It reuses that module's
// incident canonicalisation / fingerprint identity / retry classifier and the
// shared Replit OpenAI client config so an unavailable model degrades gracefully
// (the caller falls back to the deterministic draftTopicReportProse template)
// instead of failing the report.

import { createHash } from "node:crypto";
import type { TopicProseSections } from "@workspace/db";
import { isLlmAvailable, openAiProseModel, readOpenAiConfig } from "@workspace/ingest";
import {
  canonicalIncidents,
  incidentIdentity,
  incidentBlock,
  isRetryableProseError,
  MAX_PROSE_INCIDENTS_ACCEPTED,
  stripProseCountAnnotations,
  type ProseIncidentInput,
} from "./countryProse";

const MODEL = openAiProseModel();
const REQUEST_TIMEOUT_MS = 60000;
const MAX_COMPLETION_TOKENS = 8192;

// Bump when the prompt or section contract changes so existing cache rows are
// treated as stale and regenerated. Kept SEPARATE from the country brief's
// PROSE_PROMPT_VERSION so bumping one never needlessly invalidates the other.
export const REPORT_PROSE_PROMPT_VERSION = "v1";

export { isLlmAvailable, MAX_PROSE_INCIDENTS_ACCEPTED };
export type { ProseIncidentInput };

export interface GenerateReportProseInput {
  topic: string;
  title: string;
  periodWord: string;
  basisDays: number;
  issueDate: string;
  incidents: ProseIncidentInput[];
  /** Pre-calculated FIXED FACTS block (fuel): canonical counts, rankings and
   *  market directions computed deterministically by the client's facts
   *  builder. The model must treat these as authoritative — it may explain
   *  them, never recalculate or contradict them. */
  facts?: string | null;
}

export type ReportProseOutcome =
  | { ok: true; sections: TopicProseSections; model: string }
  | { ok: false; error: string; retryAfterMs?: number };

// Human label + one-line scope for each topic, fed into the prompt so the model
// frames the narrative around the right subject matter (vessel/chokepoint risk
// vs cargo theft vs fuel cost-and-continuity, etc.) without us hand-writing a
// separate prompt per topic. protests is folded onto flashpoint's civil-unrest
// framing; an unknown topic falls back to a generic security-report framing.
const TOPIC_PROSE_META: Record<
  string,
  { label: string; focus: string; polestarViewMinWords?: number }
> = {
  shipping: {
    label: "Shipping & Maritime Security",
    focus:
      "vessel attack, port and chokepoint disruption, route diversion, naval advisories and freight pressure across the tracked maritime theatres",
  },
  cargo_watch: {
    label: "Cargo Watch",
    focus:
      "cargo theft, hijack, pilferage, warehouse and depot loss, seal tampering and insider crime affecting goods in transit and storage",
    // Cargo Watch's HARD validation gate (cargoReportValidation.ts, spec
    // pt4/pt7) rejects a Polestar View under 120 words and blocks export.
    // The generation prompt must ask for the same minimum the gate enforces,
    // otherwise an AI narrative that reads as a perfectly good "bottom-line
    // judgement" in 3 sentences trips the gate every time. Keep this in sync
    // with the minimum in cargoReportValidation.ts if that spec value changes.
    polestarViewMinWords: 120,
  },
  fuel: {
    label: "Fuel Watch",
    focus:
      "fuel cost movement, shortage and supply continuity, subsidy and policy change, refinery and transport disruption, and fuel-related unrest — a cost-and-continuity market watch, not a casualty-grade event tracker",
  },
  fertiliser: {
    label: "Fertiliser Watch",
    focus:
      "fertiliser supply, price, export controls, production disruption and farmer pressure across the tracked region",
  },
  energy: {
    label: "Energy Watch",
    focus:
      "power outages, load shedding, grid disruption, generation shortfall and fuel-to-power issues across the tracked region",
  },
  conflict: {
    label: "Conflict Watch",
    focus:
      "armed violence, clashes, strikes on people and infrastructure, and the theatres carrying the most kinetic risk this period — rank by impact, not volume",
  },
  flashpoint: {
    label: "Protests & Civil Unrest",
    focus:
      "public-order activity, demonstrations, civil unrest, disruption to transport and access, and escalation risk",
  },
  protests: {
    label: "Protests & Civil Unrest",
    focus:
      "public-order activity, demonstrations, civil unrest, disruption to transport and access, and escalation risk",
  },
  strikes: {
    label: "Missile & Drone Strike Tracker",
    focus:
      "missile and drone strikes, the targets and infrastructure hit, and the theatres carrying the most kinetic risk this period",
  },
};

function metaFor(topic: string): { label: string; focus: string; polestarViewMinWords?: number } {
  return (
    TOPIC_PROSE_META[topic] ?? {
      label: "Security",
      focus: "the security developments recorded for this topic over the reporting window",
    }
  );
}

/**
 * Deterministic fingerprint of the inputs the topic prose is grounded on. Hashes
 * the SAME capped/canonical incident set the model is given (via the shared
 * canonicalIncidents/incidentIdentity from countryProse) plus the report's
 * identity and window, so the cache hits for identical data and any change to
 * the incidents, topic, title, issue date or basis window flips it and forces a
 * regenerate. Incidents beyond the cap cannot affect prose, so they cannot
 * affect the key.
 */
export function computeReportProseFingerprint(input: {
  reportId: number;
  topic: string;
  title: string;
  issueDate: string;
  basisDays: number;
  incidents: ProseIncidentInput[];
  facts?: string | null;
}): string {
  const ids = canonicalIncidents(input.incidents).map(incidentIdentity);
  const payload = JSON.stringify({
    v: REPORT_PROSE_PROMPT_VERSION,
    kind: "topic-prose",
    reportId: input.reportId,
    topic: input.topic,
    title: input.title,
    issueDate: input.issueDate,
    basisDays: input.basisDays,
    // The FIXED FACTS block is part of the grounding: when the calculated
    // facts change (market direction flips, leader changes), the cached
    // prose is stale and must regenerate.
    facts: input.facts ?? "",
    ids,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function systemPrompt(label: string, focus: string, polestarViewMinWords?: number): string {
  return `You are a senior security-intelligence analyst writing the ${label} report for corporate clients (security managers, travel-risk and operations teams). You write the way an experienced human analyst writes: specific, measured and genuinely useful. You are given the actual incidents recorded over a reporting window and you produce the narrative sections of the report.

This report covers ${focus}.

GROUNDING — non-negotiable:
- Every statement about what happened during the window must come ONLY from the supplied INCIDENTS. Do not invent or infer events, casualty figures, numbers, dates, place names, group names or attributions that are not present in the incident records.
- You MAY use well-established, uncontroversial context about the topic for framing — but never present background as if it happened during this window.
- If the window has few or no incidents, say so plainly and keep the narrative short. A quiet window reflects limited reporting, not the absence of risk: never imply the threat has gone away, and never fabricate activity to fill space.

WRITING RULES:
- This is a genuine analytical narrative, NOT a list of the incidents. Identify the themes, drivers and operational meaning the incidents add up to; the incident records are supporting detail, not the story.
- Each section does a DISTINCT job. Never repeat the same fact or sentence across sections; in particular do not restate the lead location or event type in more than one section.
- Do NOT state numeric counts of incidents or records in the prose (e.g. "three incidents", "2 records"). Counts appear elsewhere in the report.
- Severity words, when used, must be EXACTLY one of: Insignificant, Low, Moderate, High, Extreme. Use no other severity words and never overstate.
- Write concrete, information-dense sentences. Name the actual places, actors and event types from the incidents. No filler, no hedging boilerplate, no generic risk-management truisms.
- Write impersonally about the topic and its risk trajectory. NEVER address, name or label the reader or audience. Do not use words such as "corporate operators", "operators", "clients", "companies", "businesses", "organisations" or "the reader", and never write "[anyone] should expect ...". State what is likely to happen and where pressure is likely — not what a reader should expect. (The imperative actions in implications are the only place for direct advice, and even there name the action, not the audience.)
- Never use slash-joined category labels (e.g. "crime / public safety"); write natural prose.
- Do NOT mention any internal tools, systems, software, dashboards, data pipelines, de-duplication, relevance screening, geocoding, "open-source reporting" or how the data was collected. Write as the analyst, about the situation — not about the process.
- British English. Professional, neutral register. No hyperbole, no emojis, no markdown.

Return STRICT JSON with EXACTLY these keys and no others:
{
  "executiveSummary": string,  // 2-4 sentences: the headline judgement for this window — the dominant theme and what it means for operations now.
  "situation": string,         // The current operating picture for this topic: the standing backdrop framed against what this window actually shows.
  "whatHappened": string,      // Only the window's actual developments, told concretely with the specific places, actors and event types from the incidents — synthesised into a narrative, not enumerated.
  "whatMatters": string,       // Why it matters for staff movement, site access, supply or continuity, and where to focus attention.
  "implications": string[],    // 4-7 distinct concrete actions to take. Each a short imperative sentence. No numbering, no leading dash.
  "watchNext": string[],       // 4-7 specific forward indicators to monitor. Each short and specific. No "Watch for" prefix.
  "polestarView": string       // The bottom-line analyst judgement and the recommended operating posture.${
    polestarViewMinWords
      ? ` MUST be at least ${polestarViewMinWords} words (aim for ${polestarViewMinWords}-${polestarViewMinWords + 40}): cover the overall judgement, what the data does and does not support, reporting limitations, the near-term outlook and your confidence level, each as its own sentence.`
      : ""
  }
}
Return ONLY the JSON object.`;
}

function buildUserPrompt(input: GenerateReportProseInput): string {
  const facts = (input.facts ?? "").trim();
  return [
    `REPORT: ${input.title || metaFor(input.topic).label}`,
    `REPORTING WINDOW: ${input.periodWord} (rolling ${input.basisDays}-day window ending ${input.issueDate})`,
    "",
    ...(facts
      ? [
          "FIXED FACTS (pre-calculated deterministically from the report's data — AUTHORITATIVE):",
          facts,
          "You may explain these values and their operational meaning, but you must NEVER recalculate, round differently, contradict or replace them. Trend/direction wording must match the stated direction exactly. Never state numeric incident counts in prose regardless of these values.",
          "",
        ]
      : []),
    "INCIDENTS (the ONLY source of this-window facts):",
    incidentBlock(input.incidents),
  ].join("\n");
}

function coerceStr(v: unknown): string {
  return typeof v === "string" ? stripProseCountAnnotations(v.trim()) : "";
}

// implications / watchNext are stored as plain newline-joined strings so they
// map 1:1 onto the editor's textarea fields and the deterministic draft's shape.
// Accept either a JSON array (preferred) or an already-joined string.
function coerceJoined(v: unknown): string {
  if (typeof v === "string") return stripProseCountAnnotations(v.trim());
  if (Array.isArray(v)) {
    return stripProseCountAnnotations(
      v
        .map((x) =>
          typeof x === "string" ? x.trim().replace(/^[-*]\s*/, "") : "",
        )
        .filter(Boolean)
        .join("\n"),
    );
  }
  return "";
}

function parseTopicSections(content: string): TopicProseSections | null {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
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
  const sections: TopicProseSections = {
    executiveSummary: coerceStr(o.executiveSummary),
    situation: coerceStr(o.situation),
    whatHappened: coerceStr(o.whatHappened),
    whatMatters: coerceStr(o.whatMatters),
    implications: coerceJoined(o.implications),
    watchNext: coerceJoined(o.watchNext),
    polestarView: coerceStr(o.polestarView),
  };
  // Require the core paragraphs; the bullet lists may legitimately be short. If
  // the model returned an unusable shell, treat it as bad-json so the caller
  // retries and ultimately falls back to the deterministic template.
  if (
    !sections.executiveSummary ||
    !sections.situation ||
    !sections.whatHappened ||
    !sections.whatMatters ||
    !sections.polestarView
  ) {
    return null;
  }
  return sections;
}

async function callOnce(input: GenerateReportProseInput): Promise<ReportProseOutcome> {
  const cfg = readOpenAiConfig();
  if (!cfg) return { ok: false, error: "llm-unavailable" };
  const { baseUrl: base, apiKey: key } = cfg;

  const { label, focus, polestarViewMinWords } = metaFor(input.topic);

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
          { role: "system", content: systemPrompt(label, focus, polestarViewMinWords) },
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

    const sections = parseTopicSections(content);
    if (!sections) return { ok: false, error: "bad-json" };
    return { ok: true, sections, model: MODEL };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: ac.signal.aborted ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Generate topic-report prose with retries + exponential backoff. */
export async function generateReportProse(
  input: GenerateReportProseInput,
  retries = 2,
): Promise<ReportProseOutcome> {
  let last: ReportProseOutcome = { ok: false, error: "not-attempted" };
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
