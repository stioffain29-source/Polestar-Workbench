import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CENTCOM_SOURCE_URL,
  CENTCOM_RSS_URL,
  UKMTO_SOURCE_URL,
  JMIC_SOURCE_URL,
  CMF_SOURCE_URL,
} from "../../lib/ingest/src/m15/health";
import {
  M15_FIXTURE_DIR,
  M15_OPTIONAL_FIXTURES,
  M15_REQUIRED_FIXTURES,
} from "../../scripts/src/m15/fixtures-manifest";

describe("M1.5 Phase 0 — prerequisites", () => {
  it("has required CENTCOM and UKMTO HTML fixtures", () => {
    const missing = M15_REQUIRED_FIXTURES.filter(
      (name) => !existsSync(join(M15_FIXTURE_DIR, name)),
    );
    expect(missing).toEqual([]);
  });

  it("has optional second CENTCOM release and UKMTO warning fixtures", () => {
    const missing = M15_OPTIONAL_FIXTURES.filter(
      (name) => !existsSync(join(M15_FIXTURE_DIR, name)),
    );
    expect(missing).toEqual([]);
  });

  it("exports stable live source URLs for deploy smoke checks", () => {
    expect(CENTCOM_SOURCE_URL).toBe(
      "https://www.centcom.mil/MEDIA/PRESS-RELEASES/",
    );
    expect(CENTCOM_RSS_URL).toContain("ContentType=2");
    expect(UKMTO_SOURCE_URL).toBe("https://www.ukmto.org/ukmto-products");
    expect(JMIC_SOURCE_URL).toBe(
      "https://www.ukmto.org/partner-products/jmic-products",
    );
    expect(CMF_SOURCE_URL).toBe(
      "https://www.ukmto.org/partner-products/cmf-products",
    );
  });
});
