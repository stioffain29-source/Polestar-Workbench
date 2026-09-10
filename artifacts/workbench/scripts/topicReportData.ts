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
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import {
  db,
  reportsTable,
  incidentsTable,
  incidentCorroborationsTable,
  maritimeSemanticEvidenceTable,
  maritimeMovementTable,
  marketPricesTable,
} from "@workspace/db";
import { currentMaritimeSemanticProjectionCondition } from "../../api-server/src/lib/relevanceFilter";

// JSON-roundtrip a Drizzle row set so Date columns become ISO strings exactly
// as Express's res.json() → client r.json() would, guaranteeing the headless
// data shape is byte-equivalent to the HTTP path the exporters previously saw.
function asJson<T>(rows: unknown): T {
  return JSON.parse(JSON.stringify(rows)) as T;
}

type IncidentRow = typeof incidentsTable.$inferSelect;

// Mirror of withCorroborations() in routes/incidents.ts: batch-load each
// incident's official corroborating references and group them in memory.
async function withCorroborations(rows: IncidentRow[]): Promise<unknown[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const links = await db
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
    .where(inArray(incidentCorroborationsTable.incidentId, ids))
    .orderBy(desc(incidentCorroborationsTable.matchScore));
  const byIncident = new Map<
    number,
    Omit<(typeof links)[number], "incidentId">[]
  >();
  for (const { incidentId, ...rest } of links) {
    const bucket = byIncident.get(incidentId);
    if (bucket) bucket.push(rest);
    else byIncident.set(incidentId, [rest]);
  }
  const semantics = await db
    .select({ semantic: maritimeSemanticEvidenceTable })
    .from(maritimeSemanticEvidenceTable)
    .innerJoin(
      incidentsTable,
      eq(incidentsTable.id, maritimeSemanticEvidenceTable.incidentId),
    )
    .where(
      and(
        inArray(maritimeSemanticEvidenceTable.incidentId, ids),
        currentMaritimeSemanticProjectionCondition(),
      ),
    )
    .orderBy(desc(maritimeSemanticEvidenceTable.evaluatedAt));
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
