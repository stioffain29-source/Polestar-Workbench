import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@workspace/db";
import {
  parseUkmtoDetail,
  parseUkmtoListing,
  resolveUkmtoUrl,
  runUkmtoIngest,
  selectUkmtoListingForFetch,
  extractUkmtoPdfText,
  extractPdfTextFallback,
  mergeUkmtoBodyWithPdf,
  UKMTO_SOURCE,
  UKMTO_SITE_ORIGIN,
} from "../../lib/ingest/src/ukmtoIngest";
import { routeOfficialSource } from "../../lib/ingest/src/m15";

const FIXTURE_DIR = join(__dirname, "../fixtures/m15");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

describe("UKMTO listing parser (Step 5)", () => {
  const listingHtml = readFixture("ukmto-products-listing.html");

  it("parses warnings and advisories with stable ids and absolute URLs", () => {
    const items = parseUkmtoListing(listingHtml);
    expect(items.length).toBeGreaterThanOrEqual(4);

    const attack = items.find((i) => i.externalId === "038-26-attack");
    expect(attack).toMatchObject({
      externalId: "038-26-attack",
      productType: "warning",
      productNumber: "038-26",
      title: "038-26 - ATTACK",
      sourceUrl: "https://www.ukmto.org/ukmto-products/warnings/038-26-attack",
    });
    expect(attack?.publishedAt).toEqual(new Date("2026-04-18T11:25:00Z"));

    const advisory = items.find((i) => i.externalId === "003-26-update-002");
    expect(advisory).toMatchObject({
      externalId: "003-26-update-002",
      productType: "advisory",
      productNumber: "003-26",
      title: "003-26 Update 002 - ADVISORY",
      sourceUrl:
        "https://www.ukmto.org/ukmto-products/advisories/003-26-update-002",
      pdfUrl:
        "https://www.ukmto.org/-/media/ukmto/products/20260301-ukmto_advisory_003-26-update_002.pdf?rev=1d162c1339274c538a9b209c92dc4f0a",
    });
    expect(advisory?.publishedAt).toEqual(new Date("2026-03-01T07:00:00Z"));

    const firstUpdate = items.find((i) => i.externalId === "003-26-update-001");
    expect(firstUpdate?.externalId).toBe("003-26-update-001");
    expect(firstUpdate?.productNumber).toBe("003-26");
  });

  it("resolves relative hrefs against ukmto.org", () => {
    expect(resolveUkmtoUrl("/ukmto-products/warnings")).toBe(
      "https://www.ukmto.org/ukmto-products/warnings",
    );
    expect(UKMTO_SITE_ORIGIN).toBe("https://www.ukmto.org");
  });
});

describe("UKMTO detail parser (Step 6)", () => {
  const advisoryHtml = readFixture("ukmto-advisory-003-26-update-002.html");
  const baseUrl =
    "https://www.ukmto.org/ukmto-products/advisories/003-26-update-002";

  it("populates all required UKMTO fields from the advisory fixture", () => {
    const detail = parseUkmtoDetail(advisoryHtml, baseUrl);

    expect(detail.externalId).toBe("003-26-update-002");
    expect(detail.productType).toBe("advisory");
    expect(detail.productNumber).toBe("003-26");
    expect(detail.title).toBe("003-26 Update 002 - ADVISORY");
    expect(detail.publishedAt).toEqual(new Date("2026-03-01"));
    expect(detail.reportDate).toBe("2026-02-28");
    expect(detail.reportTime).toBe("0700UTC");
    expect(detail.locationText).toMatch(/Arabian Gulf/);
    expect(detail.coordinates).toBeNull();
    expect(detail.vesselType).toBe("All commercial shipping");
    expect(detail.incidentType).toMatch(/ADVISORY/);
    expect(detail.reportedImpact).toMatch(/AIS\/GNSS/);
    expect(detail.sourceUrl).toBe(baseUrl);
    expect(detail.pdfUrl).toContain("ukmto_advisory_003-26-update_002.pdf");
    expect(detail.confidence).toBe("high");
    expect(detail.bodyText).toMatch(/\[Confidence: High \(official\)\]/);
    expect(detail.bodyText).toMatch(/Strait of Hormuz/);
  });
});

describe("UKMTO warning detail parser (Step 6)", () => {
  const warningHtml = readFixture("ukmto-warning-038-26-attack.html");
  const baseUrl = "https://www.ukmto.org/ukmto-products/warnings/038-26-attack";

  it("extracts attack warning fields including coordinates", () => {
    const detail = parseUkmtoDetail(warningHtml, baseUrl);

    expect(detail.productType).toBe("warning");
    expect(detail.productNumber).toBe("038-26");
    expect(detail.locationText).toBe("25NM northeast of Oman");
    expect(detail.coordinates).toMatch(/25°42/);
    expect(detail.vesselType).toBe("Container Ship");
    expect(detail.incidentType).toMatch(/ATTACK/);
    expect(detail.reportedImpact).toMatch(/Damage to containers/);
    expect(detail.bodyText).toMatch(/unknown projectile/i);
  });
});

describe("UKMTO PDF extraction (Step 7)", () => {
  const pdfBytes = readFileSync(join(FIXTURE_DIR, "ukmto-003-26-update-002.pdf"));
  const advisoryHtml = readFixture("ukmto-advisory-003-26-update-002.html");
  const baseUrl =
    "https://www.ukmto.org/ukmto-products/advisories/003-26-update-002";

  it("extracts non-empty text from the PDF fixture", async () => {
    const fallback = extractPdfTextFallback(pdfBytes);
    expect(fallback.length).toBeGreaterThan(20);
    expect(fallback).toMatch(/UKMTO OFFICIAL ADVISORY/i);
    expect(fallback).toMatch(/VHF Channel 16/i);

    const parsed = await extractUkmtoPdfText(pdfBytes, { maxPages: 1 });
    expect(parsed.text.length).toBeGreaterThan(20);
    expect(parsed.text).toMatch(/Strait of Hormuz|VHF Channel 16/i);
  });

  it("merges PDF text into advisory bodyText for richer content", async () => {
    const detail = parseUkmtoDetail(advisoryHtml, baseUrl);
    const htmlOnlyLen = detail.bodyText.length;
    const pdf = await extractUkmtoPdfText(pdfBytes);
    const merged = mergeUkmtoBodyWithPdf(detail.bodyText, pdf);
    expect(merged.pdfMerged).toBe(true);
    expect(merged.bodyText.length).toBeGreaterThan(htmlOnlyLen);
    expect(merged.bodyText).toMatch(/\[PDF/);
    expect(merged.bodyText).toMatch(/Iranian military activity/i);
  });

  it("records partial flag when parser fails but fallback recovers text", async () => {
    const broken = Buffer.from("%PDF-1.4\n1 0 obj\n(UKMTO partial advisory text) Tj\n", "latin1");
    const result = await extractUkmtoPdfText(broken);
    expect(result.text).toMatch(/UKMTO partial advisory text/i);
    expect(result.partial).toBe(true);
  });
});

describe("UKMTO live fetch selection (Step 9)", () => {
  const listingHtml = readFixture("ukmto-products-listing.html");
  const listing = parseUkmtoListing(listingHtml);

  it("selects newest products first and caps detail fetches", () => {
    const selected = selectUkmtoListingForFetch(listing, { maxItems: 2 });
    expect(selected).toHaveLength(2);
    expect(selected[0]?.externalId).toBe("038-26-attack");
  });
});

describe("UKMTO persist + routing (Step 8)", () => {
  const listingHtml = readFixture("ukmto-products-listing.html");
  const advisoryHtml = readFixture("ukmto-advisory-003-26-update-002.html");
  const pdfBytes = readFileSync(
    join(FIXTURE_DIR, "ukmto-003-26-update-002.pdf"),
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
      return {
        from: () => ({
          where: () => {
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

  const fetchDetail = async (item: { externalId: string }) => {
    if (item.externalId === "003-26-update-002") return advisoryHtml;
    return null;
  };

  const fetchPdf = async () => pdfBytes;

  it("inserts advisory with PDF-enriched body and dedupes on re-run", async () => {
    setupDbMock();

    const first = await runUkmtoIngest({
      commit: true,
      listingHtml,
      fetchDetailHtml: fetchDetail,
      fetchPdfBytes: fetchPdf,
      externalIds: ["003-26-update-002"],
      sincePublishedAt: null,
    });

    expect(first.inserted).toBe(1);
    expect(first.pdfExtracted).toBe(1);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.bodyText).toMatch(/\[PDF/);
    expect(stored[0]?.primaryWatch).toBe("shipping");
    expect(stored[0]?.watchTags).toEqual(["shipping", "conflict"]);

    const second = await runUkmtoIngest({
      commit: true,
      listingHtml,
      fetchDetailHtml: fetchDetail,
      fetchPdfBytes: fetchPdf,
      externalIds: ["003-26-update-002"],
      sincePublishedAt: null,
    });

    expect(second.inserted).toBe(0);
    expect(second.duplicateInDb).toBe(1);
    expect(stored).toHaveLength(1);
  });

  it("routes routine warning to shipping only", async () => {
    const warningHtml = readFixture("ukmto-warning-038-26-attack.html");
    const routed = routeOfficialSource({
      source: "ukmto",
      title: "038-26 - ATTACK",
      body: parseUkmtoDetail(
        warningHtml,
        "https://www.ukmto.org/ukmto-products/warnings/038-26-attack",
      ).bodyText,
    });
    expect(routed.primaryWatch).toBe("shipping");
    expect(routed.watchTags).toEqual(["shipping"]);
  });

  it("dry-run does not write rows", async () => {
    setupDbMock();
    const summary = await runUkmtoIngest({
      commit: false,
      listingHtml,
      fetchDetailHtml: fetchDetail,
      fetchPdfBytes: fetchPdf,
      externalIds: ["003-26-update-002"],
      sincePublishedAt: null,
    });
    expect(summary.inserted).toBe(0);
    expect(stored).toHaveLength(0);
  });
});
