import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Topic-report prose must degrade gracefully when the LLM is absent or fails:
// return 200 { available: false, sections: null } so the client renders its
// deterministic draftTopicReportProse template — never HTTP 503.

jest.mock("../../artifacts/api-server/src/lib/reportProse", () => {
  const actual = jest.requireActual("../../artifacts/api-server/src/lib/reportProse");
  return {
    ...actual,
    isLlmAvailable: jest.fn(),
    generateReportProse: jest.fn(),
  };
});

import { db, reportsTable, reportProseTable } from "@workspace/db";
import {
  isLlmAvailable,
  generateReportProse,
  computeReportProseFingerprint,
  type ProseIncidentInput,
} from "../../artifacts/api-server/src/lib/reportProse";
import reportProseRouter from "../../artifacts/api-server/src/routes/reportProse";
import { adminAuthHeaders, enableTestAdminToken } from "./adminAuthTestHelpers";

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

const REPORT_ID = 42;
const INCIDENTS: ProseIncidentInput[] = [
  {
    id: "1",
    topic: "shipping",
    title: "Drone strike on bulk carrier near Hodeidah",
    summary: "A bulk carrier was struck by a one-way drone in the southern Red Sea.",
    location: "Red Sea",
    country: "Yemen",
    severity: "High",
    occurredAt: "2026-06-12T00:00:00+00:00",
    source: "UKMTO",
  },
];

const BODY = {
  topic: "shipping",
  title: "Shipping & Maritime Security",
  basisDays: 7,
  periodWord: "this week",
  issueDate: "2026-06-13",
  incidents: INCIDENTS,
};

const FINGERPRINT = computeReportProseFingerprint({
  reportId: REPORT_ID,
  topic: BODY.topic,
  title: BODY.title,
  issueDate: BODY.issueDate,
  basisDays: BODY.basisDays,
  incidents: INCIDENTS,
});

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  enableTestAdminToken();
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    };
    next();
  });
  app.use(reportProseRouter);
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
  (generateReportProse as jest.Mock).mockReset();
});

async function postProse(body: Record<string, unknown> = BODY) {
  const res = await fetch(`${baseUrl}/reports/${REPORT_ID}/prose`, {
    method: "POST",
    headers: adminAuthHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /reports/:id/prose — LLM unavailable", () => {
  it("returns 200 available:false (not 503) and persists nothing", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [reportProseTable, []],
      ]),
    );
    const insertSpy = stubInsert([]);
    (isLlmAvailable as jest.Mock).mockReturnValue(false);

    const { status, json } = await postProse();

    expect(status).toBe(200);
    expect(json.available).toBe(false);
    expect(json.model).toBe("unavailable");
    expect(json.fingerprint).toBe(FINGERPRINT);
    expect(json.sections).toBeNull();
    expect(generateReportProse as jest.Mock).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("returns 200 available:false when generation fails", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [reportProseTable, []],
      ]),
    );
    const insertSpy = stubInsert([]);
    (isLlmAvailable as jest.Mock).mockReturnValue(true);
    (generateReportProse as jest.Mock).mockResolvedValue({ ok: false, error: "timeout" });

    const { status, json } = await postProse();

    expect(status).toBe(200);
    expect(json.available).toBe(false);
    expect(json.model).toBe("unavailable");
    expect(generateReportProse as jest.Mock).toHaveBeenCalledTimes(1);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("POST /reports/:id/prose — cache hit", () => {
  it("serves cached prose even when the LLM is unavailable", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [
          reportProseTable,
          [
            {
              reportId: REPORT_ID,
              topic: "shipping",
              fingerprint: FINGERPRINT,
              sections: { executiveSummary: "Cached narrative." },
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
    expect(json.sections.executiveSummary).toBe("Cached narrative.");
    expect(json.stale).toBe(false);
    expect(generateReportProse as jest.Mock).not.toHaveBeenCalled();
  });

  it("flags a kept edit as stale when its recorded fingerprint has moved on", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [
          reportProseTable,
          [
            {
              reportId: REPORT_ID,
              topic: "shipping",
              fingerprint: FINGERPRINT,
              sections: { executiveSummary: "Cached narrative." },
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
    expect(json.edited.executiveSummary).toBe("Analyst edit.");
    expect(json.stale).toBe(true);
    expect(generateReportProse as jest.Mock).not.toHaveBeenCalled();
  });

  it("regenerates when the incident set (fingerprint) has changed", async () => {
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [
          reportProseTable,
          [
            {
              reportId: REPORT_ID,
              topic: "shipping",
              fingerprint: "stale-fingerprint",
              sections: { executiveSummary: "Old narrative." },
              edited: null,
              model: "gpt-5.4",
              generatedAt: "2026-06-10T00:00:00.000Z",
            },
          ],
        ],
      ]),
    );
    stubInsert([
      {
        reportId: REPORT_ID,
        topic: "shipping",
        fingerprint: FINGERPRINT,
        sections: { executiveSummary: "Fresh narrative." },
        edited: null,
        model: "gpt-5.4",
        generatedAt: "2026-06-13T00:00:00.000Z",
      },
    ]);
    (isLlmAvailable as jest.Mock).mockReturnValue(true);
    (generateReportProse as jest.Mock).mockResolvedValue({
      ok: true,
      model: "gpt-5.4",
      sections: {
        executiveSummary: "Fresh narrative.",
        situation: "s",
        whatHappened: "w",
        whatMatters: "m",
        implications: "i",
        watchNext: "n",
        polestarView: "p",
      },
    });

    const { status, json } = await postProse();

    expect(status).toBe(200);
    expect(json.available).toBe(true);
    expect(json.fingerprint).toBe(FINGERPRINT);
    expect(json.sections.executiveSummary).toBe("Fresh narrative.");
    expect(generateReportProse as jest.Mock).toHaveBeenCalledTimes(1);
  });
});
