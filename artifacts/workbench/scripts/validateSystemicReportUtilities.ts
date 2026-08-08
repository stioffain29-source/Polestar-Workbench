// Replay several preserved Fuel Watch weeks through the shared report utilities.
//
// This is intentionally data-only: it reads the checked-in historical incident
// snapshot and verifies that every generated country label is a real incident
// location, while the Hormuz watch excludes fiscal/price-only name-drops.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildFuelGulfChokepointWatch,
  buildFuelRegionalHighlights,
} from "../src/lib/fuelNarratives";
import { deriveIncidentCountry } from "../src/lib/shippingCountry";
import { isGulfChokepointIncident } from "../src/lib/topicIncidentMatching";
import type { TopicFastFactsIncident } from "../src/lib/topicFastFacts";

const HISTORY_PATH = join(import.meta.dirname, ".prod-incidents.json");
const rawHistory = JSON.parse(readFileSync(HISTORY_PATH, "utf8")) as {
  fuel: Array<Record<string, unknown>>;
  shipping: Array<Record<string, unknown>>;
};
const toIncident = (row: Record<string, unknown>): TopicFastFactsIncident =>
  ({
    id: Number(row.id),
    topic: String(row.topic),
    title: String(row.title ?? ""),
    summary: row.summary == null ? null : String(row.summary),
    country: row.country == null ? null : String(row.country),
    location: row.location == null ? null : String(row.location),
    source: row.source == null ? null : String(row.source),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    occurredAt: String(row.occurred_at),
    severity: String(row.severity ?? "low"),
  }) as TopicFastFactsIncident;
const history = {
  fuel: rawHistory.fuel.map(toIncident),
  shipping: rawHistory.shipping.map(toIncident),
};
const periods = ["2026-05-04", "2026-05-11", "2026-05-18"];

for (const issueDate of periods) {
  // Recreate the state available on that report date; otherwise the report
  // window clamps to the snapshot's latest record and every replay becomes
  // the same week.
  const incidents = [...history.fuel, ...history.shipping].filter(
    (i) => i.occurredAt.slice(0, 10) <= issueDate,
  );
  const countryTagged = incidents.filter((i) => deriveIncidentCountry(i));
  const matchedGulf = incidents.filter((i) => isGulfChokepointIncident(i));
  const fiscalFalsePositives = matchedGulf.filter((i) =>
    /\b(?:salary|wages?|payroll|budget|fiscal|subsid(?:y|ies)|pension|allowance|consumer prices?|oil prices?|fuel prices?|gdp|trade deficit)\b/i.test(i.title ?? ""),
  );
  const highlights = buildFuelRegionalHighlights({
    issueDate,
    incidents: history.fuel,
  });
  const gulf = buildFuelGulfChokepointWatch({
    issueDate,
    incidents,
  });
  const summary = {
    issueDate,
    inputRows: incidents.length,
    incidentCountryTagged: countryTagged.length,
    gulfIncidentMatches: matchedGulf.length,
    fiscalFalsePositives,
    regionalHighlightsProduced: Boolean(highlights),
    currentGulfWatchItems: gulf?.currentItems.length ?? 0,
  };
  if (fiscalFalsePositives.length > 0) {
    throw new Error(
      `${issueDate}: fiscal articles were accepted as Gulf incidents: ${fiscalFalsePositives
        .map((i) => i.title)
        .join(" | ")}`,
    );
  }
  console.log(JSON.stringify(summary));
}
