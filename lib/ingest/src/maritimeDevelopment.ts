import { createHash } from "node:crypto";
import type { MaritimeSemanticEvidence } from "@workspace/relevance";
import { openAiFastModel, readOpenAiConfig } from "./openaiConfig";

export type MaritimeDevelopmentEvent = {
  incidentId: number;
  canonicalDevelopmentId?: string | null;
  eventClass: string | null;
  commercialTarget: string | null;
  commercialTargetName: string | null;
  physicalLocation: string | null;
  country: string | null;
  routeName: string | null;
  eventDate: Date | null;
  severity: string | null;
  consequenceStatus: string | null;
  /** Original source material is required before a pair can be merged. */
  title?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  sourceQuotes?: Array<{ quote: string; claim: string }>;
};

export type DevelopmentPairDecision = "same" | "different" | "ambiguous";

export const MARITIME_DEVELOPMENT_VERSION = "maritime-development-v3";

const GENERIC_TARGET_NAMES = new Set([
  "tanker",
  "tankers",
  "vessel",
  "vessels",
  "ship",
  "ships",
  "cargo ship",
  "cargo vessel",
  "bulk carrier",
  "container ship",
  "merchant vessel",
  "commercial vessel",
  "unknown",
  "unnamed",
]);

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function dateDistanceDays(left: Date | null, right: Date | null): number | null {
  if (!left || !right) return null;
  return Math.abs(left.getTime() - right.getTime()) / 86_400_000;
}

function normalizedSourceText(event: MaritimeDevelopmentEvent): string {
  return [
    event.title,
    event.summary,
    event.source,
    ...(event.sourceQuotes ?? []).flatMap((quote) => [quote.quote, quote.claim]),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
}

function normalizedTargetName(value: string | null | undefined): string {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function hasSpecificTargetName(event: MaritimeDevelopmentEvent): boolean {
  const name = normalizedTargetName(event.commercialTargetName);
  return Boolean(name) && !GENERIC_TARGET_NAMES.has(name);
}

function sourceBackedIdentity(
  left: MaritimeDevelopmentEvent,
  right: MaritimeDevelopmentEvent,
): boolean {
  // An exact source URL is direct evidence that both rows describe the same
  // source occurrence, even when a later rewrite changes the event date.
  if (
    left.sourceUrl &&
    right.sourceUrl &&
    normalize(left.sourceUrl) === normalize(right.sourceUrl)
  ) {
    return true;
  }

  const leftTarget = normalizedTargetName(left.commercialTargetName);
  const rightTarget = normalizedTargetName(right.commercialTargetName);
  if (
    hasSpecificTargetName(left) &&
    hasSpecificTargetName(right) &&
    leftTarget === rightTarget
  ) {
    const leftText = normalizedTargetName(normalizedSourceText(left));
    const rightText = normalizedTargetName(normalizedSourceText(right));
    if (leftText.includes(leftTarget) && rightText.includes(rightTarget)) {
      return true;
    }
  }

  // Shared generic quotes are deliberately not an identity anchor: two
  // unnamed attacks can use the same "tanker attacked at [place]" wording.
  // Source quotes remain available to adjudication, but cannot merge rows.
  return false;
}

function explicitSameOccurrenceReference(
  left: MaritimeDevelopmentEvent,
  right: MaritimeDevelopmentEvent,
): boolean {
  if (!sourceBackedIdentity(left, right)) return false;
  const text = normalize(
    `${normalizedSourceText(left)} ${normalizedSourceText(right)}`,
  );
  // These are source-language references to an earlier report, not generic
  // "same type/place" guesses. New/second/separate events veto the reference.
  if (explicitNewOccurrenceReference(left, right)) {
    return false;
  }
  return /\b(same\s+(?:attack|incident|event|occurrence)|(?:the\s+)?(?:earlier|previous|prior|initial)\s+(?:attack|incident|event|report)|follow[- ]?up\s+(?:report|story|coverage|to)|updated\s+(?:report|story|coverage)|revised\s+(?:report|story|coverage)|new\s+details\s+(?:of|about|on)|correction\s+(?:to|of))\b/i.test(
    text,
  );
}

function explicitNewOccurrenceReference(
  left: MaritimeDevelopmentEvent,
  right: MaritimeDevelopmentEvent,
): boolean {
  const text = normalize(
    `${normalizedSourceText(left)} ${normalizedSourceText(right)}`,
  );
  return /\b(another|second|separate|different|new|fresh|subsequent|follow[- ]?(?:on|up))\s+(?:reported\s+)?(?:attack|incident|strike|boarding|seizure)\b/i.test(
    text,
  );
}

/**
 * Conservative, provider-independent comparison of two actual semantic
 * candidate events. A missing field never proves sameness; a contradictory
 * asserted field is material. Ambiguous pairs are deliberately not merged
 * unless the caller supplies a provider adjudicator.
 */
export function compareMaritimeDevelopmentPair(
  left: MaritimeDevelopmentEvent,
  right: MaritimeDevelopmentEvent,
): DevelopmentPairDecision {
  if (
    left.eventClass &&
    right.eventClass &&
    left.eventClass !== right.eventClass
  ) return "different";
  if (
    left.commercialTarget &&
    right.commercialTarget &&
    left.commercialTarget !== right.commercialTarget
  ) return "different";
  if (
    left.commercialTargetName &&
    right.commercialTargetName &&
    normalize(left.commercialTargetName) !== normalize(right.commercialTargetName)
  ) return "different";
  if (
    left.physicalLocation &&
    right.physicalLocation &&
    normalize(left.physicalLocation) !== normalize(right.physicalLocation)
  ) return "different";
  if (
    left.country &&
    right.country &&
    normalize(left.country) !== normalize(right.country)
  ) return "different";
  if (
    left.routeName &&
    right.routeName &&
    normalize(left.routeName) !== normalize(right.routeName)
  ) return "different";
  const distance = dateDistanceDays(left.eventDate, right.eventDate);
  const sourceIdentity = sourceBackedIdentity(left, right);
  const explicitReference = explicitSameOccurrenceReference(left, right);
  if (sourceIdentity && explicitNewOccurrenceReference(left, right)) {
    return "different";
  }
  // A date change is a new development unless original source material
  // explicitly identifies the same occurrence. This blocks repeated unnamed
  // piracy/attack reports from collapsing merely because they share a class,
  // target type, and location.
  if (distance !== null && distance > 0 && !explicitReference) {
    return "different";
  }
  if (
    left.consequenceStatus &&
    right.consequenceStatus &&
    left.consequenceStatus !== right.consequenceStatus &&
    (left.consequenceStatus === "confirmed" ||
      right.consequenceStatus === "confirmed")
  ) return "ambiguous";
  if (
    left.severity &&
    right.severity &&
    left.severity !== right.severity
  ) return "ambiguous";

  const assertedFields = [
    left.eventClass,
    right.eventClass,
    left.commercialTarget,
    right.commercialTarget,
    left.physicalLocation,
    right.physicalLocation,
    left.country,
    right.country,
    left.routeName,
    right.routeName,
    left.eventDate,
    right.eventDate,
  ];
  const strongIdentity =
    left.eventClass &&
    right.eventClass &&
    sourceIdentity &&
    left.eventClass === right.eventClass;
  return strongIdentity && assertedFields.some(Boolean) ? "same" : "ambiguous";
}

function canonicalIdFor(event: MaritimeDevelopmentEvent): string {
  const eventDay = event.eventDate
    ? event.eventDate.toISOString().slice(0, 10)
    : "unknown";
  const identity = [
    normalize(event.eventClass),
    normalize(event.commercialTarget),
    normalize(event.commercialTargetName),
    normalize(event.physicalLocation),
    normalize(event.country),
    normalize(event.routeName),
    eventDay,
  ].join("\u001f");
  return `${MARITIME_DEVELOPMENT_VERSION}:${createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 24)}`;
}

export type MaritimeDevelopmentAdjudicator = (
  left: MaritimeDevelopmentEvent,
  right: MaritimeDevelopmentEvent,
) => Promise<Exclude<DevelopmentPairDecision, "ambiguous">>;

/** Provider-backed tie breaker for pairs whose structured fields conflict only
 * weakly (for example, a revised severity or consequence). Unavailable or
 * malformed adjudication is fail-closed: keep separate developments. */
export async function adjudicateMaritimeDevelopmentPair(
  left: MaritimeDevelopmentEvent,
  right: MaritimeDevelopmentEvent,
): Promise<Exclude<DevelopmentPairDecision, "ambiguous">> {
  const cfg = readOpenAiConfig();
  if (!cfg) return "different";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: openAiFastModel(),
        max_completion_tokens: 100,
        messages: [
          {
            role: "system",
            content:
               "Decide whether two maritime reports describe the same real-world " +
               "development. Use the original title, summary, publisher/source, " +
               "URL, and source-grounded quotes, not merely guessed structured " +
               "fields. Return same only when an explicit source reference supports " +
               "the same occurrence despite a rewrite/date difference. Material new " +
               "target, location, event class, or escalation is different. Return " +
               "different when ambiguous. Return JSON only.",
          },
          { role: "user", content: JSON.stringify({ left, right }) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "maritime_development_pair",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["decision"],
              properties: {
                decision: { type: "string", enum: ["same", "different"] },
              },
            },
          },
        },
      }),
    });
    if (!response.ok) return "different";
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "");
    return parsed?.decision === "same" ? "same" : "different";
  } catch {
    return "different";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve one semantic result against real existing candidate events. A
 * provider developmentKey is never used as identity: it is only retained in
 * the append-only decision payload. Existing canonical IDs win, while new IDs
 * are deterministic and material changes are kept separate.
 */
export async function resolveCanonicalMaritimeDevelopmentId(
  current: MaritimeDevelopmentEvent,
  candidates: MaritimeDevelopmentEvent[],
  adjudicate?: MaritimeDevelopmentAdjudicator,
): Promise<{ id: string; mergedIncidentIds: number[] }> {
  for (const candidate of candidates) {
    const decision = compareMaritimeDevelopmentPair(current, candidate);
    // Ambiguity is an explicit hold state. Only a pair whose original source
    // text contains an event-specific same-occurrence reference may be sent
    // to adjudication; generic structured agreement is never enough.
    if (
      decision === "ambiguous" &&
      !explicitSameOccurrenceReference(current, candidate)
    ) {
      continue;
    }
    const resolved =
      decision === "ambiguous" && adjudicate
        ? await adjudicate(current, candidate)
        : decision;
    if (resolved === "same") {
      return {
        id:
          candidate.canonicalDevelopmentId?.startsWith(
            `${MARITIME_DEVELOPMENT_VERSION}:`,
          )
            ? candidate.canonicalDevelopmentId
            : canonicalIdFor(candidate),
        mergedIncidentIds: [candidate.incidentId],
      };
    }
  }
  return { id: canonicalIdFor(current), mergedIncidentIds: [] };
}

export function maritimeDevelopmentEventFromSemantic(
  incidentId: number,
  result: Pick<
    MaritimeSemanticEvidence,
    | "eventClass"
    | "commercialTarget"
    | "commercialTargetName"
    | "physicalLocation"
    | "country"
    | "routeRelationship"
    | "eventDate"
    | "severity"
    | "routingConsequence"
  > &
    Partial<Pick<MaritimeSemanticEvidence, "sourceQuotes">>,
  canonicalDevelopmentId?: string | null,
  source?: Pick<
    MaritimeDevelopmentEvent,
    "title" | "summary" | "source" | "sourceUrl"
  >,
): MaritimeDevelopmentEvent {
  return {
    incidentId,
    canonicalDevelopmentId,
    eventClass: result.eventClass,
    commercialTarget: result.commercialTarget,
    commercialTargetName: result.commercialTargetName,
    physicalLocation: result.physicalLocation,
    country: result.country,
    routeName: result.routeRelationship.routeName,
    eventDate:
      result.eventDate &&
      Number.isFinite(Date.parse(`${result.eventDate}T00:00:00.000Z`))
        ? new Date(`${result.eventDate}T00:00:00.000Z`)
        : null,
    severity: result.severity,
    consequenceStatus: result.routingConsequence.status,
    ...source,
    sourceQuotes: result.sourceQuotes,
  };
}
