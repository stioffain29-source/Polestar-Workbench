// Headless topic-report data loader.
//
// The on-screen topic reports (shipping, fuel, cargo_watch, flashpoint, …)
// fetch the report row, incidents and — for shipping — maritime movement over
// the authenticated `/api` surface. Under the now-private workbench every `/api`
// data route is gated by `requireOwner`, so a headless run cannot authenticate.
// This loader reads the SAME sources directly from Postgres (the script runs in
// Node with DATABASE_URL) and reproduces the IDENTICAL response shapes the API
// returns — relevance-filtered incidents with corroborations attached, the
// report row, and theatre-scoped movement snapshots — so the PDF the headless
// run renders matches the on-screen report for font auditing.
//
// Mirrors the API handlers in artifacts/api-server/src/routes/{reports,
// incidents,maritimeMovement}.ts and lib/relevanceFilter.ts.
import { and, desc, eq, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import {
  db,
  reportsTable,
  incidentsTable,
  incidentCorroborationsTable,
  maritimeSemanticEvidenceTable,
  maritimeMovementTable,
  marketPricesTable,
  protestEventsTable,
  protestScheduleStateTable,
} from "@workspace/db";
import { currentMaritimeSemanticProjectionCondition } from "../../api-server/src/lib/relevanceFilter";
import {
  buildApacFutureEvents,
  type RegionalFutureEventInput,
} from "../src/lib/regionalWeekly";

export type RegionalCoverageRun = {
  topic: "apac_weekly" | "middle_east_weekly";
  window: { start: string; end: string };
  weather: RegionalCoverageStatus;
  cyber: RegionalCoverageStatus;
  forward: RegionalCoverageStatus;
};
export type RegionalCoverageStatus = {
  startedAt: string;
  completedAt: string;
  sourceNames: string[];
  itemsFetched: number;
  candidatesAccepted: number;
  errors: string[];
};
export type RegionalCollectorRunMetadata = {
  weather?: RegionalCoverageStatus;
  cyber?: RegionalCoverageStatus;
  forward?: RegionalCoverageStatus;
};

const REGIONAL_COUNTRIES: Record<RegionalCoverageRun["topic"], Set<string>> = {
  apac_weekly: new Set(["Australia","Bangladesh","Cambodia","China","India","Indonesia","Japan","Laos","Malaysia","Myanmar","Nepal","New Zealand","Pakistan","Papua New Guinea","Philippines","Singapore","South Korea","Sri Lanka","Taiwan","Thailand","Vietnam"]),
  middle_east_weekly: new Set(["Bahrain","Iran","Iraq","Israel","Jordan","Kuwait","Lebanon","Oman","Palestine","Qatar","Saudi Arabia","Syria","UAE","Yemen"]),
};

export function collectRegionalCoverage(
  rows: unknown[],
  issueDate: string,
  topic: RegionalCoverageRun["topic"],
  metadata?: RegionalCollectorRunMetadata | null,
): RegionalCoverageRun {
  const start = new Date(`${issueDate}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 7 * 86400000);
  // Incident rows are evidence, not proof that the upstream collection ran.
  // A source label on an incident is never a run record (and must not be
  // relabelled as one). Headless callers can provide the persisted collector
  // metadata through the optional fourth argument; without it coverage is
  // deliberately unknown/fail-closed.
  const sourceNames: string[] = [];
  const noRun = (domain: string): RegionalCoverageStatus => ({
    startedAt: "",
    completedAt: "",
    sourceNames,
    itemsFetched: 0,
    candidatesAccepted: 0,
    errors: [`${domain} collector run metadata unavailable`],
  });
  if (metadata?.weather && metadata?.cyber && metadata?.forward) {
    return {
      topic,
      window: { start: start.toISOString(), end: end.toISOString() },
      weather: metadata.weather,
      cyber: metadata.cyber,
      forward: metadata.forward,
    };
  }
  return {
    topic,
    window: { start: start.toISOString(), end: end.toISOString() },
    weather: noRun("weather"),
    cyber: noRun("cyber"),
    forward: noRun("forward"),
  };
  /*
  const scoped = rows.filter((row) => {
    const value = row as { country?: string; occurredAt?: string; title?: string; summary?: string };
    const date = new Date(value.occurredAt ?? "");
    return REGIONAL_COUNTRIES[topic].has(value.country ?? "") && date >= new Date(start.getTime() - 6 * 86400000) && date < end;
  });
  const run = (terms: RegExp, name: string): RegionalCoverageStatus => {
    const startedAt = new Date().toISOString();
    const candidates = scoped.filter((row) => terms.test(`${(row as { title?: string }).title ?? ""} ${(row as { summary?: string }).summary ?? ""}`));
    return { startedAt, completedAt: new Date().toISOString(), sourceNames: [...sourceNames, name], itemsFetched: scoped.length, candidatesAccepted: candidates.length, errors: [] };
  };
  return {
    topic,
    window: { start: start.toISOString(), end: end.toISOString() },
    weather: run(/\b(?:earthquake|typhoon|cyclone|storm|flood|landslide|wildfire|haze|volcan|tsunami|heat|drought)\b/i, "regional-weather-incident-register"),
    cyber: run(/\b(?:ransomware|cyber|breach|malware|telecom|airport|port|logistics|utility|energy|critical infrastructure)\b/i, "regional-cyber-incident-register"),
    forward: run(/\b(?:protest|strike|election|deadline|exercise|march|warning|advisory|restriction|event)\b/i, `${topic}-forward-events`),
  };*/
}

// JSON-roundtrip a Drizzle row set so Date columns become ISO strings exactly
// as Express's res.json() → client r.json() would, guaranteeing the headless
// data shape is byte-equivalent to the HTTP path the exporters previously saw.
function asJson<T>(rows: unknown): T {
  return JSON.parse(JSON.stringify(rows)) as T;
}

type IncidentRow = typeof incidentsTable.$inferSelect;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Mirror of withCorroborations() in routes/incidents.ts: batch-load each
// incident's official corroborating references and group them in memory.
async function withCorroborations(rows: IncidentRow[]): Promise<unknown[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const links = (await Promise.all(chunks(ids, 2_000).map((batch) =>
    db
      .select({
        incidentId: incidentCorroborationsTable.incidentId,
        id: incidentCorroborationsTable.id,
        provider: incidentCorroborationsTable.provider,
        reportTitle: incidentCorroborationsTable.reportTitle,
        sourceAgency: incidentCorroborationsTable.sourceAgency,
        reportDate: incidentCorroborationsTable.reportDate,
        url: incidentCorroborationsTable.url,
        matchScore: incidentCorroborationsTable.matchScore,
      })
      .from(incidentCorroborationsTable)
      .where(inArray(incidentCorroborationsTable.incidentId, batch))
      .orderBy(desc(incidentCorroborationsTable.matchScore)),
  ))).flat();
  const byIncident = new Map<
    number,
    Omit<(typeof links)[number], "incidentId">[]
  >();
  for (const { incidentId, ...rest } of links) {
    const bucket = byIncident.get(incidentId);
    if (bucket) bucket.push(rest);
    else byIncident.set(incidentId, [rest]);
  }
  const semantics = (await Promise.all(chunks(ids, 2_000).map((batch) =>
    db
      .select({ semantic: maritimeSemanticEvidenceTable })
      .from(maritimeSemanticEvidenceTable)
      .innerJoin(
        incidentsTable,
        eq(incidentsTable.id, maritimeSemanticEvidenceTable.incidentId),
      )
      .where(
        and(
          inArray(maritimeSemanticEvidenceTable.incidentId, batch),
          currentMaritimeSemanticProjectionCondition(),
        ),
      )
      .orderBy(desc(maritimeSemanticEvidenceTable.evaluatedAt)),
  ))).flat();
  const semanticByIncident = new Map<
    number,
    (typeof semantics)[number]["semantic"]
  >();
  for (const joined of semantics) {
    if (!semanticByIncident.has(joined.semantic.incidentId)) {
      semanticByIncident.set(joined.semantic.incidentId, joined.semantic);
    }
  }
  return rows.map((r) => {
    const semantic = semanticByIncident.get(r.id);
    const maritime = r.topic === "shipping" || r.topic === "maritime";
    const maritimeValidation = !maritime
      ? {
          status: "not_applicable" as const,
          version: null,
          reason: null,
          evaluatedAt: null,
        }
      : semantic
        ? {
            status:
              semantic.verdict === "valid"
                ? ("validated" as const)
                : semantic.verdict === "invalid"
                  ? ("rejected" as const)
                  : ("pending" as const),
            version: semantic.version,
            reason: semantic.reason,
            evaluatedAt: semantic.evaluatedAt,
          }
        : {
            status: "pending" as const,
            version: null,
            reason: "awaiting current source-backed semantic validation",
            evaluatedAt: null,
          };
    return {
      ...r,
      corroborations: byIncident.get(r.id) ?? [],
      maritimeValidation,
      maritimeSemantic: semantic
        ? {
            version: semantic.version,
            verdict: semantic.verdict,
            reason: semantic.reason,
            eventOccurred: semantic.eventOccurred,
            eventClass: semantic.eventClass,
            commercialTargetValidated: semantic.commercialTargetValidated,
            commercialTarget: semantic.commercialTarget,
            commercialTargetName: semantic.commercialTargetName,
            commercialTargetEvidence: semantic.commercialTargetEvidence,
            physicalLocation: semantic.physicalLocation,
            physicalLocationEvidence: semantic.physicalLocationEvidence,
            country: semantic.country,
            coastalState: semantic.coastalState,
            routeRelationship: {
              kind: semantic.routeKind,
              routeName: semantic.routeName,
              evidence: semantic.routeEvidence,
            },
            routingConsequence: {
              kind: semantic.consequenceKind,
              status: semantic.consequenceStatus,
              claim: semantic.consequenceClaim,
              evidenceQuote: semantic.consequenceEvidenceQuote,
              confidence: semantic.consequenceConfidence,
              description: semantic.consequenceDescription,
              evidence: semantic.consequenceEvidence,
            },
            commercialConsequence: {
              status: semantic.commercialConsequenceStatus,
              claim: semantic.commercialConsequenceClaim,
              evidenceQuote: semantic.commercialConsequenceEvidenceQuote,
              confidence: semantic.commercialConsequenceConfidence,
            },
            geopolitical: {
              relevant: semantic.geopoliticalRelevant,
              claim: semantic.geopoliticalClaim,
              evidenceQuote: semantic.geopoliticalEvidenceQuote,
            },
            eventDate: semantic.eventDate,
            developmentKey: semantic.developmentKey,
            severity: semantic.severity,
            severityJustification: semantic.severityJustification,
            severityEvidenceQuote: semantic.severityEvidenceQuote,
            confidence: {
              event: semantic.confidenceEvent,
              classification: semantic.confidenceClassification,
              commercialTarget: semantic.confidenceCommercialTarget,
              geography: semantic.confidenceGeography,
              routeRelationship: semantic.confidenceRoute,
              consequence: semantic.confidenceConsequence,
              date: semantic.confidenceDate,
            },
            contradictions: semantic.contradictions,
            sourceQuotes: semantic.sourceQuotes,
            evidence: semantic.evidence,
            evaluatedAt: semantic.evaluatedAt,
          }
        : null,
    };
  });
}

// Mirror of defaultRelevanceCondition() in lib/relevanceFilter.ts: drop rows
// marked 'irrelevant'; NULL status (not yet backfilled) fails OPEN.
// EXCEPTION — cargo_watch: the authoritative gate for Cargo Watch is the scope
// classifier (isCargoInScope), not the general text-relevance gate, which marks
// most genuine cargo theft 'irrelevant'. The screen + in-app PDF fetch cargo
// with includeIrrelevant (ReportEditor.tsx) and rely on filterTopicReportIncidents
// to re-apply scope. This headless loader must admit cargo rows the same way or
// the headless cargo PDF starves to ~1 record while the screen shows many —
// violating the preview==PDF rule. Scope is re-applied downstream, so it is safe.
async function loadIncidents(): Promise<unknown[]> {
  const rows = await db
    .select()
    .from(incidentsTable)
    .where(
      or(
        eq(incidentsTable.topic, "cargo_watch"),
        isNull(incidentsTable.relevanceStatus),
        ne(incidentsTable.relevanceStatus, "irrelevant"),
      ),
    )
    .orderBy(desc(incidentsTable.occurredAt));
  return asJson(await withCorroborations(rows));
}

// Resolve the most recent report id for a topic so the font audit always
// exercises the LATEST report of each family (mirrors how auditCountryFonts.sh
// pins stable country slugs). Flashpoint reports are stored under topic
// 'protests' (their incidents live under 'flashpoint'), so accept either.
export async function fetchLatestTopicReportId(topic: string): Promise<number> {
  const t = topic.toLowerCase();
  const topics =
    t === "flashpoint" || t === "protests"
      ? ["flashpoint", "protests"]
      : [t];
  const [row] = await db
    .select({ id: reportsTable.id })
    .from(reportsTable)
    .where(inArray(reportsTable.topic, topics))
    .orderBy(desc(reportsTable.id))
    .limit(1);
  if (!row) {
    throw new Error(`No report found for topic "${topic}" in the database.`);
  }
  return row.id;
}

// Mirror of GET /api/reports/:id.
export async function fetchTopicReport(id: number): Promise<unknown> {
  const [row] = await db
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.id, id));
  if (!row) {
    throw new Error(`Report ${id} not found in the database.`);
  }
  return asJson(row);
}

// Mirror of GET /api/maritime-movement (optionally theatre-scoped). Used by the
// shipping branch for the Maritime Intelligence board and the per-gateway
// directional-flow panel.
export async function fetchMaritimeMovement(
  theatre?: string,
  limit = 100,
): Promise<unknown[]> {
  const rows = await db
    .select()
    .from(maritimeMovementTable)
    .where(theatre ? eq(maritimeMovementTable.theatre, theatre) : undefined)
    .orderBy(desc(maritimeMovementTable.dataAsOf))
    .limit(limit);
  return asJson(rows);
}

// Mirror of GET /api/incidents (default relevance gate, no day window — the
// headless exporters previously fetched ?limit=500 which the route ignored, so
// this returns the full relevance-filtered set ordered by occurredAt desc).
export async function fetchTopicIncidents(): Promise<unknown[]> {
  return loadIncidents();
}

/** Exact Flashpoint schedule payload for a saved report's issue-date horizon.
 * Includes issue-date activity because operational posture already in force
 * that day (for example, deployed police) belongs in the report forecast. */
export async function fetchFlashpointProtestSchedule(
  issueDate: string,
): Promise<{
  confirmedPlanned: unknown[];
  possible: unknown[];
  searchCompletedAt: string | null;
}> {
  const issueMs = Date.parse(`${issueDate.trim()}T00:00:00.000Z`);
  if (!Number.isFinite(issueMs)) {
    return { confirmedPlanned: [], possible: [], searchCompletedAt: null };
  }
  const start = new Date(issueMs);
  const end = new Date(issueMs + 8 * 24 * 60 * 60 * 1000);
  const [rows, state] = await Promise.all([
    db
      .select()
      .from(protestEventsTable)
      .where(
        and(
          gte(protestEventsTable.eventDate, start),
          lt(protestEventsTable.eventDate, end),
          inArray(protestEventsTable.status, ["Confirmed", "Planned", "Possible"]),
        ),
      )
      .orderBy(protestEventsTable.eventDate, protestEventsTable.id),
    db
      .select({ searchCompletedAt: protestScheduleStateTable.searchCompletedAt })
      .from(protestScheduleStateTable)
      .where(eq(protestScheduleStateTable.key, "singleton"))
      .limit(1),
  ]);
  const jsonRows = asJson<Array<{ status: string }>>(rows);
  return {
    confirmedPlanned: jsonRows.filter(
      (row) => row.status === "Confirmed" || row.status === "Planned",
    ),
    possible: jsonRows.filter((row) => row.status === "Possible"),
    searchCompletedAt: state[0]?.searchCompletedAt?.toISOString() ?? null,
  };
}

/**
 * Headless equivalent of ReportEditor's APAC forward-event projection.
 * Protest events are context-only and never enter the incident dataset.
 * Query the report's own issue-date window rather than "now" so a historical
 * headless review is identical to the editor's preview.
 */
export async function fetchApacFutureEvents(
  issueDate: string,
): Promise<RegionalFutureEventInput[]> {
  const issueMs = Date.parse(`${issueDate.trim()}T00:00:00.000Z`);
  if (!Number.isFinite(issueMs)) return [];
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(issueMs + dayMs);
  const end = new Date(issueMs + 8 * dayMs);
  const rows = await db
    .select()
    .from(protestEventsTable)
    .where(
      and(
        gte(protestEventsTable.eventDate, start),
        lt(protestEventsTable.eventDate, end),
        inArray(protestEventsTable.status, ["Confirmed", "Planned", "Possible"]),
      ),
    )
    .orderBy(protestEventsTable.eventDate, protestEventsTable.id);
  return buildApacFutureEvents(
    rows.map((event) => ({
      eventDate: event.eventDate?.toISOString() ?? null,
      country: event.country,
      city: event.city,
      venue: event.venue,
      eventType: event.eventType,
      issue: event.issue,
      organiser: event.organiser,
      description: event.description,
      sourceTitle: event.sourceTitle,
      disruptionPotential: event.disruptionPotential,
      confidence: event.confidence,
      status: event.status,
      attendance: event.attendance,
    })),
    issueDate,
  );
}

/** Shared forward-search adapter for both regional products; records an explicit
 * empty result as a successful run rather than silently skipping collection. */
export async function fetchRegionalFutureEvents(
  issueDate: string,
  topic: "apac_weekly" | "middle_east_weekly",
): Promise<RegionalFutureEventInput[]> {
  const events = await fetchApacFutureEvents(issueDate);
  const issueMs = Date.parse(`${issueDate.trim()}T00:00:00.000Z`);
  const start = new Date(issueMs + 24 * 60 * 60 * 1000);
  const end = new Date(issueMs + 8 * 24 * 60 * 60 * 1000);
  // Incident/advisory rows cover scheduled elections, deadlines, exercises,
  // warnings and transport or border restrictions that are not represented in
  // protest_events. They are queried separately so an empty protest lane does
  // not masquerade as a completed forward search.
  const incidentRows = await db.select().from(incidentsTable).where(
    and(gte(incidentsTable.occurredAt, start), lt(incidentsTable.occurredAt, end)),
  );
  const incidentEvents = buildApacFutureEvents(
    incidentRows.map((row) => ({
      eventDate: row.occurredAt?.toISOString() ?? null,
      country: row.country,
      title: row.displayTitle ?? row.title,
      description: row.summary,
      sourceTitle: row.title,
      eventType: row.category,
      disruptionPotential: row.severity,
      status: "Possible",
    })),
    issueDate,
  );
  const countries = REGIONAL_COUNTRIES[topic];
  const filtered = [...events, ...incidentEvents]
    .filter((event) => countries.has(event.location.split(",").at(-1)?.trim() ?? ""))
    .filter((event, index, all) => all.findIndex((candidate) =>
      candidate.date === event.date
      && candidate.location === event.location
      && candidate.trigger === event.trigger,
    ) === index)
    .slice(0, 5);
  console.info(`[regional-forward-search] topic=${topic} status=complete sources=protest-events,incident-advisories itemsFetched=${events.length + incidentRows.length} accepted=${filtered.length}`);
  return filtered;
}

// Mirror of GET /api/market-prices?group=… (routes/marketPrices.ts): the
// energy/fertiliser reports render a Market Prices grid from these rows, so
// the headless export must feed the same rows for preview==PDF parity.
export async function fetchTopicMarketPrices(group: string): Promise<unknown[]> {
  const rows = await db
    .select()
    .from(marketPricesTable)
    .where(eq(marketPricesTable.group, group))
    .orderBy(desc(marketPricesTable.group));
  return asJson<unknown[]>(rows);
}
