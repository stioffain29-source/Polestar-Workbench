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
export const REPORT_PROSE_PROMPT_VERSION = "v5";
export const FUEL_REPORT_PROSE_PROMPT_VERSION = "v2";
export const FLASHPOINT_REPORT_PROSE_PROMPT_VERSION = "v1";
// Energy has a deliberately different section contract (notably its
// evidence-led Markdown headings), so its prompt change must invalidate only
// Energy rows. Keep the general topic version above stable: changing it would
// unnecessarily invalidate cached prose for every other topic.
export const ENERGY_REPORT_PROSE_PROMPT_VERSION = "v1";

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
  generationBasisFingerprint?: string | null;
  canonicalEvidenceIds?: string[];
}

/** Machine-readable support retained alongside rendered Fuel strings. */
export interface FuelAnalyticalProvenance {
  supportingIncidentIds: string[];
  supportingEvidenceFamilyIds: string[];
  supportingClaim?: string;
  /** Exact rendered item this binding was produced for. */
  verifiedText?: string;
}

export interface FuelSectionsProvenance {
  whatHappened?: FuelAnalyticalProvenance[];
  watchNext?: FuelAnalyticalProvenance[];
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
      "validated vessel, port, chokepoint and route developments across the tracked maritime theatres; commercial consequences only where explicitly reported",
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
  generationBasisFingerprint?: string | null;
  canonicalEvidenceIds?: string[];
}): string {
  const ids = canonicalIncidents(input.incidents).map(incidentIdentity);
  const payload = JSON.stringify({
    // Energy's prompt is versioned independently so changing its section
    // contract does not invalidate the other topic caches.
    v:
      input.topic === "energy"
        ? ENERGY_REPORT_PROSE_PROMPT_VERSION
        : input.topic === "fuel"
          ? FUEL_REPORT_PROSE_PROMPT_VERSION
          : input.topic === "flashpoint" || input.topic === "protests"
            ? FLASHPOINT_REPORT_PROSE_PROMPT_VERSION
        : REPORT_PROSE_PROMPT_VERSION,
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
    generationBasisFingerprint: input.generationBasisFingerprint ?? "",
    canonicalEvidenceIds: [...(input.canonicalEvidenceIds ?? [])].sort(),
    ids,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function systemPrompt(label: string, focus: string, polestarViewMinWords?: number): string {
  const isFlashpoint = label === "Protests & Civil Unrest";
  const maritimeGuardrails =
    label === "Shipping & Maritime Security"
      ? `
MARITIME GROUNDING — additional non-negotiable rules:
- Treat the supplied semantic incident classifications, physical locations, commercial targets, route relationships and explicitly evidenced consequences as authoritative.
- Do not turn naval, military, drone, exercise, advisory or movement/AIS context into a commercial incident unless the incident evidence explicitly identifies a commercial vessel, port or terminal target.
- Do not infer an incident country from a vessel flag, route name or chokepoint label. Use only the physical location stated in the incident evidence.
- Do not assert freight, insurance, rerouting, delay, transit-time, cost or cargo consequences unless that consequence is explicitly reported in the supplied incident evidence. Otherwise frame it conditionally as a watch item or omit it.
- Keep the overall maritime risk assessment separate from the highest individual incident severity. Do not invent a risk level or severity.
- Do not retell the same development in multiple sections or append a new unsupported event, location, route, target or consequence.
`
      : "";
  const energyGuardrails =
    label === "Energy Watch"
      ? `
ENERGY WATCH — additional non-negotiable rules:
- Keep "situation" genuinely brief: one short cross-cutting synthesis of the energy-system pattern in this window. It must not name a country, region, city, province, district, facility, grid, plant, site or other locality, and it must not retell an incident, date, actor or event-specific detail.
- Make "whatHappened" the substantive evidence-led section. Organise it with explicit Markdown level-two headings in the form "## Heading". Every heading must be a geography or issue label sourced from the supplied incident evidence; do not invent headings, use generic headings such as "Overview", or use a fixed country list. Use one heading per evidenced geography or issue, combine all facts belonging to that geography or issue beneath it, and never repeat a heading or its facts.
- Retain every unique source-supported detail in "whatHappened" exactly once, including distinct outage, supply, tariff, infrastructure and fuel-to-power evidence. Do not omit a detail to meet an arbitrary word, heading, geography or country cap, and do not pad thin evidence with generic prose.
- "whatMatters" must provide analytical implications of the evidence for continuity, access, dependencies, cost or resilience rather than another recap. Do not re-list the places, incidents or facts merely to summarise them.
- Every "watchNext" item must be a concrete, forward-looking indicator tied to a geography or issue and to evidence in the incident block. Do not use generic monitoring advice or invented indicators.
`
      : "";
  const fuelGuardrails =
    label === "Fuel Watch"
      ? `
FUEL EVIDENCE TRACEABILITY — additional non-negotiable rules:
- The supplied canonical current-period evidence IDs are the complete authority for current Fuel themes. Do not introduce a country, shortage, refinery behaviour, transport disruption, aviation restriction, bunker-fuel or strike theme without a supporting supplied ID.
- Return whatHappened as an array of objects, each containing text, supportingEvidenceIds and supportingClaim. Return watchNext in the same shape. supportingClaim must be copied exactly from a supported claim shown for one cited record; do not invent or paraphrase claims.
- The parser renders the verified claim for whatHappened, so an unsupported paraphrase cannot survive. For watchNext, include the exact parent claim in the text plus explicit future/conditional modality. Potential evidence can support Watch Next only in that conditional form; it cannot support current whatHappened.
- Write whatMatters as 2-4 concise analytical paragraphs. Prioritise the most material developments, explain where exposure sits and state the near-term direction; do not summarise every incident or merely restate the risk rating.
- Write implications as one coherent 70-120 word paragraph describing commercial and operational consequences supported by the evidence. Cover only relevant effects on delivered fuel cost, transport and logistics cost, aviation surcharges, supplier pricing, replenishment times, stock resilience, operational continuity, routing and landed cost. This is analysis, not advice: never begin a sentence with Review, Check, Consider, Revisit or Test, and do not disguise recommendations as implications.
- Write polestarView as a 70-120 word assessment, not a summary. State the Polestar risk level and distinguish the evidenced mix of price pressure, physical supply constraint, refinery or terminal disruption, distribution constraint and routing or chokepoint exposure. Identify the principal business exposure and near-term direction. Do not repeat whatMatters or implications.
- Write watchNext as one forward-looking 50-90 word analytical paragraph. Identify multiple specific evidence-led indicators that would materially change the assessment and explain what they would mean. Relevant indicators can include refinery restart dates, terminal throughput, allocation changes, shortages, delivery times, vessel rerouting, chokepoint restrictions, government action and significant benchmark movements. Do not use repetitive "Watch for" sentence openings.
- Every one of those four sections must answer at least two of: what is changing, why it matters, where exposure sits, what could happen next, and what action is required. Do not pad or invent facts to reach the requested length.
- implications, polestarView and watchNext must each contain at least two substantive sentences. One-line placeholders such as "prices are rising" or "watch for changes in transit availability" are invalid.
- Never use "concentrated around", "practical aviation and distribution constraint", "route flexibility", "operational posture", "pressure point", "fuel assurance", or "cost controls".
`
      : "";
  const conflictGuardrails =
    label === "Conflict Watch"
      ? `
CONFLICT WATCH TRACEABILITY — additional non-negotiable rules:
- The supplied current canonical incident IDs are the complete authority for
  current conflict themes. Do not introduce a current event, location, actor,
  casualty or escalation theme without citing a supplied ID.
- Return watchNext as an array of objects, each containing text and
  supportingIncidentIds. Every item must cite at least one supplied current
  incident ID and must be explicitly forward-looking or conditional.
- Context may frame the judgement only when clearly described as background; it
  cannot change current incident counts, peak severity, latest incident or
  geographic concentration.
`
      : "";
  const flashpointGuardrails =
    isFlashpoint
      ? `
FLASHPOINT NARRATIVE — section-specific instructions:
- WHAT MATTERS: Summarise the most important developments in analytical prose. Do not concatenate raw headlines, locations or source snippets. Explain which developments matter most, where the main exposure sits, whether disruption is localised or broader, and whether activity is routine, increasing or materially different from the normal pattern. Use only the accepted incident data supplied to the report.
- IMPLICATIONS FOR BUSINESS: Explain the likely business consequences of the reported protest and unrest environment. Where supported, cover staff movement, site access, transport disruption, delivery schedules, public transport, workforce attendance, supplier or client movement, and business continuity. This is analysis, not advice. Do not write instructions and avoid sentence openings such as Review, Confirm, Check, Monitor or Track.
- POLESTAR VIEW: Provide a genuine assessment using existing Polestar risk terminology. Distinguish the overall weekly posture from the highest single incident rating. Explain the principal geographic and operational exposures, whether activity is concentrated or broadening, the near-term direction, and what evidence would materially strengthen or weaken the assessment. Do not turn this section into recommendations.
- WATCH NEXT: Use the supplied seven-day protest forecast as the evidence base where forecast entries are present. Prioritise, rather than repeat, the scheduled events most likely to affect transport, site access, staff movement, significant public spaces, and major government or commercial areas. Explain why the priority events matter and identify indicators of escalation, wider mobilisation or greater operational disruption. Avoid repetitive Watch for, Track or Monitor openings.
- Keep these four sections concise, analytical and grounded in accepted Flashpoint data. Avoid raw scraped wording, obvious headline fragments and repetition of the same conclusion across sections. Do not invent facts.
`
      : "";
  const proseFormatRule =
    label === "Energy Watch"
      ? "- British English. Professional, neutral register. No hyperbole or emojis. Markdown level-two headings are permitted ONLY inside the energy `whatHappened` string, as required above; do not use Markdown elsewhere."
      : "- British English. Professional, neutral register. No hyperbole, no emojis, no markdown.";
  const concreteWritingRule =
    label === "Energy Watch"
      ? "- Write concrete, information-dense sentences. Name actual places, actors and event types from the incidents where the section calls for them; in `situation`, follow the dedicated no-locality, no-incident-retelling rule above. No filler, no hedging boilerplate, no generic risk-management truisms."
      : "- Write concrete, information-dense sentences. Name the actual places, actors and event types from the incidents. No filler, no hedging boilerplate, no generic risk-management truisms.";
  return `You are a senior security-intelligence analyst writing the ${label} report for corporate clients (security managers, travel-risk and operations teams). You write the way an experienced human analyst writes: specific, measured and genuinely useful. You are given the actual incidents recorded over a reporting window and you produce the narrative sections of the report.

This report covers ${focus}.
${maritimeGuardrails}
${energyGuardrails}
${fuelGuardrails}
${conflictGuardrails}
${flashpointGuardrails}

GROUNDING — non-negotiable:
- Every statement about what happened during the window must come ONLY from the supplied INCIDENTS. Do not invent or infer events, casualty figures, numbers, dates, place names, group names or attributions that are not present in the incident records.
- You MAY use well-established, uncontroversial context about the topic for framing — but never present background as if it happened during this window.
- If the window has few or no incidents, say so plainly and keep the narrative short. A quiet window reflects limited reporting, not the absence of risk: never imply the threat has gone away, and never fabricate activity to fill space.

WRITING RULES:
- This is a genuine analytical narrative, NOT a list of the incidents. Identify the themes, drivers and operational meaning the incidents add up to; the incident records are supporting detail, not the story.
- Each section does a DISTINCT job. Never repeat the same fact or sentence across sections; in particular do not restate the lead location or event type in more than one section.
- Do NOT state numeric counts of incidents or records in the prose (e.g. "three incidents", "2 records"). Counts appear elsewhere in the report.
- Severity words, when used, must be EXACTLY one of: Insignificant, Low, Moderate, High, Extreme. Use no other severity words and never overstate.
${concreteWritingRule}
- Write impersonally about the topic and its risk trajectory. NEVER address, name or label the reader or audience. Do not use words such as "corporate operators", "operators", "clients", "companies", "businesses", "organisations" or "the reader", and never write "[anyone] should expect ...". State what is likely to happen and where pressure is likely — not what a reader should expect. (The imperative actions in implications are the only place for direct advice, and even there name the action, not the audience.)
- Never use slash-joined category labels (e.g. "crime / public safety"); write natural prose.
- Do NOT mention any internal tools, systems, software, dashboards, data pipelines, de-duplication, relevance screening, geocoding, "open-source reporting" or how the data was collected. Write as the analyst, about the situation — not about the process.
${proseFormatRule}
- PARAGRAPHING: any prose section longer than about 70 words MUST be split into 2-3 short paragraphs separated by a blank line (a literal "\n\n" inside the JSON string). Never return a single unbroken wall of text.

PLAIN-ENGLISH RULES — mandatory:
- Use plain, easy-to-read English. Short, direct sentences with a clear subject. Every sentence must be understandable on first reading by a non-specialist.
${isFlashpoint
  ? "- For each significant development used in these four narrative sections, explain its operational meaning without turning the analysis into instructions."
  : "- For each significant development: explain the event, its likely business impact, and the action required."}
- BANNED phrasings — never use these or close variants: "the week reads as", "reads as", "the practical weight sits", "the picture is led by", "the picture", "activity is being driven by", "driven by protest activity", "mostly protests and organised action", "two different readings sit side by side", "on the reported record", "weighted towards", "operating posture", "Overall protest posture this week", "Risk level:", "the sharper case", "where events fall on the areas the business uses", "sections follow", "the practical risk this week was", "posture weighs volume".
- Never copy an article headline into a sentence. Rewrite the information as normal prose.
- Never confuse the number of events with their severity. If one country has more events but another has a more serious incident, state both plainly.
- Keep contained incidents in context. An event inside a prison or other closed facility, however serious, is not evidence of wider public disorder — say so explicitly.
- The same incident must carry ONE severity rating everywhere it is mentioned; never give one event two different ratings.
- Business impact must name practical consequences: road closures, public-transport delays, staff travel disruption, restricted site access, the need to update staff.
- Do not add wider claims or implications that the incident records do not support.

Return STRICT JSON with EXACTLY these keys and no others:
{
  "executiveSummary": string,  // 2-4 sentences: the headline judgement for this window — the dominant theme and what it means for operations now.
  "situation": string,         // The current operating picture for this topic: the standing backdrop framed against what this window actually shows.
   "whatHappened": ${label === "Fuel Watch" ? "object[] (each {text, supportingEvidenceIds, supportingClaim})" : "string"},      // Only the window's actual developments, told concretely with the specific places, actors and event types from the incidents — synthesised into a narrative, not enumerated.
  "whatMatters": string,       // ${isFlashpoint ? "Analytical synthesis of the most important developments, main exposure, disruption breadth and direction; never a headline list." : "Why it matters for staff movement, site access, supply or continuity, and where to focus attention."}
  "implications": string[],    // ${isFlashpoint ? "2-4 concise analytical statements explaining likely business consequences. Not instructions; no imperative sentence openings." : "4-7 distinct concrete actions to take. Each a short imperative sentence. No numbering, no leading dash."}
   "watchNext": ${label === "Fuel Watch" ? "object[] (each {text, supportingEvidenceIds, supportingClaim})" : label === "Conflict Watch" ? "object[] (each {text, supportingIncidentIds})" : "string[]"},       // ${isFlashpoint ? "Prioritised seven-day forecast developments and escalation indicators, with why they matter. Do not repeat every entry or use repetitive command openings." : "4-7 specific forward indicators to monitor. Each short and specific. No \"Watch for\" prefix."}
  "polestarView": string       // ${isFlashpoint ? "The overall weekly Polestar assessment, distinct from the highest single incident rating, covering exposure, concentration, direction and evidence that would change the assessment. No recommendations." : "The bottom-line analyst judgement with useful advice: state the appropriate risk level, where disruption is most likely, and what to do. Do not repeat the incident summary."}${
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
          "STYLE RULES for these facts:",
          '- Express direction with natural verbs — "fell", "eased", "rose", "climbed", "was flat". Never interpolate the raw direction word into a sentence (e.g. never write "moved falling" or "all moved falling"; write "all fell").',
          "- Never copy an incident headline's price-move clause when it contradicts FIXED FACTS. If jet fuel direction is rising, do not write that jet fuel costs eased, fell, declined or dropped — describe the operational event (airline pricing dispute, surcharge talks) without asserting the contrary move. The same rule applies to Brent, WTI and crude.",
          "- Never reproduce the country list as a bare enumeration with a shared verb (e.g. \"Iraq, Saudi Arabia carry...\"). If a country matters, give it its own clause grounded in what actually happened there.",
          "- Downstream impacts (aviation fuel supply, airport resupply, road distribution) may be stated as CURRENT effects only when a listed observed condition directly supports them; otherwise frame them conditionally or as watch items (\"if the outage extends...\", \"would come under pressure\").",
          "- Operational consequences that follow from an event type but were not reported (allocation, rationing, pass-through) must be framed as typical/conditional, never asserted as fact for this window.",
          "",
        ]
      : []),
    "INCIDENTS (the ONLY source of this-window facts):",
    incidentBlock(input.incidents),
    ...(input.topic === "fuel" || input.topic === "conflict"
      ? [
          "",
          `CANONICAL CURRENT INCIDENT IDS: ${(input.canonicalEvidenceIds ?? []).join(", ") || "none"}`,
          input.topic === "fuel"
            ? "Fuel traceability contract: return whatHappened as an array of objects with `text`, `supportingEvidenceIds`, and `supportingClaim`; return watchNext as an array of objects with `text`, `supportingEvidenceIds`, and `supportingClaim`. supportingClaim MUST be copied exactly from a supported claim supplied for one cited canonical record. Every factual whatHappened paragraph and every watchNext item MUST carry at least one verified claim. Potential evidence may support Watch Next only when the text is explicitly future/conditional; it must not support current whatHappened."
            : "Conflict traceability contract: return watchNext as an array of objects with `text` and `supportingIncidentIds`. Every item must cite at least one supplied canonical current incident ID and use future or conditional language.",
        ]
      : []),
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

// Claims are the only machine-verifiable semantic contract for Fuel AI
// material. IDs establish which records may be cited; this normalized exact
// comparison establishes what those records actually support. No topic or
// country vocabulary is embedded here.
function normalizeSupportedClaim(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function isExplicitlyConditional(text: string): boolean {
  return /\b(?:if|may|might|could|possible|possibly|potential|risk|uncertain|monitor|watch|subject to|contingent|would)\b/i
    .test(text);
}

function substantiveSentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).filter(Boolean).length >= 6)
    .length;
}

function proseWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function parseTopicSections(
  content: string,
  input?: GenerateReportProseInput,
): TopicProseSections | null {
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
  if (input?.topic === "fuel") {
    const validIds = new Set(
      (input.canonicalEvidenceIds ?? []).filter((id) => id.trim() && id !== "0"),
    );
    const statusById = new Map(
      input.incidents.map((incident) => [
        incident.evidenceId ?? incident.id ?? "",
        incident.evidenceStatus ?? "Reported",
      ]),
    );
    const traceableItems = (
      value: unknown,
      section: "whatHappened" | "watchNext",
    ): { text: string; provenance: FuelAnalyticalProvenance }[] => {
      const items = Array.isArray(value) ? value : [value];
      return items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const text = typeof row.text === "string"
          ? row.text.trim()
          : typeof row.paragraph === "string"
            ? row.paragraph.trim()
            : "";
        const ids = Array.isArray(row.supportingEvidenceIds)
          ? row.supportingEvidenceIds.filter((id): id is string => typeof id === "string")
          : Array.isArray(row.evidenceIds)
            ? row.evidenceIds.filter((id): id is string => typeof id === "string")
            : [];
        const valid = ids.filter((id) => validIds.has(id));
        const supportingClaim = typeof row.supportingClaim === "string"
          ? row.supportingClaim
          : typeof row.supportedClaim === "string"
            ? row.supportedClaim
            : "";
        if (!text || valid.length === 0 || !supportingClaim) return [];
        const claimNorm = normalizeSupportedClaim(supportingClaim);
        if (!claimNorm) return [];
        const bindings = valid.flatMap((id) => {
          const incident = input.incidents.find(
            (candidate) => (candidate.evidenceId ?? candidate.id ?? "") === id,
          );
          if (!incident) return [];
          const claim = (incident.supportedClaims ?? []).find(
            (candidate) => normalizeSupportedClaim(candidate) === claimNorm,
          );
          return claim
            ? [{ id, claim, status: statusById.get(id) ?? "Reported" }]
            : [];
        });
        if (!bindings.length) return [];
        const provenance: FuelAnalyticalProvenance = {
          supportingIncidentIds: [
            ...new Set(
              bindings.map(({ id }) => {
                const incident = input.incidents.find(
                  (candidate) => (candidate.evidenceId ?? candidate.id ?? "") === id,
                );
                return incident?.id ?? id;
              }),
            ),
          ],
          supportingEvidenceFamilyIds: [
            ...new Set(
              bindings
                .map(({ id }) =>
                  input.incidents.find(
                    (candidate) => (candidate.evidenceId ?? candidate.id ?? "") === id,
                  )?.evidenceFamilyId,
                )
                .filter((id): id is string => Boolean(id)),
            ),
          ],
        };
        if (section === "whatHappened") {
          // Mixed citations are valid when one cited non-Potential record
          // verifies the claim; a Potential extra citation does not poison it.
          const current = bindings.find((binding) => binding.status !== "Potential");
          return current
            ? [{
                text: current.claim,
                provenance: {
                  ...provenance,
                  supportingClaim: current.claim,
                  verifiedText: current.claim,
                },
              }]
            : [];
        }
        if (
          !isExplicitlyConditional(text) ||
          !normalizeSupportedClaim(text).includes(claimNorm)
        ) return [];
        // Rebuild from the verified claim rather than rendering the model's
        // free-form paraphrase. Novel entities/themes cannot survive.
        const watchText = `Monitor whether ${bindings[0].claim.replace(/[.!?]+$/, "")}.`;
        return [{
          text: watchText,
          provenance: {
            ...provenance,
            supportingClaim: bindings[0].claim,
            verifiedText: watchText,
          },
        }];
      });
    };
    // A legacy string is deliberately not accepted for these two Fuel fields:
    // it has no way to prove current-period support. Other topics retain the
    // existing string API and parser unchanged.
    const happened = traceableItems(o.whatHappened, "whatHappened");
    const watch = traceableItems(o.watchNext, "watchNext");
    sections.whatHappened = happened.map((item) => item.text).join("\n\n");
    sections.implications = sections.implications.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    sections.watchNext = watch.map((item) => item.text).join(" ");
    sections.provenance = {
      whatHappened: happened.map((item) => item.provenance),
      watchNext: watch.map((item) => item.provenance),
    };
    // Do not discard an otherwise valid analytical narrative when the model's
    // evidence binding for this one section is unusable. The publication
    // resolver replaces a blank What Happened with the canonical deterministic
    // section; retaining the other valid sections avoids collapsing the whole
    // report into thin fallback prose.
  }
  if (input?.topic === "conflict") {
    // Conflict Watch has no claim ledger like Fuel, so the binding is the
    // canonical current incident ID set itself. A legacy/free-form string is
    // rejected: without IDs it can carry stale locations or escalation themes
    // across a changed report window.
    const canonicalIds = new Set(
      (input.canonicalEvidenceIds?.length
        ? input.canonicalEvidenceIds
        : input.incidents.map((incident) => incident.id ?? ""))
        .map((id) => String(id))
        .filter((id) => id.trim() && id !== "0"),
    );
    const traceableItems = Array.isArray(o.watchNext) ? o.watchNext : [];
    const watch = traceableItems.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const text = typeof row.text === "string"
        ? row.text.trim()
        : typeof row.item === "string"
          ? row.item.trim()
          : "";
      const rawIds =
        Array.isArray(row.supportingIncidentIds)
          ? row.supportingIncidentIds
          : Array.isArray(row.incidentIds)
            ? row.incidentIds
            : Array.isArray(row.evidenceIds)
              ? row.evidenceIds
              : [];
      const ids = rawIds
        .filter(
          (id): id is string | number =>
            typeof id === "string" || typeof id === "number",
        )
        .map(String)
        .filter((id) => canonicalIds.has(id));
      if (!text || ids.length === 0 || !isExplicitlyConditional(text)) return [];
      const supportingIncidentIds = [
        ...new Set(
          ids.flatMap((id) => {
            const incident = input.incidents.find(
              (candidate) =>
                String(candidate.id ?? "") === id ||
                String(candidate.evidenceId ?? "") === id,
            );
            return incident?.id != null ? [String(incident.id)] : [];
          }),
        ),
      ];
      if (!supportingIncidentIds.length) return [];
      return [{
        text,
        provenance: {
          supportingIncidentIds,
          supportingEvidenceFamilyIds: [],
          verifiedText: text,
        },
      }];
    });
    sections.watchNext = watch.map((item) => item.text).join("\n");
    sections.provenance = {
      ...(sections.provenance ?? {}),
      watchNext: watch.map((item) => item.provenance),
    };
  }
  // Require the core paragraphs; the bullet lists may legitimately be short. If
  // the model returned an unusable shell, treat it as bad-json so the caller
  // retries and ultimately falls back to the deterministic template.
  if (
    !sections.executiveSummary ||
    !sections.situation ||
    (input?.topic !== "fuel" && !sections.whatHappened) ||
    !sections.whatMatters ||
    !sections.polestarView
  ) {
    return null;
  }
  if (input?.topic === "fuel") {
    const fuelQuality = [
      { text: sections.whatMatters, minWords: 60, maxWords: 160, minSentences: 2 },
      { text: sections.implications, minWords: 70, maxWords: 120, minSentences: 2 },
      { text: sections.polestarView, minWords: 70, maxWords: 120, minSentences: 2 },
      { text: sections.watchNext, minWords: 50, maxWords: 90, minSentences: 2 },
    ];
    if (fuelQuality.some(({ text, minWords, maxWords, minSentences }) => {
      const words = proseWordCount(text);
      return words < minWords || words > maxWords || substantiveSentenceCount(text) < minSentences;
    })) {
      return null;
    }
    const whatMattersParagraphs = sections.whatMatters
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    if (
      whatMattersParagraphs.length < 2 ||
      whatMattersParagraphs.length > 4 ||
      /(?:^|[.!?]\s+)(?:Review|Check|Consider|Revisit|Test)\b/i.test(sections.implications) ||
      (sections.watchNext.match(/\bWatch for\b/gi)?.length ?? 0) > 0
    ) {
      return null;
    }
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

    const sections = parseTopicSections(content, input);
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
