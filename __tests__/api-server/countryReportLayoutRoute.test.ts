import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Country reports persist analyst layout controls (map placement, photo
// placement, and attached photos with caption/source/credit/context) in three
// country_reports columns. These tests guard the save/reload path of
// PATCH /countries/:slug so a future refactor of the route or the
// UpdateCountryReportBody zod schema cannot silently drop them. The route also
// strips the narrative columns (overview/trend_summary/implications) generically
// — that strip is asserted here too.

import { db, countryReportsTable } from "@workspace/db";
import countriesRouter from "../../artifacts/api-server/src/routes/countries";
import {
  adminAuthHeaders,
  installAdminTokenBeforeEach,
} from "./adminAuthTestHelpers";

type Row = Record<string, unknown>;

const SLUG = "indonesia";

function seedRow(): Row {
  return {
    id: 1,
    slug: SLUG,
    name: "Indonesia",
    region: "Southeast Asia",
    overview: null,
    trendSummary: null,
    implications: null,
    keyNumbers: null,
    mapPlacement: null,
    photoPlacement: null,
    reportPhotos: [],
    sectionOverrides: null,
    createdAt: "2026-06-01T00:00:00.000Z",
  };
}

// A single in-memory country_reports record, mutated by the stubbed db so a
// PATCH followed by a GET genuinely round-trips through the route layer.
let store: Row;
// The exact object handed to `db.update(...).set(...)` on the last PATCH, so the
// narrative-strip can be asserted directly (it must never reach the DB).
let lastSetValues: Row | null;

function stubDb(): void {
  lastSetValues = null;
  jest.spyOn(db, "update").mockImplementation((table: unknown) => {
    let setValues: Row = {};
    const chain: Record<string, unknown> = {
      set: (v: Row) => {
        setValues = v;
        lastSetValues = v;
        return chain;
      },
      where: () => chain,
      returning: () => {
        if (table === countryReportsTable) {
          Object.assign(store, setValues);
          return Promise.resolve([{ ...store }]);
        }
        return Promise.resolve([]);
      },
    };
    return chain as never;
  });
  jest.spyOn(db, "select").mockImplementation(() => {
    let tbl: unknown = null;
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        tbl = t;
        return chain;
      },
      where: () =>
        Promise.resolve(tbl === countryReportsTable ? [{ ...store }] : []),
    };
    return chain as never;
  });
}

let app: Express;
let server: Server;
let baseUrl: string;

installAdminTokenBeforeEach();

beforeAll(() => {
  app = express();
  app.use(express.json());
  // The real api-server attaches `req.log` via pino-http; this bare test app
  // does not, so stub a no-op logger before the router.
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    };
    next();
  });
  app.use(countriesRouter);
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
  // The admin token is re-installed per test by installAdminTokenBeforeEach()
  // above (the global jest.setup clears INGEST_ADMIN_TOKEN before each test) so
  // the gate is configured and the route returns 200/401, never a bogus 503.
  jest.restoreAllMocks();
  store = seedRow();
  stubDb();
});

async function patch(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/countries/${SLUG}`, {
    method: "PATCH",
    headers: adminAuthHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Row };
}

async function get() {
  const res = await fetch(`${baseUrl}/countries/${SLUG}`);
  return { status: res.status, json: (await res.json()) as Row };
}

describe("PATCH /countries/:slug — analyst layout persistence", () => {
  it("round-trips mapPlacement, photoPlacement and a reportPhotos entry", async () => {
    const photo = {
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      caption: "Port of Jayapura at dawn",
      source: "Antara Foto",
      credit: "J. Doe / Antara",
      context: "Taken during the security cordon on 12 June.",
    };

    const patched = await patch({
      mapPlacement: "after-overview",
      photoPlacement: "before-implications",
      reportPhotos: [photo],
    });

    expect(patched.status).toBe(200);
    expect(patched.json.mapPlacement).toBe("after-overview");
    expect(patched.json.photoPlacement).toBe("before-implications");
    expect(patched.json.reportPhotos).toEqual([photo]);

    // Reload via the GET handler: the layout choices must survive the read-back,
    // including every nested photo metadata field.
    const reloaded = await get();
    expect(reloaded.status).toBe(200);
    expect(reloaded.json.mapPlacement).toBe("after-overview");
    expect(reloaded.json.photoPlacement).toBe("before-implications");
    expect(reloaded.json.reportPhotos).toEqual([photo]);
    const [reloadedPhoto] = reloaded.json.reportPhotos as Array<
      Record<string, unknown>
    >;
    expect(reloadedPhoto.caption).toBe(photo.caption);
    expect(reloadedPhoto.source).toBe(photo.source);
    expect(reloadedPhoto.credit).toBe(photo.credit);
    expect(reloadedPhoto.context).toBe(photo.context);
  });

  it("round-trips sectionOverrides (hidden sections, excluded incidents, demotions)", async () => {
    const overrides = {
      hiddenSections: ["polestar-view", "outlook"],
      excludedIncidentIds: ["12", "45"],
      severityDemotions: { "7": "low", "9": "moderate" },
    };

    const patched = await patch({ sectionOverrides: overrides });
    expect(patched.status).toBe(200);
    expect(patched.json.sectionOverrides).toEqual(overrides);

    const reloaded = await get();
    expect(reloaded.status).toBe(200);
    expect(reloaded.json.sectionOverrides).toEqual(overrides);
  });

  it("does not write the narrative columns while still saving layout fields", async () => {
    const patched = await patch({
      overview: "INJECTED OVERVIEW",
      trendSummary: "INJECTED TREND",
      implications: "INJECTED IMPLICATIONS",
      mapPlacement: "after-trend",
    });

    expect(patched.status).toBe(200);

    // The legitimate layout field is written...
    expect(lastSetValues).not.toBeNull();
    expect(lastSetValues).toHaveProperty("mapPlacement", "after-trend");
    // ...but the narrative columns are stripped before reaching the DB.
    expect(lastSetValues).not.toHaveProperty("overview");
    expect(lastSetValues).not.toHaveProperty("trendSummary");
    expect(lastSetValues).not.toHaveProperty("implications");

    // And a read-back confirms the narrative stayed at its seed (null), never
    // the injected values.
    const reloaded = await get();
    expect(reloaded.json.overview).toBeNull();
    expect(reloaded.json.trendSummary).toBeNull();
    expect(reloaded.json.implications).toBeNull();
    expect(reloaded.json.mapPlacement).toBe("after-trend");
  });

  it("rejects a PATCH without the admin token", async () => {
    const res = await fetch(`${baseUrl}/countries/${SLUG}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapPlacement: "after-overview" }),
    });
    expect(res.status).toBe(401);
    expect(lastSetValues).toBeNull();
  });
});
