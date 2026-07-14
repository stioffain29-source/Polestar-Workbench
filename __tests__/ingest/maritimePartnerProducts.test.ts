import { readFileSync } from "node:fs";
import { join } from "node:path";
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
