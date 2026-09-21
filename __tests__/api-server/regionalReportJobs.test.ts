import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const requestId = "3f9cc756-bfd1-4c37-8b8c-cdfae95b5737";
const row = {
  id: requestId,
  topic: "apac_weekly",
  issueDate: "2026-08-03",
  status: "queued",
  stage: "queued",
  reportId: null,
  error: null,
  runToken: null,
  attempt: 0,
  startedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

const mockCreateOrResume = jest.fn();
const mockGetJob = jest.fn();
jest.mock("../../artifacts/api-server/src/lib/regionalReportJobService", () => ({
  createOrResumeRegionalReportJob: (...args: unknown[]) => mockCreateOrResume(...args),
  getRegionalReportJob: (...args: unknown[]) => mockGetJob(...args),
  toRegionalReportJob: (job: typeof row) => ({
    id: job.id,
    topic: job.topic,
    issueDate: job.issueDate,
    status: job.status,
    stage: job.stage,
    reportId: job.reportId,
    error: job.error,
  }),
}));

import reportsRouter from "../../artifacts/api-server/src/routes/reports";

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll((done) => {
  app = express();
  app.use(express.json());
  app.use(reportsRouter);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    done();
  });
});

afterAll(() => new Promise<void>((resolve, reject) => {
  server.close((err) => err ? reject(err) : resolve());
}));

beforeEach(() => {
  mockCreateOrResume.mockReset();
  mockGetJob.mockReset();
});

async function post(body: unknown) {
  return fetch(`${baseUrl}/reports/regional-create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("regional report background job routes", () => {
  it("returns 202 with the durable queued job instead of awaiting collection", async () => {
    mockCreateOrResume.mockResolvedValue({ job: row, conflict: false });
    const response = await post({
      requestId,
      topic: "apac_weekly",
      issueDate: "2026-08-03",
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      id: requestId,
      topic: "apac_weekly",
      issueDate: "2026-08-03",
      status: "queued",
      stage: "queued",
      reportId: null,
      error: null,
    });
  });

  it("returns the same job for duplicate submissions and reports input conflicts", async () => {
    mockCreateOrResume
      .mockResolvedValueOnce({ job: row, conflict: false })
      .mockResolvedValueOnce({ job: row, conflict: false })
      .mockResolvedValueOnce({ job: row, conflict: true });
    const body = { requestId, topic: "apac_weekly", issueDate: "2026-08-03" };
    const first = await post(body);
    const second = await post(body);
    const conflict = await post({ ...body, topic: "middle_east_weekly" });
    expect(await first.json()).toEqual(await second.json());
    expect(conflict.status).toBe(409);
  });

  it("rejects malformed UUIDs and impossible calendar dates", async () => {
    expect((await post({
      requestId: "not-a-uuid",
      topic: "apac_weekly",
      issueDate: "2026-08-03",
    })).status).toBe(400);
    expect((await post({
      requestId,
      topic: "apac_weekly",
      issueDate: "2026-02-31",
    })).status).toBe(400);
    expect(mockCreateOrResume).not.toHaveBeenCalled();
  });

  it("returns job status, 404 for an unknown job, and 400 for a bad id", async () => {
    mockGetJob.mockResolvedValueOnce(row).mockResolvedValueOnce(undefined);
    const found = await fetch(`${baseUrl}/reports/regional-create/${requestId}`);
    const missing = await fetch(
      `${baseUrl}/reports/regional-create/30537ddd-55cb-4d87-8da8-f8fca4436d1b`,
    );
    const malformed = await fetch(`${baseUrl}/reports/regional-create/nope`);
    expect(found.status).toBe(200);
    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});