import {
  MARITIME_COMMERCIAL_TARGETS,
  MARITIME_CONSEQUENCE_KINDS,
  MARITIME_CONSEQUENCE_STATUSES,
  MARITIME_EVENT_CLASSES,
  MARITIME_ROUTE_RELATIONSHIP_KINDS,
  MARITIME_SEMANTIC_VERSION,
  MARITIME_SEVERITIES,
  MARITIME_VALIDITY_STATUSES,
  maritimeNeedsReview,
  validateMaritimeSemanticContract,
  type MaritimeSemanticEvidence,
  type MaritimeSemanticInput,
} from "@workspace/relevance";
import { openAiFastModel, readOpenAiConfig } from "./openaiConfig";

export { MARITIME_SEMANTIC_VERSION };
export type MaritimeValidityStatus = MaritimeSemanticEvidence["verdict"];

export function isMaritimeSemanticProviderConfigured(): boolean {
  return Boolean(readOpenAiConfig());
}

const SYSTEM = `You validate a proposed maritime news item. Return only JSON
matching the requested schema. Classify what the source actually reports, not
what title keywords suggest.

Require a discrete reported or credibly scheduled maritime event. Distinguish
commercial attack, commercial seizure, piracy/armed robbery, port disruption,
chokepoint disruption, route disruption, geopolitical maritime development and
military/naval activity. A mention of shipping, a ship class, a sea lane, or a
naval target does not validate a commercial target. commercialTargetValidated
is true only when the source positively identifies a commercial vessel, cargo,
port facility, or shipping operation as the affected target. Military/naval
activity is context unless this target test is met.

physicalLocation is where the event occurred and physicalLocationEvidence is
source-grounded evidence. Unknown geography is allowed: leave physicalLocation,
country, and coastalState null when unsupported. Never infer country from vessel
flag, operator nationality, company headquarters, publisher/feed country, route,
trade relationship, or analyst/feed-assigned country. Any assignedCountry or
assignedLocation in the input is a non-authoritative legacy hint and must not
be copied without matching source evidence.

routeRelationship.kind must be exactly physical, direct_passage, indirect, or
none. routeName/evidence describe route relevance and never substitute for event
location. routingConsequence is separate from event origin. commercialConsequence
must distinguish confirmed source-reported operating effect from analyst
assessment; either non-none status requires a claim and source quote. Do not
turn expected, hypothetical, or possible rerouting into a confirmed consequence.
Severity requires a source-grounded justification and quote. Include concise
sourceQuotes for all material claims. Every evidenceQuote and sourceQuotes.quote
must be copied verbatim from the supplied title/summary (punctuation may differ
only trivially); never paraphrase an evidence quote. If the source does not
provide a verbatim quote for a claim, leave that claim null or return
needs_review.

Assign a developmentKey stable across syndicated rewrites of one development;
use a new key for material reopening, closure, escalation, new victim/target, or
other material change. If facts are ambiguous, contradictory, or unavailable,
return needs_review.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "eventOccurred",
    "eventClass",
    "commercialTargetValidated",
    "commercialTarget",
    "commercialTargetName",
    "commercialTargetEvidence",
    "physicalLocation",
    "physicalLocationEvidence",
    "country",
    "coastalState",
    "routeRelationship",
    "routingConsequence",
    "commercialConsequence",
    "geopolitical",
    "eventDate",
    "developmentKey",
    "severity",
    "severityJustification",
    "severityEvidenceQuote",
    "confidence",
    "contradictions",
    "sourceQuotes",
    "evidence",
    "verdict",
    "reason",
  ],
  properties: {
    eventOccurred: { type: ["boolean", "null"] },
    eventClass: {
      type: ["string", "null"],
      enum: [...MARITIME_EVENT_CLASSES, null],
    },
    commercialTargetValidated: { type: "boolean" },
    commercialTarget: {
      type: "string",
      enum: [...MARITIME_COMMERCIAL_TARGETS],
    },
    commercialTargetName: { type: ["string", "null"] },
    commercialTargetEvidence: { type: ["string", "null"] },
    physicalLocation: { type: ["string", "null"] },
    physicalLocationEvidence: { type: ["string", "null"] },
    country: { type: ["string", "null"] },
    coastalState: { type: ["string", "null"] },
    routeRelationship: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "routeName", "evidence"],
      properties: {
        kind: { type: "string", enum: [...MARITIME_ROUTE_RELATIONSHIP_KINDS] },
        routeName: { type: ["string", "null"] },
        evidence: { type: ["string", "null"] },
      },
    },
    routingConsequence: {
      type: "object",
      additionalProperties: false,
      required: [
        "status",
        "claim",
        "evidenceQuote",
        "confidence",
        "kind",
        "description",
        "evidence",
      ],
      properties: {
        status: { type: "string", enum: [...MARITIME_CONSEQUENCE_STATUSES] },
        claim: { type: ["string", "null"] },
        evidenceQuote: { type: ["string", "null"] },
        confidence: { type: "number" },
        kind: { type: "string", enum: [...MARITIME_CONSEQUENCE_KINDS] },
        description: { type: ["string", "null"] },
        evidence: { type: ["string", "null"] },
      },
    },
    commercialConsequence: {
      type: "object",
      additionalProperties: false,
      required: ["status", "claim", "evidenceQuote", "confidence"],
      properties: {
        status: { type: "string", enum: [...MARITIME_CONSEQUENCE_STATUSES] },
        claim: { type: ["string", "null"] },
        evidenceQuote: { type: ["string", "null"] },
        confidence: { type: "number" },
      },
    },
    geopolitical: {
      type: "object",
      additionalProperties: false,
      required: ["relevant", "claim", "evidenceQuote"],
      properties: {
        relevant: { type: "boolean" },
        claim: { type: ["string", "null"] },
        evidenceQuote: { type: ["string", "null"] },
      },
    },
    eventDate: { type: ["string", "null"] },
    developmentKey: { type: ["string", "null"] },
    severity: { type: ["string", "null"], enum: [...MARITIME_SEVERITIES, null] },
    severityJustification: { type: ["string", "null"] },
    severityEvidenceQuote: { type: ["string", "null"] },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: [
        "event",
        "classification",
        "commercialTarget",
        "geography",
        "routeRelationship",
        "consequence",
        "date",
      ],
      properties: {
        event: { type: "number" },
        classification: { type: "number" },
        commercialTarget: { type: "number" },
        geography: { type: "number" },
        routeRelationship: { type: "number" },
        consequence: { type: "number" },
        date: { type: "number" },
      },
    },
    contradictions: { type: "array", items: { type: "string" } },
    sourceQuotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "claim"],
        properties: {
          quote: { type: "string" },
          claim: { type: "string" },
        },
      },
    },
    evidence: { type: "array", items: { type: "string" } },
    verdict: { type: "string", enum: [...MARITIME_VALIDITY_STATUSES] },
    reason: { type: "string" },
  },
} as const;

function normalizeDate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  const match = text.match(
    /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  return match && Number.isFinite(Date.parse(text)) ? match[1] : text;
}

function clampText(value: unknown, max = 400): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeQuotes(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") return item;
    return {
      quote: clampText((item as { quote?: unknown }).quote),
      claim: clampText((item as { claim?: unknown }).claim),
    };
  });
}

export async function validateMaritimeEvent(
  input: MaritimeSemanticInput,
): Promise<MaritimeSemanticEvidence> {
  const unavailable = (reason: string): MaritimeSemanticEvidence =>
    maritimeNeedsReview(reason);
  const cfg = readOpenAiConfig();
  if (!cfg) return unavailable("semantic validator unavailable");

  const model = openAiFastModel();
  // Reasoning models can spend 10–20 seconds on this deliberately strict
  // evidence contract.  Keep a bounded request while leaving enough room for
  // the low-effort gpt-5 path to finish; the contract check remains fail-closed.
  const timeoutMs = 30_000;
  const reasoningOptions = /^gpt-5(?:-|$)/i.test(model)
    ? { reasoning_effort: "low" as const }
    : {};
  let lastFailure = "semantic validator failed";
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          // The fast model in Replit's model farm is a reasoning model. Without
          // an explicit low-effort budget it can spend the entire request
          // timeout reasoning about the large strict schema and return no
          // completion at all (the historical "semantic validator failed"
          // rows). The contract validator below remains the hard gate. Do not
          // send this parameter to non-gpt-5 providers that may reject it.
          ...reasoningOptions,
          max_completion_tokens: 8192,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: JSON.stringify(input) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "maritime_semantic_evidence",
              strict: true,
              schema: SCHEMA,
            },
          },
        }),
      });
      if (!response.ok) {
        const transient =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        if (attempt === 0 && transient) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        return unavailable(`semantic validator HTTP ${response.status}`);
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = JSON.parse(body.choices?.[0]?.message?.content ?? "");
      if (!raw || typeof raw !== "object") {
        return unavailable("malformed semantic response");
      }
      const parsed = {
        ...raw,
        version: MARITIME_SEMANTIC_VERSION,
        eventDate: normalizeDate(raw.eventDate),
        reason: clampText(raw.reason),
        contradictions: Array.isArray(raw.contradictions)
          ? raw.contradictions.map((item: unknown) => clampText(item))
          : raw.contradictions,
        sourceQuotes: normalizeQuotes(raw.sourceQuotes),
        evidence: Array.isArray(raw.evidence)
          ? raw.evidence.map((item: unknown) => clampText(item))
          : raw.evidence,
      } as MaritimeSemanticEvidence;
      if (!MARITIME_VALIDITY_STATUSES.includes(parsed.verdict)) {
        return unavailable("malformed semantic response");
      }
      const check = validateMaritimeSemanticContract(
        parsed,
        `${input.title}\n${input.summary ?? ""}`,
      );
      // Explicit invalid is retained; malformed/ambiguous valid output is held
      // for review instead of falling back to title or route keywords.
      const verdict =
        parsed.verdict === "invalid"
          ? "invalid"
          : check.valid
            ? "valid"
            : "needs_review";
      return {
        ...parsed,
        verdict,
        reason: check.valid
          ? parsed.reason || "valid maritime event"
          : parsed.verdict === "invalid"
            ? parsed.reason || "provider marked item invalid"
            : check.failures.join(", ").slice(0, 240),
      };
    } catch (error) {
      lastFailure =
        controller.signal.aborted
          ? `semantic validator timeout after ${timeoutMs}ms`
          : error instanceof Error && error.name === "TypeError"
            ? "semantic validator connectivity failed"
            : "semantic validator request failed";
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      return unavailable(lastFailure);
    } finally {
      clearTimeout(timer);
    }
  }
  return unavailable(lastFailure);
}
