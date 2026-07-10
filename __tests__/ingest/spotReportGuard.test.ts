import {
  FORBIDDEN_SPOT_REPORT_PATTERNS,
  scanIngestForSpotReportWrites,
  scanSourceForSpotReportWrites,
  stripTsComments,
} from "./spotReportGuardLib";

describe("P1-D5 Spot Report guard — ingest must never write spot_reports", () => {
  it("finds no forbidden Spot Report patterns in lib/ingest or ingestRunner.ts", () => {
    const violations = scanIngestForSpotReportWrites();
    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  ${v.file}:${v.line} [${v.pattern}] ${v.excerpt}`)
        .join("\n");
      throw new Error(
        `Ingest paths must not reference spot_reports or spotReportsTable.\n${detail}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it("ignores spot_reports mentions inside comments (guardrail prose)", () => {
    const commented = stripTsComments(`
      // NEVER touches spot_reports.
      const x = 1;
    `);
    expect(commented).not.toContain("spot_reports");
    expect(scanSourceForSpotReportWrites("comment-only.ts", commented)).toEqual([]);
  });

  it.each(FORBIDDEN_SPOT_REPORT_PATTERNS.map((p) => [p.name, p.re] as const))(
    "flags %s in executable code",
    (name, re) => {
      const samples: Record<string, string> = {
        spotReportsTable: `await db.insert(spotReportsTable).values({ title: "x" });`,
        spot_reports: `await sql\`INSERT INTO spot_reports (title) VALUES ('x')\`;`,
        "insert.*spot": `db.insert(spotReportsTable)`,
      };
      const violations = scanSourceForSpotReportWrites(
        "synthetic.ts",
        samples[name] ?? `evil ${name}`,
      );
      expect(violations.some((v) => v.pattern === name)).toBe(true);
      expect(re.test(samples[name] ?? "")).toBe(true);
    },
  );
});
