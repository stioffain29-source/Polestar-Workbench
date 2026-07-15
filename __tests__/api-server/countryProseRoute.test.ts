import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Country-report prose must degrade gracefully when the LLM is absent or fails:
// return 200 { available: false } so the client renders its deterministic
// template — never HTTP 503.

jest.mock("../../artifacts/api-server/src/lib/countryProse", () => {
  const actual = jest.requireActual("../../artifacts/api-server/src/lib/countryProse");
  return {
    ...actual,
    isLlmAvailable: jest.fn(),
    generateCountryProse: jest.fn(),
  };
});

import { db, countryReportsTable, countryReportProseTable } from "@workspace/db";
import {
  isLlmAvailable,
  generateCountryProse,
  computeProseFingerprint,
  type ProseIncidentInput,
} from "../../artifacts/api-server/src/lib/countryProse";
import proseRouter from "../../artifacts/api-server/src/routes/prose";
import {
  adminAuthHeaders,
  enableTestAdminToken,
} from "./adminAuthTestHelpers";

type Rows = Record<string, unknown>[];

function stubSelect(byTable: Map<unknown, Rows>): void {
  jest.spyOn(db, "select").mockImplementation(() => {
    let tbl: unknown = null;
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        tbl = t;
        return chain;
      },
      where: () => Promise.resolve(byTable.get(tbl) ?? []),
    };
    return chain as never;
  });
}

function stubInsert(returnRows: Rows): jest.SpyInstance {
  return jest.spyOn(db, "insert").mockImplementation(() => {
    const chain: Record<string, unknown> = {
      values: () => chain,
      onConflictDoUpdate: () => chain,
      returning: () => Promise.resolve(returnRows),
    };
    return chain as never;
  });
}

const SLUG = "indonesia";
const INCIDENTS: ProseIncidentInput[] = [
  {
    id: "1",
    title: "Security incident in Jayapura",
    summary: "A clash was reported near the city centre.",
    location: "Jayapura",
    country: "Indonesia",
    severity: "Moderate",
    occurredAt: "2026-06-12T00:00:00+00:00",
    source: "Jubi",
  },
];

const BODY = {
  region: "Southeast Asia",
  basisDays: 30,
  periodWord: "month",
  issueDate: "2026-06-17",
  incidents: INCIDENTS,
  variant: "country" as const,
};

const FINGERPRINT = computeProseFingerprint({
  slug: SLUG,
  countryName: "Indonesia",
  basisDays: BODY.basisDays,
  incidents: INCIDENTS,
  variant: "country",
});

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  enableTestAdminToken();
  app = express();
  app.use(express.json());
  // The real api-server attaches `req.log` via pino-http; this bare test app
  // does not, so stub a no-op logger before the router (the generation-failure
  // branch calls `req.log.warn`).
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    };
    next();
  });
  app.use(proseRouter);
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

beforeEach(() => {
  // The global jest.setup clears INGEST_ADMIN_TOKEN in its own beforeEach, so
  // re-enable it here or requireAdminToken 503s every request.
  enableTestAdminToken();
  jest.restoreAllMocks();
  (isLlmAvailable as jest.Mock).mockReset();
  (generateCountryProse as jest.Mock).mockReset();
});

async function postProse(body: Record<string, unknown> = BODY) {
  const res = await fetch(`${baseUrl}/countries/${SLUG}/prose`, {
    method: "POST",
    headers: adminAuthHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /countries/:slug/prose — LLM unavailable", () => {
  it("returns 200 available:false (not 503) and persists nothing", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [countryReportsTable, [{ slug: SLUG, name: "Indonesia" }]],
        [countryReportProseTable, []],
      ]),
    );
    const insertSpy = stubInsert([]);
    (isLlmAvailable as jest.Mock).mockReturnValue(false);

    const { status, json } = await postProse();

    expect(status).toBe(200);
    expect(json.available).toBe(false);
    expect(json.model).toBe("unavailable");
    expect(json.fingerprint).toBe(FINGERPRINT);
    expect(json.sections.executiveSummary).toBe("");
    expect(generateCountryProse as jest.Mock).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("returns 200 available:false when generation fails", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [countryReportsTable, [{ slug: SLUG, name: "Indonesia" }]],
        [countryReportProseTable, []],
      ]),
    );
    const insertSpy = stubInsert([]);
    (isLlmAvailable as jest.Mock).mockReturnValue(true);
    (generateCountryProse as jest.Mock).mockResolvedValue({
      ok: false,
      error: "timeout",
    });

    const { status, json } = await postProse();

    expect(status).toBe(200);
    expect(json.available).toBe(false);
    expect(json.model).toBe("unavailable");
    expect(generateCountryProse as jest.Mock).toHaveBeenCalledTimes(1);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("POST /countries/:slug/prose — cache hit", () => {
  it("serves cached prose even when the LLM is unavailable", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [countryReportsTable, [{ slug: SLUG, name: "Indonesia" }]],
        [
          countryReportProseTable,
          [
            {
              slug: SLUG,
              fingerprint: FINGERPRINT,
              sections: { executiveSummary: "Cached summary." },
              edited: null,
              model: "gpt-5.4",
              generatedAt: "2026-06-10T00:00:00.000Z",
            },
          ],
        ],
      ]),
    );
    (isLlmAvailable as jest.Mock).mockReturnValue(false);

    const { status, json } = await postProse();

    expect(status).toBe(200);
    expect(json.available).toBe(true);
    expect(json.sections.executiveSummary).toBe("Cached summary.");
    expect(json.stale).toBe(false);
    expect(generateCountryProse as jest.Mock).not.toHaveBeenCalled();
  });

  it("flags a kept edit as stale when it was written against an older basis", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [countryReportsTable, [{ slug: SLUG, name: "Indonesia" }]],
        [
          countryReportProseTable,
          [
            {
              slug: SLUG,
              fingerprint: FINGERPRINT,
              sections: { executiveSummary: "Cached summary." },
              edited: { executiveSummary: "Analyst edit." },
              editedFingerprint: "old-fingerprint",
              model: "gpt-5.4",
              generatedAt: "2026-06-10T00:00:00.000Z",
            },
          ],
        ],
      ]),
    );
    (isLlmAvailable as jest.Mock).mockReturnValue(false);

    const { status, json } = await postProse();

    expect(status).toBe(200);
    expect(json.available).toBe(true);
    expect(json.edited.executiveSummary).toBe("Analyst edit.");
    expect(json.stale).toBe(true);
    expect(generateCountryProse as jest.Mock).not.toHaveBeenCalled();
  });

  it("does not flag an edit stale when its fingerprint still matches", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [countryReportsTable, [{ slug: SLUG, name: "Indonesia" }]],
        [
          countryReportProseTable,
          [
            {
              slug: SLUG,
              fingerprint: FINGERPRINT,
              sections: { executiveSummary: "Cached summary." },
              edited: { executiveSummary: "Analyst edit." },
              editedFingerprint: FINGERPRINT,
              model: "gpt-5.4",
              generatedAt: "2026-06-10T00:00:00.000Z",
            },
          ],
        ],
      ]),
    );
    (isLlmAvailable as jest.Mock).mockReturnValue(false);

    const { status, json } = await postProse();

    expect(status).toBe(200);
    expect(json.stale).toBe(false);
  });
});

describe("POST /countries/:slug/prose — regenerate keeps the analyst edit", () => {
  it("preserves edited + editedFingerprint across a data-basis regenerate", async () => {
    // Cached row exists but its fingerprint no longer matches the new incident
    // set, so the route regenerates. The analyst edit must survive.
    stubSelect(
      new Map<unknown, Rows>([
        [countryReportsTable, [{ slug: SLUG, name: "Indonesia" }]],
        [
          countryReportProseTable,
          [
            {
              slug: SLUG,
              fingerprint: "stale-fingerprint",
              sections: { executiveSummary: "Old AI summary." },
              edited: { executiveSummary: "Analyst edit." },
              editedFingerprint: "stale-fingerprint",
              model: "gpt-5.4",
              generatedAt: "2026-06-10T00:00:00.000Z",
            },
          ],
        ],
      ]),
    );
    let capturedValues: Record<string, unknown> | null = null;
    jest.spyOn(db, "insert").mockImplementation(() => {
      const chain: Record<string, unknown> = {
        values: (v: Record<string, unknown>) => {
          capturedValues = v;
          return chain;
        },
        onConflictDoUpdate: () => chain,
        returning: () =>
          Promise.resolve([
            {
              slug: SLUG,
              fingerprint: FINGERPRINT,
              sections: { executiveSummary: "Fresh AI summary." },
              edited: { executiveSummary: "Analyst edit." },
              editedFingerprint: "stale-fingerprint",
              model: "gpt-5.5",
              generatedAt: "2026-06-17T00:00:00.000Z",
            },
          ]),
      };
      return chain as never;
    });
    (isLlmAvailable as jest.Mock).mockReturnValue(true);
    (generateCountryProse as jest.Mock).mockResolvedValue({
      ok: true,
      model: "gpt-5.5",
      sections: { executiveSummary: "Fresh AI summary." },
    });

    const { status, json } = await postProse();

    expect(status).toBe(200);
    expect(json.available).toBe(true);
    expect(json.sections.executiveSummary).toBe("Fresh AI summary.");
    // The kept edit is returned and flagged stale (its basis has moved on).
    expect(json.edited.executiveSummary).toBe("Analyst edit.");
    expect(json.stale).toBe(true);
    // The persisted row must retain the edit rather than nulling it.
    expect(capturedValues).not.toBeNull();
    expect(
      (capturedValues as unknown as { edited: { executiveSummary: string } })
        .edited.executiveSummary,
    ).toBe("Analyst edit.");
    expect(
      (capturedValues as unknown as { editedFingerprint: string })
        .editedFingerprint,
    ).toBe("stale-fingerprint");
  });
});
