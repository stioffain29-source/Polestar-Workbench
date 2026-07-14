import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@workspace/db";
import {
  parsePartnerPdf,
  extractPdfTextFallback,
} from "../../lib/ingest/src/partnerPdf";
import { parsePartnerProduct } from "../../lib/ingest/src/partnerParse";
import {
  JMIC_SOURCE_URL,
  CMF_SOURCE_URL,
  CMF_OVERVIEW_URL,
} from "../../lib/ingest/src/m15/partnerSources";
import {
  discoverPartnerProducts,
  mergeFixturePartnerProducts,
  runMaritimePartnerProductsIngest,
  selectPartnerListingForFetch,
} from "../../lib/ingest/src/maritimePartnerProducts";
import {
  isPartnerEscalationAdvisory,
  isPartnerThreatLevelUpdate,
  routeOfficialSource,
} from "../../lib/ingest/src/m15";

const FIXTURE_DIR = join(__dirname, "../fixtures/m15");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

describe("Partner PDF extraction (Step 2)", () => {
  const pdfBytes = readFileSync(
    join(FIXTURE_DIR, "jmic-advisory-012-26-southern-corridor.pdf"),
  );

  it("extracts non-empty text from the JMIC advisory PDF fixture", async () => {
    const fallback = extractPdfTextFallback(pdfBytes);
    expect(fallback.length).toBeGreaterThan(20);
    expect(fallback).toMatch(/JMIC Advisory Note/i);
    expect(fallback).toMatch(/Strait of Hormuz/i);

    const parsed = await parsePartnerPdf(pdfBytes, { maxPages: 1 });
    expect(parsed.text.length).toBeGreaterThan(20);
    expect(parsed.text).toMatch(/SUBSTANTIAL|Strait of Hormuz/i);
  });

  it("records partial flag when parser fails but fallback recovers text", async () => {
    const broken = Buffer.from(
      "%PDF-1.4\n1 0 obj\n(JMIC partial advisory text for mariners) Tj\n",
      "latin1",
    );
    const result = await parsePartnerPdf(broken);
    expect(result.text).toMatch(/JMIC partial advisory text/i);
    expect(result.partial).toBe(true);
  });
});

describe("Partner product field parser (Step 3)", () => {
  const jmicHtml = readFixture("jmic-advisory-012-26-southern-corridor.html");
  const jmicPdfBytes = readFileSync(
    join(FIXTURE_DIR, "jmic-advisory-012-26-southern-corridor.pdf"),
  );
  const cmfHtml = readFixture("cmf-threat-assessment-q2-2026.html");

  it("populates all required fields from JMIC HTML fixture", async () => {
    const pdf = await parsePartnerPdf(jmicPdfBytes);
    const product = parsePartnerProduct({
      provider: "jmic",
      html: jmicHtml,
      text: pdf.text,
      sourceUrl:
        "https://www.ukmto.org/partner-products/jmic-products/jmic-advisories/012-26-southern-corridor",
    });

    expect(product.productTitle).toMatch(/012-26|Southern Corridor/i);
    expect(product.provider).toBe("jmic");
    expect(product.date).toEqual(new Date("2026-07-06"));
    expect(product.region).toMatch(/Strait of Hormuz/i);
    expect(product.threatLevel).toBe("SUBSTANTIAL");
    expect(product.summary.length).toBeGreaterThan(40);
    expect(product.summary).toMatch(/JMIC is sharing information/i);
    expect(product.sourceUrl).toMatch(/ukmto\.org/);
  });

  it("populates all required fields from JMIC PDF text alone", async () => {
    const pdf = await parsePartnerPdf(jmicPdfBytes);
    const product = parsePartnerProduct({
      provider: "jmic",
      text: pdf.text,
      pdfUrl:
        "https://www.ukmto.org/-/media/ukmto/products/jmic-advisory-note-01226-southern-corridor-available.pdf",
    });

    expect(product.productTitle).toMatch(/JMIC Advisory/i);
    expect(product.provider).toBe("jmic");
    expect(product.region).toMatch(/hormuz|middle east/i);
    expect(product.threatLevel).toBe("SUBSTANTIAL");
    expect(product.summary.length).toBeGreaterThan(20);
    expect(product.sourceUrl).toMatch(/\.pdf/i);
  });

  it("populates all required fields from CMF HTML fixture", () => {
    const product = parsePartnerProduct({
      provider: "cmf",
      html: cmfHtml,
      text: "CMF regional threat assessment elevated across Arabian Gulf and Gulf of Oman.",
      sourceUrl: CMF_OVERVIEW_URL,
    });

    expect(product.productTitle).toMatch(/CMF Regional Threat Assessment/i);
    expect(product.provider).toBe("cmf");
    expect(product.date).toEqual(new Date("2026-06-15"));
    expect(product.region).toMatch(/Arabian Gulf|gulf/i);
    expect(product.threatLevel).toBe("ELEVATED");
    expect(product.summary.length).toBeGreaterThan(40);
    expect(product.summary).toMatch(/Combined Maritime Forces/i);
    expect(product.sourceUrl).toBe(CMF_OVERVIEW_URL);
  });

  it("exports stable partner listing URLs for deploy smoke checks", () => {
    expect(JMIC_SOURCE_URL).toBe(
      "https://www.ukmto.org/partner-products/jmic-products",
    );
    expect(CMF_SOURCE_URL).toBe(
      "https://www.ukmto.org/partner-products/cmf-products",
    );
  });
});

describe("Partner discovery (Step 5)", () => {
  it("discovers ≥1 JMIC product from the listing fixture", () => {
    const listingHtml = readFixture("jmic-products-listing.html");
    const discovered = mergeFixturePartnerProducts(
      "jmic",
      discoverPartnerProducts("jmic", listingHtml),
    );
    expect(discovered.length).toBeGreaterThanOrEqual(1);
    const advisory = discovered.find((item) =>
      /012-26|advisory|jmic/i.test(item.externalId + item.title),
    );
    expect(advisory).toBeDefined();
    expect(advisory?.sourceUrl).toMatch(/^https:\/\//);
    expect(advisory?.provider).toBe("jmic");
  });

  it("discovers ≥1 CMF product from the listing fixture", () => {
    const listingHtml = readFixture("cmf-products-listing.html");
    const discovered = mergeFixturePartnerProducts(
      "cmf",
      discoverPartnerProducts("cmf", listingHtml),
    );
    expect(discovered.length).toBeGreaterThanOrEqual(1);
    const threat = discovered.find((item) => item.provider === "cmf");
    expect(threat).toBeDefined();
    expect(threat?.sourceUrl).toMatch(/^https:\/\//);
  });

  it("selects newest partner products first and respects caps", () => {
    const items = mergeFixturePartnerProducts(
      "jmic",
      discoverPartnerProducts("jmic", readFixture("jmic-products-listing.html")),
    );
    const selected = selectPartnerListingForFetch(items, { maxItems: 1 });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.externalId).toBe("012-26-southern-corridor");
  });
});

describe("Maritime partner ingest scaffold (Steps 4–7)", () => {
  const jmicListing = readFixture("jmic-products-listing.html");
  const cmfListing = readFixture("cmf-products-listing.html");
  const jmicDetail = readFixture("jmic-advisory-012-26-southern-corridor.html");
  const cmfDetail = readFixture("cmf-threat-assessment-q2-2026.html");
  const jmicPdf = readFileSync(
    join(FIXTURE_DIR, "jmic-advisory-012-26-southern-corridor.pdf"),
  );

  type StoredRow = {
    sourceName: string;
    externalId: string;
    sourceUrl: string;
    title: string;
    bodyText: string;
    primaryWatch: string;
    watchTags: string[];
    hasPdf?: boolean;
  };

  const stored: StoredRow[] = [];

  function setupDbMock() {
    jest.spyOn(db, "select").mockImplementation((fields?: unknown) => {
      const shape = fields as Record<string, unknown> | undefined;
      const isCount = shape != null && "n" in shape;
      const isLatest = shape != null && "latest" in shape;
      const isNewsEcho =
        shape != null && ("resolvedUrl" in shape || "primaryStoryUrl" in shape);
      return {
        from: () => ({
          where: () => {
            if (isNewsEcho) return Promise.resolve([]);
            if (isCount) return Promise.resolve([{ n: stored.length }]);
            if (isLatest) return Promise.resolve([{ latest: null }]);
            return Promise.resolve(
              stored.map((r) => ({
                externalId: r.externalId,
                sourceUrl: r.sourceUrl,
              })),
            );
          },
        }),
      } as never;
    });

    jest.spyOn(db, "insert").mockImplementation(
      () =>
        ({
          values: (batch: StoredRow | StoredRow[]) => {
            const values = Array.isArray(batch) ? batch : [batch];
            const inserted: { id: number }[] = [];
            for (const row of values) {
              const dup = stored.some(
                (s) =>
                  s.sourceName === row.sourceName &&
                  (s.externalId === row.externalId || s.sourceUrl === row.sourceUrl),
              );
              if (!dup) {
                stored.push(row);
                inserted.push({ id: stored.length });
              }
            }
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve(inserted),
              }),
            };
          },
        }) as never,
    );
  }

  afterEach(() => {
    stored.length = 0;
    jest.restoreAllMocks();
  });

  const fetchDetail = async (item: { provider: string; externalId: string }) => {
    if (item.provider === "jmic" && item.externalId === "012-26-southern-corridor") {
      return { html: jmicDetail, pdfBytes: jmicPdf };
    }
    if (item.provider === "cmf" && item.externalId === "threat-assessment-q2-2026") {
      return { html: cmfDetail, pdfBytes: null };
    }
    return { html: null, pdfBytes: null };
  };

  it("dry-run returns summary with zero DB writes", async () => {
    setupDbMock();

    const summary = await runMaritimePartnerProductsIngest({
      commit: false,
      listingHtmlByProvider: { jmic: jmicListing, cmf: cmfListing },
      fetchDetailHtml: fetchDetail,
      externalIds: ["012-26-southern-corridor", "threat-assessment-q2-2026"],
      sincePublishedAt: null,
    });

    expect(summary.mode).toBe("dry-run");
    expect(summary.ran).toBe(true);
    expect(summary.itemsFetched).toBeGreaterThanOrEqual(2);
    expect(summary.inserted).toBe(0);
    expect(stored).toHaveLength(0);
    expect(summary.providers.jmic.itemsDiscovered).toBeGreaterThanOrEqual(1);
    expect(summary.providers.cmf.itemsDiscovered).toBeGreaterThanOrEqual(1);
  });

  it("inserts JMIC + CMF rows and dedupes on re-ingest (M1.5-T9)", async () => {
    setupDbMock();

    const first = await runMaritimePartnerProductsIngest({
      commit: true,
      listingHtmlByProvider: { jmic: jmicListing, cmf: cmfListing },
      fetchDetailHtml: fetchDetail,
      externalIds: ["012-26-southern-corridor", "threat-assessment-q2-2026"],
      sincePublishedAt: null,
    });

    expect(first.inserted).toBe(2);
    expect(stored).toHaveLength(2);

    const jmicRow = stored.find((r) => r.sourceName === "jmic");
    const cmfRow = stored.find((r) => r.sourceName === "cmf");
    expect(jmicRow?.title).toMatch(/012-26|Southern Corridor/i);
    expect(jmicRow?.bodyText).toMatch(/Threat level: SUBSTANTIAL/i);
    expect(cmfRow?.title).toMatch(/CMF Regional Threat Assessment/i);
    expect(cmfRow?.bodyText).toMatch(/Threat level: ELEVATED/i);

    const second = await runMaritimePartnerProductsIngest({
      commit: true,
      listingHtmlByProvider: { jmic: jmicListing, cmf: cmfListing },
      fetchDetailHtml: fetchDetail,
      externalIds: ["012-26-southern-corridor", "threat-assessment-q2-2026"],
      sincePublishedAt: null,
    });

    expect(second.inserted).toBe(0);
    expect(second.duplicateInDb).toBeGreaterThanOrEqual(2);
    expect(stored).toHaveLength(2);
  });

  it("routes threat-level partner products to Shipping and escalation advisories to both watches (M1.5-T10)", () => {
    const threatBody =
      "CMF regional threat assessment. Threat level: ELEVATED across Arabian Gulf.";
    expect(isPartnerThreatLevelUpdate(threatBody)).toBe(true);
    expect(isPartnerEscalationAdvisory(threatBody)).toBe(false);
    expect(routeOfficialSource({
      source: "partner",
      title: "CMF Threat Assessment Update",
      body: threatBody,
    })).toEqual({
      primaryWatch: "shipping",
      watchTags: ["shipping"],
    });

    const escalationBody =
      "JMIC Escalation Advisory — Arabian Gulf. JMIC reports elevated threat to commercial shipping amid regional military activity and kinetic incidents near the Strait of Hormuz.";
    expect(isPartnerEscalationAdvisory(escalationBody)).toBe(true);
    expect(routeOfficialSource({
      source: "partner",
      title: "JMIC Escalation Advisory — Arabian Gulf",
      body: escalationBody,
    })).toEqual({
      primaryWatch: "shipping",
      watchTags: ["shipping", "conflict"],
    });
  });
});
