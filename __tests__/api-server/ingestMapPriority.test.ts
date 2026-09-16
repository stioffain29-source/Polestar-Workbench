import { readFileSync } from "node:fs";

describe("incident ingest map priority", () => {
  it("does not let the broad Flashpoint pass block every other live topic", () => {
    const source = readFileSync(
      "artifacts/api-server/src/lib/ingestRunner.ts",
      "utf8",
    );
    const flashpoint = source.indexOf(
      'markIngestStage("runIncidentIngest:flashpoint")',
    );
    for (const topic of [
      "cargo_watch",
      "shipping",
      "energy",
      "fertiliser",
      "fuel",
      "data_centres",
      "conflict",
      "indonesia_local",
      "apac_local",
    ]) {
      expect(
        source.indexOf(`markIngestStage("runIncidentIngest:${topic}")`),
      ).toBeLessThan(flashpoint);
    }
  });

  it("runs direct local incident feeds before ancillary context collectors", () => {
    const source = readFileSync(
      "artifacts/api-server/src/lib/ingestRunner.ts",
      "utf8",
    );
    const protestSchedule = source.indexOf(
      'markIngestStage("runProtestScheduleIngest")',
    );
    expect(
      source.indexOf('markIngestStage("runIncidentIngest:apac_local")'),
    ).toBeLessThan(protestSchedule);
    expect(
      source.indexOf('markIngestStage("runIncidentIngest:indonesia_local")'),
    ).toBeLessThan(protestSchedule);
  });
});