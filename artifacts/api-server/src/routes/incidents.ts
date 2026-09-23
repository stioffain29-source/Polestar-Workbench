import { Router, type IRouter } from "express";
import {
  db,
  incidentsTable,
  incidentCorroborationsTable,
  maritimeSemanticEvidenceTable,
} from "@workspace/db";
import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import {
  CreateIncidentBody,
  UpdateIncidentBody,
  ListIncidentsQueryParams,
  GetRecentIncidentsQueryParams,
  GetIncidentCountsByTopicQueryParams,
} from "@workspace/api-zod";
import {
  defaultRelevanceCondition,
  currentMaritimeSemanticProjectionCondition,
  validatedMaritimeIncidentCondition,
  wantsRaw,
} from "../lib/relevanceFilter";
import { evaluateIncidentRelevance } from "@workspace/relevance";
import { requireAdminToken } from "../lib/adminAuth";
import {
  validateAndPersistMaritimeWriterRows,
} from "@workspace/ingest";

const router: IRouter = Router();

/**
 * Run an id-keyed query in batches and concatenate the results.
 *
 * Postgres accepts at most 65,535 bind parameters per statement, and drizzle's
 * `inArray` spends one per id. Any read that fans out over "every incident we
 * just selected" therefore breaks once the workspace grows past that many rows
 * — with a hard 500, not a truncated result. 1,000 ids per statement keeps the
 * round trips low while leaving the parameter budget untouchable.
 */
const ID_BATCH = 1000;
async function selectInBatches<T>(
  ids: number[],
  query: (batch: number[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length <= ID_BATCH) return ids.length === 0 ? [] : query(ids);
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    out.push(...(await query(ids.slice(i, i + ID_BATCH))));
  }
  return out;
}

// Incident reads are live operational views. Express's generated ETag can make
// an authenticated browser reuse a pre-backfill response because relevance
// updates change which rows qualify without necessarily changing the response
// validator the client already holds. Ignore conditional validators and forbid
// storage so a relevance cleanup is visible on the next poll/reload.
router.use((req, res, next) => {
  if (req.method === "GET") {
    delete req.headers["if-none-match"];
    delete req.headers["if-modified-since"];
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
  }
  next();
});

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(v ?? "", 10);
  return Number.isNaN(n) ? -1 : n;
}

type IncidentRow = typeof incidentsTable.$inferSelect;

function isMaritimeTopic(topic: string | null | undefined): boolean {
  return topic === "shipping" || topic === "maritime";
}

function maritimeValidation(
  row: IncidentRow,
  semantic: typeof maritimeSemanticEvidenceTable.$inferSelect | undefined,
) {
  if (!isMaritimeTopic(row.topic)) {
    return {
      status: "not_applicable" as const,
      version: null,
      reason: null,
      evaluatedAt: null,
    };
  }
  if (!semantic) {
    return {
      status: "pending" as const,
      version: null,
      reason: "awaiting current source-backed semantic validation",
      evaluatedAt: null,
    };
  }
  return {
    status:
      semantic.verdict === "valid"
        ? ("validated" as const)
        : semantic.verdict === "invalid"
          ? ("rejected" as const)
          : ("pending" as const),
    version: semantic.version,
    reason: semantic.reason,
    evaluatedAt: semantic.evaluatedAt,
  };
}

/**
 * Attach each incident's OFFICIAL corroborating references (ReliefWeb etc.) as
 * a `corroborations` array. Batched (one query for all ids) and grouped in
 * memory so the list endpoint stays a single extra round-trip. Returns rows
 * with an always-present (possibly empty) array. Corroboration is a SEPARATE
 * signal — it is additive read-only context and never alters `confidence`.
 */
export async function withCorroborations(rows: IncidentRow[]): Promise<unknown[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  // An `inArray` over the whole id list sends ONE bind parameter per id, and
  // Postgres refuses any statement with more than 65,535 of them. Unfiltered
  // and country-superset incident fetches routinely exceed that, and the
  // failure is not graceful: the whole /incidents request 500s, so every
  // surface built on it (country reports, the spot-report incident picker,
  // monitors) renders as "loading forever" or "no incidents". Query in
  // batches and merge instead — the limit can never be reached however large
  // the result set grows.
  const links = await selectInBatches(ids, (batch) =>
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
  );
  const byIncident = new Map<number, Omit<(typeof links)[number], "incidentId">[]>();
  for (const { incidentId, ...rest } of links) {
    const bucket = byIncident.get(incidentId);
    if (bucket) bucket.push(rest);
    else byIncident.set(incidentId, [rest]);
  }
  const withCorr = rows.map((r) => ({
    ...r,
    corroborations: byIncident.get(r.id) ?? [],
  }));
  const semantics = await selectInBatches(ids, (batch) =>
    db
      .select({ semantic: maritimeSemanticEvidenceTable })
      .from(maritimeSemanticEvidenceTable)
      .innerJoin(
        incidentsTable,
        eq(incidentsTable.id, maritimeSemanticEvidenceTable.incidentId),
      )
      .where(and(
        inArray(maritimeSemanticEvidenceTable.incidentId, batch),
        currentMaritimeSemanticProjectionCondition(),
      ))
      .orderBy(desc(maritimeSemanticEvidenceTable.evaluatedAt)),
  );
  const semanticByIncident = new Map<number, (typeof semantics)[number]["semantic"]>();
  for (const joined of semantics) {
    const row = joined.semantic;
    if (!semanticByIncident.has(row.incidentId)) {
      semanticByIncident.set(row.incidentId, row);
    }
  }
  return withCorr.map((row) => {
    const semantic = semanticByIncident.get(row.id);
    if (!semantic) {
      return {
        ...row,
        maritimeSemantic: null,
        maritimeValidation: maritimeValidation(row, undefined),
      };
    }
    return {
      ...row,
      maritimeValidation: maritimeValidation(row, semantic),
      maritimeSemantic: {
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
      },
    };
  });
}

async function validateAndPersistMaritime(row: IncidentRow): Promise<IncidentRow> {
  if (!isMaritimeTopic(row.topic)) {
    // Topic changes invalidate the current projection, while the append-only
    // decision ledger remains available for audit.
    await db
      .delete(maritimeSemanticEvidenceTable)
      .where(eq(maritimeSemanticEvidenceTable.incidentId, row.id));
    return row;
  }
  await validateAndPersistMaritimeWriterRows([row]);
  const [current] = await db
    .select()
    .from(incidentsTable)
    .where(eq(incidentsTable.id, row.id));
  return current ?? row;
}

router.get("/incidents", async (req, res): Promise<void> => {
  const parsed = ListIncidentsQueryParams.safeParse({ ...req.query, days: req.query.days ? Number(req.query.days) : undefined });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { topic, country, severity, days, search, countryLike } = parsed.data;
  const conditions = [];
  if (topic) conditions.push(eq(incidentsTable.topic, topic));
  if (country) conditions.push(eq(incidentsTable.country, country));
  if (severity) conditions.push(eq(incidentsTable.severity, severity));
  if (days) {
    const since = new Date(Date.now() - days * 86400000);
    conditions.push(gte(incidentsTable.occurredAt, since));
  }
  if (search) {
    conditions.push(
      or(
        ilike(incidentsTable.title, `%${search}%`),
        ilike(incidentsTable.summary, `%${search}%`),
        ilike(incidentsTable.country, `%${search}%`),
      )!,
    );
  }
  // Superset country pre-filter: an OR of case-insensitive substring matches on
  // the `country` field for each comma-separated token. DISTINCT from the exact
  // `country` param above — the country field is a semicolon-compound list
  // ("South Korea; Iran"), so an exact eq is useless for the country report.
  // Every token the caller sends is, by construction, an exact segment the
  // client's incidentMatchesCountry accepts, so this returns a guaranteed
  // SUPERSET of the rows the page keeps: it only trims payload (and the
  // corroboration join), never the authoritative client-side country gate.
  // LIKE metacharacters are stripped so a stray token can't widen the pattern.
  // (Assumes country names contain no LIKE metachars — true for every group name
  // today; a name that did would NARROW below the exact client match and starve
  // that brief, so escape rather than strip if that ever changes.)
  if (countryLike) {
    const tokens = countryLike
      .split(",")
      .map((t) => t.trim().replace(/[%_\\]/g, ""))
      .filter(Boolean);
    if (tokens.length > 0) {
      conditions.push(
        or(...tokens.map((t) => ilike(incidentsTable.country, `%${t}%`)))!,
      );
    }
  }
  if (!wantsRaw(req.query)) conditions.push(defaultRelevanceCondition());
  const rows = await db
    .select()
    .from(incidentsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(incidentsTable.occurredAt));
  res.json(await withCorroborations(rows));
});

router.get("/incidents/recent", async (req, res): Promise<void> => {
  const parsed = GetRecentIncidentsQueryParams.safeParse({ ...req.query, limit: req.query.limit ? Number(req.query.limit) : undefined });
  const limit = parsed.success ? parsed.data.limit ?? 10 : 10;
  const rows = await db
    .select()
    .from(incidentsTable)
    .where(wantsRaw(req.query) ? undefined : defaultRelevanceCondition())
    .orderBy(desc(incidentsTable.occurredAt))
    .limit(limit);
  res.json(await withCorroborations(rows));
});

router.get("/incidents/by-topic", async (req, res): Promise<void> => {
  const parsed = GetIncidentCountsByTopicQueryParams.safeParse({ ...req.query, days: req.query.days ? Number(req.query.days) : undefined });
  const days = parsed.success ? parsed.data.days ?? 30 : 30;
  const since = new Date(Date.now() - days * 86400000);
  const byTopicConds = [gte(incidentsTable.occurredAt, since)];
  if (!wantsRaw(req.query)) {
    byTopicConds.push(
      defaultRelevanceCondition(),
      validatedMaritimeIncidentCondition(),
    );
  }
  const rows = await db
    .select({
      topic: incidentsTable.topic,
      count: sql<number>`count(*)::int`,
      criticalCount: sql<number>`sum(case when ${incidentsTable.severity} = 'extreme' then 1 else 0 end)::int`,
    })
    .from(incidentsTable)
    .where(and(...byTopicConds))
    .groupBy(incidentsTable.topic);
  if (!wantsRaw(req.query)) {
    const [shipping] = await db
      .select({
        count: sql<number>`count(distinct ${maritimeSemanticEvidenceTable.developmentKey})::int`,
        criticalCount: sql<number>`count(distinct case
          when ${maritimeSemanticEvidenceTable.severity} = 'extreme'
          then ${maritimeSemanticEvidenceTable.developmentKey}
          else null end)::int`,
      })
      .from(incidentsTable)
      .innerJoin(
        maritimeSemanticEvidenceTable,
        and(
          eq(maritimeSemanticEvidenceTable.incidentId, incidentsTable.id),
          currentMaritimeSemanticProjectionCondition(),
        ),
      )
      .where(and(
        eq(incidentsTable.topic, "shipping"),
        gte(incidentsTable.occurredAt, since),
        defaultRelevanceCondition(),
        validatedMaritimeIncidentCondition(),
      ));
    const withoutShipping = rows.filter((row) => row.topic !== "shipping");
    if ((shipping?.count ?? 0) > 0) {
      withoutShipping.push({
        topic: "shipping",
        count: shipping?.count ?? 0,
        criticalCount: shipping?.criticalCount ?? 0,
      });
    }
    res.json(withoutShipping);
    return;
  }
  res.json(rows);
});

router.get("/incidents/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const detailConditions = [eq(incidentsTable.id, id)];
  if (!wantsRaw(req.query)) detailConditions.push(defaultRelevanceCondition());
  const [row] = await db
    .select()
    .from(incidentsTable)
    .where(and(...detailConditions));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [withCorr] = await withCorroborations([row]);
  res.json(withCorr);
});

router.post("/incidents", requireAdminToken, async (req, res): Promise<void> => {
  const parsed = CreateIncidentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rel = evaluateIncidentRelevance(parsed.data.topic, {
    topic: parsed.data.topic,
    title: parsed.data.title,
    summary: parsed.data.summary ?? "",
    source: parsed.data.source ?? "",
    sourceUrl: parsed.data.sourceUrl ?? "",
    location: parsed.data.location ?? null,
  });
  const isMaritime = isMaritimeTopic(parsed.data.topic);
  const [row] = await db
    .insert(incidentsTable)
    .values({
      ...parsed.data,
      // Legacy incidents.country is not semantic evidence. Maritime rows
      // remain unassigned until the source-grounded semantic projection says
      // otherwise; the API never trusts a client-supplied country here.
      ...(isMaritime ? { country: "Unknown" } : {}),
      relevanceStatus: rel.status,
      relevanceScore: rel.score,
      relevanceReason: rel.reason,
      relevanceVersion: rel.version,
      relevanceEvaluatedAt: new Date(),
      ...(parsed.data.topic === "flashpoint" || parsed.data.topic === "protests" ? {
        validityStatus: "needs_review",
        validityScore: 0,
        validityReason: "awaiting source-backed semantic validation",
        validityVersion: null,
        validityEvaluatedAt: null,
        validityGates: null,
      } : {}),
    })
    .returning();
    const current = await validateAndPersistMaritime(row);
    const [withSemantic] = await withCorroborations([current]);
   res.status(201).json(withSemantic);
});

router.patch("/incidents/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateIncidentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select({ topic: incidentsTable.topic })
    .from(incidentsTable)
    .where(eq(incidentsTable.id, id));
  const maritimeAfterUpdate = isMaritimeTopic(
    parsed.data.topic ?? existing?.topic,
  );
  const validityEvidenceChanged = [
    "topic", "title", "displayTitle", "summary", "source", "sourceUrl",
    "country", "location", "occurredAt", "incidentDate",
  ]
    .some((key) => Object.prototype.hasOwnProperty.call(parsed.data, key));
  const [row] = await db
    .update(incidentsTable)
    .set(validityEvidenceChanged ? {
      ...parsed.data,
      ...(maritimeAfterUpdate ? { country: "Unknown" } : {}),
      validityStatus: null, validityScore: null, validityReason: null,
      validityVersion: null, validityEvaluatedAt: null, validityGates: null,
      } : {
        ...parsed.data,
        ...(maritimeAfterUpdate ? { country: "Unknown" } : {}),
      })
    .where(eq(incidentsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
    const current = await validateAndPersistMaritime(row);
    const [withSemantic] = await withCorroborations([current]);
   res.json(withSemantic);
});

router.delete("/incidents/:id", requireAdminToken, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  await db.delete(incidentsTable).where(eq(incidentsTable.id, id));
  res.status(204).end();
});

export default router;
