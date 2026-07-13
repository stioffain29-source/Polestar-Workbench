import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseUkmtoDetail,
  parseUkmtoListing,
  resolveUkmtoUrl,
  UKMTO_SITE_ORIGIN,
} from "../../lib/ingest/src/ukmtoIngest";

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
