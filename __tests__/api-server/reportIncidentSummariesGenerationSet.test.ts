import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Task #147 proved the CLIENT resolves the right per-incident summary for each
// rendered Related Incidents row. This suite proves the SERVER side: the
// /reports/:id/incident-summaries route must GENERATE (and fingerprint) the
// summaries map keyed by EXACTLY the incident set the report renders — the
// shared selector `selectRelatedIncidents` (the one cap/selection authority),
// honouring its per-topic cap.
//
// If the generation set ever drifts from the rendered/capped set, the cache
// either goes stale (a key the row resolves against was never generated) or is
// silently bypassed (every load regenerates → wallet-DoS). Neither the pure
// selector tests nor the client-wiring tests can catch a server-side mismatch,
// so we assert it end-to-end here: feed a raw window through
// `selectRelatedIncidents`, build the route body the way the client does, POST,
// and assert the server (a) hands generation EXACTLY those ids in order and
// (b) returns the fingerprint of that same set.
//
// Only the DB and the two LLM helpers are stubbed; the fingerprint helper and
// the shared selector are the REAL ones — the whole point is the contract
// between them.

jest.mock("../../artifacts/api-server/src/lib/countryProse", () => {
  const actual = jest.requireActual(
    "../../artifacts/api-server/src/lib/countryProse",
  );
  return {
    ...actual,
    isLlmAvailable: jest.fn(),
    generateIncidentSummaries: jest.fn(),
  };
});

import { db, reportsTable, reportIncidentSummariesTable } from "@workspace/db";
import {
  isLlmAvailable,
  generateIncidentSummaries,
  computeIncidentSummariesFingerprint,
  type ProseIncidentInput,
} from "../../artifacts/api-server/src/lib/countryProse";
import reportIncidentSummariesRouter from "../../artifacts/api-server/src/routes/reportIncidentSummaries";
import {
  selectRelatedIncidents,
  type RelatedIncidentInput,
} from "@/lib/relatedIncidents";

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

const REPORT_ID = 77;

// The five topics that get per-incident AI summaries (flashpoint/protests/fuel
// are intentionally out of scope — they fall back to the deterministic line).
const SUMMARY_TOPICS = [
  "cargo_watch",
  "energy",
  "fertiliser",
  "conflict",
  "shipping",
] as const;

// Strong, distinctly-named titles per topic so the classifier keeps them as
// operationally classified rows (not the weak "Other … incident" bucket, and —
// for cargo — not the generic warehouse/container suffix titles that
// selectRelatedIncidents hard-excludes). We deliberately build MORE rows than
// the selector's cap so the truncation is exercised, not just the ordering.
function rawWindow(topic: string): (RelatedIncidentInput & { id: string })[] {
  const stems: Record<string, string[]> = {
    cargo_watch: [
      "Container lorry hijacked on the Karachi port road",
      "Armed gang ambushed a fuel tanker convoy near Lahore",
      "Bonded warehouse raided in Dhaka overnight",
      "Pharmaceutical shipment stolen from a Chennai depot",
      "Electronics consignment seized from a Mumbai siding",
      "Refrigerated trailer looted on the Hanoi expressway",
      "Copper cargo diverted from a Manila terminal",
      "Textile container emptied at a Jakarta yard",
      "Grain barge boarded on the Mekong",
      "Spare-parts truck robbed outside Bangkok",
      "Tea consignment vanished from a Colombo warehouse",
      "Cement load hijacked near Surabaya",
    ],
    energy: [
      "Substation sabotaged outside Manila",
      "Gas pipeline ruptured near Karachi",
      "Power grid attack reported in Mindanao",
      "Refinery fire disrupted output in Gujarat",
      "Transmission tower felled in Balochistan",
      "Coal terminal blockaded in Queensland",
      "LNG jetty strike halted loading in Bintulu",
      "Hydropower dam threatened in Myanmar",
      "Oil depot shelled near Sittwe",
      "Solar farm vandalised in Rajasthan",
      "Geothermal plant occupied in Sumatra",
      "Diesel generator convoy attacked in Papua",
    ],
    fertiliser: [
      "Urea shipment blocked at Chittagong",
      "Phosphate plant struck in Kunming",
      "Ammonia plant shut after a leak in Gujarat",
      "Potash convoy hijacked near Vientiane",
      "Nitrogen plant protest halted output in Sichuan",
      "Compost depot fire reported in Punjab",
      "Fertiliser warehouse looted in Yangon",
      "Sulphur cargo seized at Tuticorin",
      "DAP shipment delayed at Haiphong",
      "Manure processing site flooded in Java",
      "Lime plant blockaded in Mindoro",
      "Gypsum mine disrupted in Rajasthan",
    ],
    conflict: [
      "Insurgents ambushed a patrol in Mindanao",
      "Clashes erupted along the Manipur border",
      "Separatists attacked a checkpoint in West Papua",
      "Militants raided a village in Rakhine",
      "Cross-border shelling reported in Kashmir",
      "Gun battle killed soldiers in southern Thailand",
      "Rebels overran an outpost in Kachin",
      "Bombing struck a market in Maguindanao",
      "Firefight displaced families in Shan State",
      "Ambush on a convoy in Chhattisgarh",
      "Roadside blast hit troops in Balochistan",
      "Raid on a base in Naga territory",
    ],
    shipping: [
      "Tanker boarded by pirates in the Singapore Strait",
      "Bulk carrier hijacked off the Sulu Sea",
      "Container ship detained in the Malacca Strait",
      "Vessel attacked near the Gulf of Thailand",
      "Cargo ship seized off Mindanao",
      "Tug boarded near the Riau Islands",
      "Chemical tanker robbed in the South China Sea",
      "Fishing fleet harassed near the Spratlys",
      "Freighter grounded after an attack off Borneo",
      "Crew kidnapped from a barge near Sabah",
      "Coastal trader looted off Sumatra",
      "Ferry threatened in the Java Sea",
    ],
  };
  const titles = stems[topic] ?? stems.energy;
  return titles.map((title, idx) => ({
    id: `${topic}-${idx}`,
    topic,
    title,
    // Descending day so selectRelatedIncidents' recency sort is meaningful and
    // the truncation keeps the newest rows.
    occurredAt: `2026-06-${String(20 - idx).padStart(2, "0")}T00:00:00+00:00`,
    severity: idx % 2 === 0 ? "High" : "Moderate",
    summary: `${title}; details corroborated by local reporting.`,
    location: title.split(" ").slice(-1)[0],
    country: "Regional",
    source: "Reuters",
  }));
}

// Mirror EXACTLY the client mapping (ReportEditor relatedForSummaries): the
// selected rows are projected to the ProseIncidentInput shape the route accepts.
// If this projection drifts from the client, the fingerprint the server returns
// would no longer match what the client computed — so it is part of the contract.
function toBody(rows: (RelatedIncidentInput & { id: string })[]): ProseIncidentInput[] {
  return rows.map((i) => ({
    id: i.id != null ? String(i.id) : undefined,
    topic: typeof i.topic === "string" ? i.topic : "",
    title: typeof i.title === "string" ? i.title : "",
    summary: typeof i.summary === "string" ? i.summary : "",
    location: typeof i.location === "string" ? i.location : "",
    country: typeof i.country === "string" ? i.country : "",
    severity: typeof i.severity === "string" ? i.severity : "",
    occurredAt: typeof i.occurredAt === "string" ? i.occurredAt : "",
    source: typeof i.source === "string" ? i.source : "",
  }));
}

// The rendered/capped set the client would send for a topic, plus its ids.
function renderedSet(topic: string): {
  incidents: ProseIncidentInput[];
  ids: string[];
} {
  const selected = selectRelatedIncidents(rawWindow(topic), topic);
  const incidents = toBody(selected);
  return { incidents, ids: incidents.map((i) => String(i.id)) };
}

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll((done) => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: { warn: () => void } }).log = { warn: () => {} };
    next();
  });
  app.use("/api", reportIncidentSummariesRouter);
  server = app.listen(0, () => {
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    done();
  });
});

afterAll((done) => {
  server.close(() => done());
});

afterEach(() => {
  jest.restoreAllMocks();
  (isLlmAvailable as jest.Mock).mockReset();
  (generateIncidentSummaries as jest.Mock).mockReset();
});

async function postSummaries(body: unknown) {
  const res = await fetch(`${baseUrl}/api/reports/${REPORT_ID}/incident-summaries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe.each(SUMMARY_TOPICS)(
  "POST /reports/:id/incident-summaries — generation set matches selectRelatedIncidents (%s)",
  (topic) => {
    it("generates (and fingerprints) the EXACT rendered/capped incident set, not the raw window", async () => {
      const window = rawWindow(topic);
      const { incidents: expected, ids: expectedIds } = renderedSet(topic);

      // Sanity: the window is bigger than what the selector renders, so the cap
      // is actually exercised (and certainly within the route's hard ceiling).
      expect(window.length).toBeGreaterThan(expected.length);
      expect(expected.length).toBeLessThanOrEqual(60);

      stubSelect(
        new Map<unknown, Rows>([
          [reportsTable, [{ id: REPORT_ID }]],
          [reportIncidentSummariesTable, []],
        ]),
      );
      const expectedFp = computeIncidentSummariesFingerprint({
        scope: `report:${REPORT_ID}`,
        incidents: expected,
      });
      stubInsert([
        {
          reportId: REPORT_ID,
          fingerprint: expectedFp,
          summaries: Object.fromEntries(expectedIds.map((id) => [id, "x"])),
          edited: null,
          model: "gpt-5.4",
          generatedAt: new Date("2026-06-21T00:00:00Z"),
        },
      ]);
      (isLlmAvailable as jest.Mock).mockReturnValue(true);
      // The mock keys its output by the ids it is HANDED — so the response
      // summaries keys are exactly the set the server chose to generate.
      (generateIncidentSummaries as jest.Mock).mockImplementation(
        (incidents: ProseIncidentInput[]) => ({
          ok: true,
          model: "gpt-5.4",
          summaries: Object.fromEntries(
            incidents.map((i) => [String(i.id), `summary for ${i.id}`]),
          ),
        }),
      );

      // The client sends the rendered set; the server must generate that set.
      const { status, json } = await postSummaries({ incidents: expected });

      expect(status).toBe(200);
      expect(json.available).toBe(true);

      // (1) The server handed generation EXACTLY the selected ids, in order.
      expect(generateIncidentSummaries as jest.Mock).toHaveBeenCalledTimes(1);
      const handed = (generateIncidentSummaries as jest.Mock).mock
        .calls[0][0] as ProseIncidentInput[];
      expect(handed.map((i) => String(i.id))).toEqual(expectedIds);

      // (2) The summaries map is keyed by the SAME ids — no extra keys (rows
      // that were never rendered) and no missing keys (rows with no summary).
      expect(Object.keys(json.summaries).sort()).toEqual(
        [...expectedIds].sort(),
      );

      // (3) The persisted fingerprint is the fingerprint of that exact set.
      expect(json.fingerprint).toBe(expectedFp);
    });
  },
);

describe("fingerprint tracks the rendered incident set", () => {
  it("is STABLE when the rendered set is unchanged → a cache hit, no regeneration", async () => {
    const { incidents: expected } = renderedSet("conflict");
    const fp = computeIncidentSummariesFingerprint({
      scope: `report:${REPORT_ID}`,
      incidents: expected,
    });
    const cached = Object.fromEntries(
      expected.map((i) => [String(i.id), `cached ${i.id}`]),
    );
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [
          reportIncidentSummariesTable,
          [
            {
              reportId: REPORT_ID,
              fingerprint: fp,
              summaries: cached,
              edited: null,
              model: "gpt-5.4",
              generatedAt: new Date("2026-06-19T00:00:00Z"),
            },
          ],
        ],
      ]),
    );
    const insertSpy = stubInsert([]);
    (isLlmAvailable as jest.Mock).mockReturnValue(true);

    const { status, json } = await postSummaries({ incidents: expected });

    expect(status).toBe(200);
    expect(json.fingerprint).toBe(fp);
    expect(json.summaries).toEqual(cached);
    // Stable set → no needless model call, no rewrite.
    expect(generateIncidentSummaries as jest.Mock).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("CHANGES when the rendered set changes → the prior cache row is a miss and regenerates", async () => {
    const { incidents: original } = renderedSet("conflict");
    const originalFp = computeIncidentSummariesFingerprint({
      scope: `report:${REPORT_ID}`,
      incidents: original,
    });

    // Same rows, but one incident's severity was corrected — a field the prompt
    // renders, so the fingerprint MUST flip even though the id set is identical.
    const changed = original.map((i, idx) =>
      idx === 0 ? { ...i, severity: "Extreme" } : i,
    );
    const changedFp = computeIncidentSummariesFingerprint({
      scope: `report:${REPORT_ID}`,
      incidents: changed,
    });
    expect(changedFp).not.toBe(originalFp);

    // The stored cache row is keyed to the ORIGINAL fingerprint.
    stubSelect(
      new Map<unknown, Rows>([
        [reportsTable, [{ id: REPORT_ID }]],
        [
          reportIncidentSummariesTable,
          [
            {
              reportId: REPORT_ID,
              fingerprint: originalFp,
              summaries: { stale: "old" },
              edited: null,
              model: "gpt-5.4",
              generatedAt: new Date("2026-06-10T00:00:00Z"),
            },
          ],
        ],
      ]),
    );
    const insertSpy = stubInsert([
      {
        reportId: REPORT_ID,
        fingerprint: changedFp,
        summaries: { regenerated: "new" },
        edited: null,
        model: "gpt-5.4",
        generatedAt: new Date("2026-06-21T00:00:00Z"),
      },
    ]);
    (isLlmAvailable as jest.Mock).mockReturnValue(true);
    (generateIncidentSummaries as jest.Mock).mockResolvedValue({
      ok: true,
      model: "gpt-5.4",
      summaries: { regenerated: "new" },
    });

    const { status, json } = await postSummaries({ incidents: changed });

    expect(status).toBe(200);
    // The changed set is NOT served from the stale cache row.
    expect(json.fingerprint).toBe(changedFp);
    expect(generateIncidentSummaries as jest.Mock).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});
