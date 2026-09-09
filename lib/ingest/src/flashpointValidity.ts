import { openAiFastModel, readOpenAiConfig } from "./openaiConfig";
import { FLASHPOINT_EVENT_TYPES, FLASHPOINT_VALIDITY_VERSION, validateFlashpointSemanticContract, type FlashpointCurrentness, type FlashpointEventType, type FlashpointProviderVerdict, type FlashpointSemanticGates } from "@workspace/relevance";

export { FLASHPOINT_VALIDITY_VERSION };
export type FlashpointValidityStatus = FlashpointProviderVerdict;
export function isTransientFlashpointValidityReason(reason: string | null | undefined): boolean {
  return /(unavailable|http|timeout|failed|malformed|incoherent)/i.test(reason ?? "");
}
export interface FlashpointValidity {
  eventOccurred: boolean | null;
  actor: string | null;
  activity: string | null;
  physicalLocation: string | null;
  country: string | null;
  eventType: FlashpointEventType | null;
  eventDate: string | null;
  currentness: FlashpointCurrentness | null;
  assignedCountrySupported: boolean;
  confidence: { event: number; classification: number; geography: number; date: number };
  contradictions: string[];
  verdict: FlashpointValidityStatus;
  reason: string;
  version: string;
}

const SYSTEM = `You validate a proposed civil-unrest/labour/public-order news event.
Return only JSON matching the requested schema. Require actual reported event facts:
an identifiable actor, an activity, and positive physical event location evidence.
eventOccurred may be true for a credibly scheduled qualifying future event with concrete facts.
Do not treat a subject's nationality, political target, publisher/feed country, embassy
reference, legislation, court discussion, business/technology mention, commentary,
historical retrospective, or hypothetical as the physical event geography. Distinguish
where the event happened from who/what the story discusses. The assigned country is NOT
evidence: title/summary must positively support the physical geography. If facts are uncertain,
contradictory, or unavailable, verdict must be needs_review, never valid.`;

export async function validateFlashpointEvent(input: {
  title: string; summary: string; source?: string | null; sourceUrl?: string | null;
  assignedCountry?: string | null; assignedLocation?: string | null;
  publishedAt?: Date | null; candidateEventDate?: Date | null;
}): Promise<FlashpointValidity> {
  const unavailable = (reason: string): FlashpointValidity => ({
    eventOccurred: null, actor: null, activity: null, physicalLocation: null, country: null,
    eventType: null, eventDate: null, currentness: null,
    assignedCountrySupported: false, confidence: { event: 0, classification: 0, geography: 0, date: 0 },
    contradictions: [], verdict: "needs_review", reason, version: FLASHPOINT_VALIDITY_VERSION,
  });
  const cfg = readOpenAiConfig();
  if (!cfg) return unavailable("semantic validator unavailable");
  const schema = {
    type: "object", additionalProperties: false,
    required: ["eventOccurred", "actor", "activity", "physicalLocation", "country", "eventType", "eventDate", "currentness", "assignedCountrySupported", "confidence", "contradictions", "verdict", "reason"],
    properties: {
      eventOccurred: { type: ["boolean", "null"] }, actor: { type: ["string", "null"] },
      activity: { type: ["string", "null"] }, physicalLocation: { type: ["string", "null"] },
      country: { type: ["string", "null"] }, eventType: { type: ["string", "null"], enum: [...FLASHPOINT_EVENT_TYPES, null] },
      eventDate: { type: ["string", "null"] }, currentness: { type: ["string", "null"], enum: ["current", "future", "historical", "unclear", null] },
      assignedCountrySupported: { type: "boolean" },
      confidence: { type: "object", additionalProperties: false, required: ["event", "classification", "geography", "date"], properties: {
        event: { type: "number" }, classification: { type: "number" }, geography: { type: "number" }, date: { type: "number" },
      }},
      contradictions: { type: "array", items: { type: "string" } },
      verdict: { type: "string", enum: ["valid", "invalid", "needs_review"] }, reason: { type: "string" },
    },
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: openAiFastModel(), max_completion_tokens: 8192,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(input) }],
        response_format: { type: "json_schema", json_schema: { name: "flashpoint_validity", strict: true, schema } } }),
    });
    if (!res.ok) return unavailable(`semantic validator HTTP ${res.status}`);
    const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    clearTimeout(timer);
    const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "");
    if (!parsed || !["valid", "invalid", "needs_review"].includes(parsed.verdict)) return unavailable("malformed semantic response");
    const check = validateFlashpointSemanticContract({ ...parsed, version: FLASHPOINT_VALIDITY_VERSION } as FlashpointSemanticGates);
    const definiteInvalid = parsed.verdict === "invalid" || parsed.eventOccurred === false ||
      parsed.assignedCountrySupported === false || parsed.eventType === "non_flashpoint" || parsed.currentness === "historical";
    const verdict: FlashpointValidityStatus = check.valid ? "valid" : definiteInvalid ? "invalid" : "needs_review";
    return { ...parsed, verdict, reason: check.valid ? String(parsed.reason ?? "valid event").slice(0, 240) : check.failures.join(", ").slice(0, 240), version: FLASHPOINT_VALIDITY_VERSION } as FlashpointValidity;
  } catch {
    return unavailable("semantic validator failed");
  }
}