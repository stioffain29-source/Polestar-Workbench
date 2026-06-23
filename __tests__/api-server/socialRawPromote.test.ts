import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// CORE PRODUCT INVARIANT under test (see lib/db/src/schema/socialRaw.ts):
// a Facebook OSINT post is supporting CONTEXT, NEVER an incident. The only path
// from the `social_raw` table into `incidents` is the explicit, server-RE-DERIVED
// PROMOTE action, and only for a post that is BOTH security-relevant AND credible
// (declared official/local-media page, linked credible domain, or cross-feed
// corroboration) AND not already a tracked incident.
//
// This regression test mounts the REAL incidents + social-raw routers on an
// Express app, drives them over HTTP, and backs them with a small STATEFUL
// in-memory DB so the cross-route count effect is exercised end to end:
//   - landing social_raw rows leaves GET /api/incidents?topic=flashpoint
//     unchanged (social rows never reach the incidents table);
//   - a non-promotable item cannot be promoted (409) and adds nothing;
//   - a promotable item adds EXACTLY one incident and back-links it;
//   - re-promoting returns 409 and adds nothing more;
//   - a post that duplicates a tracked incident is blocked (409).

import { db, incidentsTable, socialRawTable } from "@workspace/db";
import incidentsRouter from "../../artifacts/api-server/src/routes/incidents";
import socialRawRouter from "../../artifacts/api-server/src/routes/socialRaw";
import {
  adminAuthHeaders,
  enableTestAdminToken,
} from "./adminAuthTestHelpers";

// ---------------------------------------------------------------------------
// Stateful in-memory DB backing both routers.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

let incidents: Row[] = [];
let socialItems: Row[] = [];
let nextIncidentId = 1;

// Recursively collect numeric bound values from a Drizzle where clause so the
// promote `where(eq(id, n))` lookup/update can filter by id. The incident
// candidate query filters by Date/string only (no numbers), so it never
// accidentally narrows; incident reads return the whole seeded set.
function collectNumbers(node: unknown, out: number[], seen: Set<unknown>): void {
  if (node === null || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  const rec = node as Record<string, unknown>;
  if (typeof rec.value === "number") out.push(rec.value);
  for (const v of Object.values(rec)) {
    if (Array.isArray(v)) v.forEach((x) => collectNumbers(x, out, seen));
    else if (v && typeof v === "object") collectNumbers(v, out, seen);
  }
}

// ---------------------------------------------------------------------------
// Faithful evaluation of the GET /social-raw WHERE clause.
//
// The list route filters social rows with eq() / isNull() / isNotNull() leaves
// combined by and() / or() — e.g. `?reviewFlagged=true` -> eq(reviewFlag,true);
// `?eligible=true` -> and(eq(promotable,true), isNull(promotedIncidentId)). To
// exercise those filters end to end the stub must HONOUR the predicate;
// returning every row regardless would let a broken filter pass unnoticed.
//
// Columns are matched by REFERENCE against the table's own column objects (the
// same Column instances the route passes to eq()/isNull()), so no
// snake_case/camelCase mapping is needed. Operators are read from the
// StringChunk text drizzle bakes into each SQL node; values from the bound
// Param. This walks the real drizzle-orm AST, so it tracks the route exactly.
const SOCIAL_COL_TO_KEY = new Map<unknown, string>([
  [socialRawTable.id, "id"],
  [socialRawTable.sourceName, "sourceName"],
  [socialRawTable.country, "country"],
  [socialRawTable.category, "category"],
  [socialRawTable.promotable, "promotable"],
  [socialRawTable.promotedIncidentId, "promotedIncidentId"],
  [socialRawTable.reviewFlag, "reviewFlag"],
]);

function isSqlNode(n: unknown): n is { queryChunks: unknown[] } {
  return (
    !!n &&
    typeof n === "object" &&
    Array.isArray((n as { queryChunks?: unknown }).queryChunks)
  );
}
// A drizzle StringChunk holds its text in a `value` string[] — return the joined
// text, or null for anything that is not a StringChunk.
function asStringChunk(n: unknown): string | null {
  if (
    !!n &&
    typeof n === "object" &&
    Array.isArray((n as { value?: unknown }).value) &&
    (n as { value: unknown[] }).value.every((x) => typeof x === "string")
  ) {
    return (n as { value: string[] }).value.join("");
  }
  return null;
}
function isParamNode(n: unknown): n is { value: unknown } {
  return (
    !!n &&
    typeof n === "object" &&
    "encoder" in (n as object) &&
    "value" in (n as object)
  );
}

type Pred = (row: Row) => boolean;

function buildWherePredicate(node: unknown): Pred {
  if (!isSqlNode(node)) return () => true;
  const chunks = node.queryChunks;
  const colChunk = chunks.find((c) => SOCIAL_COL_TO_KEY.has(c));
  if (colChunk) {
    // Leaf comparison: eq / isNull / isNotNull on one column.
    const key = SOCIAL_COL_TO_KEY.get(colChunk)!;
    const opText = chunks
      .map(asStringChunk)
      .filter((t): t is string => t !== null)
      .join("");
    if (opText.includes("not null")) return (r) => r[key] != null;
    if (opText.includes("is null")) return (r) => r[key] == null;
    const param = chunks.find(isParamNode) as { value: unknown } | undefined;
    const val = param?.value;
    return (r) => r[key] === val;
  }
  // Combinator (and/or): drizzle wraps the operands in a nested join SQL whose
  // separator (" and " / " or ") carries the operator. Collect the operand
  // condition nodes and the operator at this level, then recurse into each.
  const operands: unknown[] = [];
  let op: "and" | "or" = "and";
  const visit = (n: { queryChunks: unknown[] }): void => {
    for (const ch of n.queryChunks) {
      if (isSqlNode(ch)) {
        const seps = ch.queryChunks
          .map(asStringChunk)
          .filter((t): t is string => t !== null)
          .join("");
        if (seps.includes(" or ") || seps.includes(" and ")) {
          if (seps.includes(" or ")) op = "or";
          visit(ch); // dig into the join to reach its operand conditions
        } else {
          operands.push(ch);
        }
      } else {
        const t = asStringChunk(ch);
        if (t && t.includes(" or ")) op = "or";
      }
    }
  };
  visit(node);
  const preds = operands.map(buildWherePredicate);
  return op === "or"
    ? (r) => preds.some((p) => p(r))
    : (r) => preds.every((p) => p(r));
}

function resolveSelect(table: unknown, where: unknown): Promise<Row[]> {
  if (table === incidentsTable)
    return Promise.resolve(incidents.map((r) => ({ ...r })));
  if (table === socialRawTable) {
    const pred = buildWherePredicate(where);
    const rows = socialItems.filter((r) => pred(r));
    return Promise.resolve(rows.map((r) => ({ ...r })));
  }
  return Promise.resolve([]);
}

function selectChain(): Record<string, unknown> {
  const state: { table: unknown; where: unknown } = { table: null, where: null };
  const settle = () => resolveSelect(state.table, state.where);
  const chain: Record<string, unknown> = {
    from: (t: unknown) => {
      state.table = t;
      return chain;
    },
    where: (c: unknown) => {
      state.where = c;
      return chain;
    },
    orderBy: () => chain,
    limit: () => chain,
    groupBy: () => chain,
    then: (res: (v: Row[]) => unknown, rej?: (e: unknown) => unknown) =>
      settle().then(res, rej),
    catch: (rej: (e: unknown) => unknown) => settle().catch(rej),
    finally: (f: () => void) => settle().finally(f),
  };
  return chain;
}

// Apply an UPDATE against the in-memory socialItems, modelling the promote
// claim's `WHERE id = ? AND promoted_incident_id IS NULL` guard: a write that
// SETS promotedIncidentId only lands on rows still unpromoted (so a second,
// racing claim matches 0 rows). Returns the rows actually changed, mirroring
// Postgres `... RETURNING`. Memoised so awaiting AND calling .returning() on the
// same builder never double-applies.
function makeUpdateBuilder(table: unknown, vals: Row, cond: unknown) {
  let ran = false;
  let changed: Row[] = [];
  const apply = (): Row[] => {
    if (ran) return changed;
    ran = true;
    if (table === socialRawTable) {
      const ids: number[] = [];
      collectNumbers(cond, ids, new Set());
      const isClaim = Object.prototype.hasOwnProperty.call(
        vals,
        "promotedIncidentId",
      );
      for (const it of socialItems) {
        if (ids.length === 0 || ids.includes(it.id as number)) {
          if (isClaim && it.promotedIncidentId != null) continue;
          Object.assign(it, vals);
          changed.push(it);
        }
      }
    }
    return changed;
  };
  return {
    returning: async () => apply(),
    then: (res: (v: Row[]) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(apply()).then(res, rej),
    catch: (rej: (e: unknown) => unknown) => Promise.resolve(apply()).catch(rej),
    finally: (f: () => void) => Promise.resolve(apply()).finally(f),
  };
}

function installDbStub(): void {
  jest.spyOn(db, "select").mockImplementation(() => selectChain() as never);

  // The review-status PATCH updates the row OUTSIDE a transaction, so mock the
  // top-level db.update with the same builder the transaction uses. A non-claim
  // SET (reviewStatus + updatedAt) lands on the row matched by id.
  jest.spyOn(db, "update").mockImplementation(
    (table: unknown) =>
      ({
        set: (vals: Row) => ({
          where: (cond: unknown) => makeUpdateBuilder(table, vals, cond),
        }),
      }) as never,
  );

  // The only sanctioned incident write goes through promote's transaction, which
  // here SNAPSHOTS and ROLLS BACK on throw so a guard rejection (e.g. a lost
  // concurrent claim) undoes the speculative incident insert — exactly like a
  // real Postgres transaction.
  (db as unknown as { transaction: unknown }).transaction = jest.fn(
    async (fn: (tx: unknown) => unknown) => {
      const snapIncidents = incidents.map((r) => ({ ...r }));
      const snapSocial = socialItems.map((r) => ({ ...r }));
      const snapNext = nextIncidentId;
      const tx = {
        insert: (table: unknown) => ({
          values: (vals: Row) => ({
            returning: async () => {
              if (table === incidentsTable) {
                const row = { id: nextIncidentId++, ...vals };
                incidents.push(row);
                return [row];
              }
              return [];
            },
          }),
        }),
        update: (table: unknown) => ({
          set: (vals: Row) => ({
            where: (cond: unknown) => makeUpdateBuilder(table, vals, cond),
          }),
        }),
      };
      try {
        return await fn(tx);
      } catch (err) {
        incidents = snapIncidents;
        socialItems = snapSocial;
        nextIncidentId = snapNext;
        throw err;
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Express harness.
// ---------------------------------------------------------------------------

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll((done) => {
  enableTestAdminToken();
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: { info: () => void; warn: () => void } }).log = {
      info: () => {},
      warn: () => {},
    };
    next();
  });
  app.use("/api", incidentsRouter);
  app.use("/api", socialRawRouter);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    done();
  });
});

afterAll((done) => {
  server.close(() => done());
});

beforeEach(() => {
  incidents = [];
  socialItems = [];
  nextIncidentId = 1;
  installDbStub();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function flashpointIncidentCount(): Promise<number> {
  const res = await fetch(`${baseUrl}/api/incidents?topic=flashpoint`);
  const body = (await res.json()) as unknown[];
  expect(res.status).toBe(200);
  return body.length;
}

async function promote(id: number) {
  const res = await fetch(`${baseUrl}/api/social-raw/${id}/promote`, {
    method: "POST",
    headers: adminAuthHeaders(),
  });
  return { status: res.status, json: await res.json() };
}

function seedFlashpointIncidents(n: number): void {
  for (let i = 0; i < n; i++) {
    incidents.push({
      id: nextIncidentId++,
      topic: "flashpoint",
      title: `Existing flashpoint incident ${i}`,
      country: "Papua New Guinea",
      occurredAt: new Date("2026-06-15T00:00:00Z"),
      severity: "low",
      relevanceStatus: "relevant",
    });
  }
}

function seedSocialRawItem(over: Partial<Row> = {}): Row {
  const item: Row = {
    id: nextIncidentId++,
    sourceName: "facebook_osint",
    platform: "facebook",
    pageHandle: "papuanewsdesk",
    pageName: "Papua News Desk",
    sourceTier: "official",
    externalId: `fb_${Math.random().toString(36).slice(2)}`,
    postedAt: new Date("2026-06-20T00:00:00Z"),
    incidentDate: new Date("2026-06-20T00:00:00Z"),
    caption: "Armed robbery and shooting at a store in Port Moresby",
    imageUrls: [],
    links: [],
    detectedCredibleDomains: [],
    country: "Papua New Guinea",
    province: "National Capital District",
    location: "Port Moresby",
    category: "Armed robbery / hold-up",
    businessImpact: "Retail premises disrupted.",
    securityRelevant: true,
    credible: true,
    credibilityReason: "Monitored page is a declared official source",
    corroborated: false,
    corroborationReason: null,
    corroboratingIncidentId: null,
    promotionTopic: "conflict",
    url: "https://www.facebook.com/p/abc123/",
    classification: "context",
    reviewStatus: "pending_review",
    promotable: true,
    promotedIncidentId: null,
    promotedAt: null,
    createdAt: new Date("2026-06-20T01:00:00Z"),
    updatedAt: new Date("2026-06-20T01:00:00Z"),
    ...over,
  };
  socialItems.push(item);
  return item;
}

describe("Facebook OSINT posts never inflate the incident count", () => {
  it("leaves the incident count unchanged when social_raw rows land", async () => {
    seedFlashpointIncidents(3);
    const before = await flashpointIncidentCount();
    expect(before).toBe(3);

    seedSocialRawItem({ promotable: true });
    seedSocialRawItem({ promotable: false, sourceTier: "osint", credible: false });
    seedSocialRawItem({ promotable: true });

    expect(await flashpointIncidentCount()).toBe(3);
  });

  it("404s when promoting an item that does not exist", async () => {
    seedFlashpointIncidents(1);
    const before = await flashpointIncidentCount();
    const { status } = await promote(999999);
    expect(status).toBe(404);
    expect(await flashpointIncidentCount()).toBe(before);
  });

  it("refuses to promote an unverified OSINT item (no credible signal)", async () => {
    seedFlashpointIncidents(2);
    // The server RE-DERIVES eligibility from the stored row, so even though this
    // seed says promotable:true, an osint tier with no domains / corroboration
    // is re-derived as NOT credible and rejected.
    const item = seedSocialRawItem({
      sourceTier: "osint",
      detectedCredibleDomains: [],
      corroborated: false,
      promotable: true,
    });
    const before = await flashpointIncidentCount();
    const { status, json } = await promote(item.id as number);
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/not promotable/i);
    expect(await flashpointIncidentCount()).toBe(before);
    expect(item.promotedIncidentId).toBeNull();
  });

  it("refuses to promote a non-security category", async () => {
    seedFlashpointIncidents(1);
    const item = seedSocialRawItem({
      category: "Other security",
      sourceTier: "official",
    });
    const before = await flashpointIncidentCount();
    const { status, json } = await promote(item.id as number);
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/security-relevant/i);
    expect(await flashpointIncidentCount()).toBe(before);
  });

  it("adds exactly one incident when a credible item is promoted and back-links it", async () => {
    seedFlashpointIncidents(4);
    const item = seedSocialRawItem({ sourceTier: "official" });
    const before = await flashpointIncidentCount();
    expect(before).toBe(4);

    const { status, json } = await promote(item.id as number);
    expect(status).toBe(201);
    expect(json.topic).toBe("conflict"); // armed robbery -> conflict
    expect(typeof json.id).toBe("number");

    expect(await flashpointIncidentCount()).toBe(before + 1);
    expect(item.promotedIncidentId).toBe(json.id);
    expect(item.promotedAt).not.toBeNull();
  });

  it("returns 409 on re-promote and never creates a second incident", async () => {
    seedFlashpointIncidents(1);
    const item = seedSocialRawItem({ sourceTier: "official" });

    const first = await promote(item.id as number);
    expect(first.status).toBe(201);
    const afterFirst = await flashpointIncidentCount();

    const second = await promote(item.id as number);
    expect(second.status).toBe(409);
    expect(String(second.json.error)).toMatch(/already promoted/i);
    expect(second.json.incidentId).toBe(first.json.id);
    expect(await flashpointIncidentCount()).toBe(afterFirst);
  });

  it("creates exactly one incident under two concurrent promotes", async () => {
    seedFlashpointIncidents(2);
    const item = seedSocialRawItem({ sourceTier: "official" });
    const before = await flashpointIncidentCount();

    // Fire both promotes without awaiting in between so they race. Whichever
    // ordering the event loop picks, the pre-check OR the in-transaction
    // `promoted_incident_id IS NULL` claim must let exactly one win; the loser's
    // speculative incident insert rolls back.
    const [a, b] = await Promise.all([
      promote(item.id as number),
      promote(item.id as number),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = a.status === 201 ? a : b;
    expect(await flashpointIncidentCount()).toBe(before + 1);
    expect(item.promotedIncidentId).toBe(winner.json.id);
  });

  it("blocks promotion of a post that duplicates a tracked incident", async () => {
    // A live incident the post would double-count: same country, same day, same
    // category, high token overlap.
    incidents.push({
      id: nextIncidentId++,
      topic: "flashpoint",
      title: "Violent demonstration blockade outside parliament damages vehicles",
      summary: "Protesters blockaded the parliament building and damaged vehicles",
      country: "Papua New Guinea",
      province: "National Capital District",
      category: "Civil unrest / protest",
      occurredAt: new Date("2026-06-20T00:00:00Z"),
      incidentDate: new Date("2026-06-20T00:00:00Z"),
    });
    const before = await flashpointIncidentCount();

    const item = seedSocialRawItem({
      category: "Civil unrest / protest",
      sourceTier: "official",
      promotionTopic: "flashpoint",
      caption:
        "Violent demonstration blockade outside parliament building damaged vehicles",
      location: "National Capital District",
    });
    const { status, json } = await promote(item.id as number);
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/duplicate/i);
    expect(typeof json.incidentId).toBe("number");
    expect(await flashpointIncidentCount()).toBe(before);
    expect(item.promotedIncidentId).toBeNull();
  });

  it("reports the promoted item with its promotedIncidentId on GET /social-raw", async () => {
    seedFlashpointIncidents(1);
    const item = seedSocialRawItem({ sourceTier: "official" });
    const { json: created } = await promote(item.id as number);

    const res = await fetch(`${baseUrl}/api/social-raw`);
    const rows = (await res.json()) as Row[];
    expect(res.status).toBe(200);
    const promoted = rows.find((r) => r.id === item.id);
    expect(promoted).toBeDefined();
    expect(promoted!.promotedIncidentId).toBe(created.id);
  });
});

// ---------------------------------------------------------------------------
// GET /social-raw review + eligibility filters.
//
// These exercise the analyst-facing queues: `?reviewFlagged=true` (items the
// engine flagged for human review) and `?eligible=true` (the actionable
// promote queue = promotable AND not yet promoted). The in-memory stub honours
// the real drizzle WHERE clause (see buildWherePredicate), so a regression that
// drops or inverts a filter condition fails here rather than silently passing.
//
// NOTE on the false/complement branch: the query params use
// `zod.coerce.boolean()` (the pre-existing repo pattern for promotable/promoted
// too), under which any NON-EMPTY string — including "false" — coerces to
// `true`. The only way an HTTP caller yields a parsed `false` is an EMPTY value
// (`?eligible=`), which is what the complement test sends.
describe("GET /social-raw review + eligibility filters", () => {
  async function listSocialRaw(qs: string): Promise<Row[]> {
    const res = await fetch(`${baseUrl}/api/social-raw${qs}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Row[];
  }

  it("?reviewFlagged=true returns only review-flagged rows", async () => {
    seedSocialRawItem({ reviewFlag: true, caption: "flagged A" });
    seedSocialRawItem({ reviewFlag: false, caption: "not flagged" });
    seedSocialRawItem({ reviewFlag: true, caption: "flagged B" });

    const flagged = await listSocialRaw("?reviewFlagged=true");
    expect(flagged.length).toBe(2);
    expect(flagged.every((r) => r.reviewFlag === true)).toBe(true);
  });

  it("?eligible=true returns only promotable, not-yet-promoted rows", async () => {
    seedSocialRawItem({ promotable: true, promotedIncidentId: null }); // eligible
    seedSocialRawItem({ promotable: false, promotedIncidentId: null }); // not promotable
    seedSocialRawItem({ promotable: true, promotedIncidentId: 4242 }); // already promoted

    const eligible = await listSocialRaw("?eligible=true");
    expect(eligible.length).toBe(1);
    expect(eligible[0].promotable).toBe(true);
    expect(eligible[0].promotedIncidentId).toBeNull();
  });

  it("?eligible= (empty -> false) returns the complement: not promotable OR already promoted", async () => {
    seedSocialRawItem({ promotable: true, promotedIncidentId: null }); // eligible -> excluded
    seedSocialRawItem({ promotable: false, promotedIncidentId: null }); // included
    seedSocialRawItem({ promotable: true, promotedIncidentId: 4242 }); // included

    const complement = await listSocialRaw("?eligible=");
    expect(complement.length).toBe(2);
    expect(
      complement.every(
        (r) => r.promotable === false || r.promotedIncidentId != null,
      ),
    ).toBe(true);
  });

  it("a real promote drops the row out of the ?eligible=true queue", async () => {
    seedFlashpointIncidents(0);
    const item = seedSocialRawItem({ sourceTier: "official", promotable: true });

    const before = await listSocialRaw("?eligible=true");
    expect(before.some((r) => r.id === item.id)).toBe(true);

    const { status } = await promote(item.id as number);
    expect(status).toBe(201);

    const after = await listSocialRaw("?eligible=true");
    expect(after.some((r) => r.id === item.id)).toBe(false);
    const complement = await listSocialRaw("?eligible=");
    expect(complement.some((r) => r.id === item.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Analyst review actions. A non-destructive PATCH lets the analyst triage a row
// (ignore / keep-as-context / re-open) WITHOUT minting an incident. Promote is
// the only path that fixes the row to 'promoted'; an already-promoted row is
// frozen so its decided status can never be overwritten.
// ---------------------------------------------------------------------------
describe("PATCH /social-raw/:id/review-status", () => {
  async function setReview(id: number, reviewStatus: string) {
    const res = await fetch(`${baseUrl}/api/social-raw/${id}/review-status`, {
      method: "PATCH",
      headers: adminAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ reviewStatus }),
    });
    return { status: res.status, json: await res.json() };
  }

  it("ignores / keeps-as-context / re-opens a row and persists each transition", async () => {
    seedFlashpointIncidents(2);
    const incidentsBefore = incidents.length;
    const item = seedSocialRawItem({ reviewStatus: "pending_review" });

    const ignored = await setReview(item.id as number, "ignored");
    expect(ignored.status).toBe(200);
    expect(ignored.json.reviewStatus).toBe("ignored");
    expect(socialItems.find((r) => r.id === item.id)!.reviewStatus).toBe(
      "ignored",
    );

    const context = await setReview(item.id as number, "context");
    expect(context.status).toBe(200);
    expect(socialItems.find((r) => r.id === item.id)!.reviewStatus).toBe(
      "context",
    );

    const reopened = await setReview(item.id as number, "pending_review");
    expect(reopened.status).toBe(200);
    expect(socialItems.find((r) => r.id === item.id)!.reviewStatus).toBe(
      "pending_review",
    );

    // Triage is non-destructive: NO incident is ever minted by a review action.
    expect(incidents.length).toBe(incidentsBefore);
  });

  it("rejects an unknown review status with 400 and writes nothing", async () => {
    const item = seedSocialRawItem({ reviewStatus: "pending_review" });
    const bad = await setReview(item.id as number, "archived");
    expect(bad.status).toBe(400);
    expect(socialItems.find((r) => r.id === item.id)!.reviewStatus).toBe(
      "pending_review",
    );
  });

  it("refuses to set 'promoted' via PATCH (400) — only promote may do that", async () => {
    const item = seedSocialRawItem({ reviewStatus: "pending_review" });
    const bad = await setReview(item.id as number, "promoted");
    expect(bad.status).toBe(400);
    expect(socialItems.find((r) => r.id === item.id)!.reviewStatus).toBe(
      "pending_review",
    );
  });

  it("returns 404 for a row that does not exist", async () => {
    const res = await setReview(9999, "ignored");
    expect(res.status).toBe(404);
  });

  it("refuses to re-review an already-promoted row (409)", async () => {
    const item = seedSocialRawItem({
      reviewStatus: "promoted",
      promotedIncidentId: 4242,
    });
    const res = await setReview(item.id as number, "ignored");
    expect(res.status).toBe(409);
    expect(socialItems.find((r) => r.id === item.id)!.reviewStatus).toBe(
      "promoted",
    );
  });
});

describe("promote fixes reviewStatus to 'promoted'", () => {
  it("sets reviewStatus='promoted' on a successful promote", async () => {
    seedFlashpointIncidents(0);
    const item = seedSocialRawItem({
      sourceTier: "official",
      promotable: true,
      reviewStatus: "pending_review",
    });
    const { status } = await promote(item.id as number);
    expect(status).toBe(201);
    expect(socialItems.find((r) => r.id === item.id)!.reviewStatus).toBe(
      "promoted",
    );
  });
});
