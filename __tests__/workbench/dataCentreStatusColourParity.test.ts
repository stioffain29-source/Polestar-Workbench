/**
 * The facility status → marker colour map (`STATUS_COLOR`) drives both the
 * DataCentres registry list (`pages/DataCentres.tsx`) and the facility overlay
 * map (`components/DataCentreFacilityMap.tsx`). If those two copies drifted, the
 * same status would paint different colours on the map vs. the registry list,
 * confusing analysts.
 *
 * The registry page now imports `STATUS_COLOR` / `statusColor` directly from the
 * map component, so there is a single source of truth. This test locks that in:
 * it reads the DataCentres.tsx source and asserts it does NOT redefine its own
 * `STATUS_COLOR` / `statusColor`, and that it imports them from the map
 * component — so a future edit re-adding a divergent copy fails here.
 */

import { readFileSync } from "fs";
import { join } from "path";

const PAGE = join(
  __dirname,
  "../../artifacts/workbench/src/pages/DataCentres.tsx",
);

describe("DataCentres registry ↔ facility map status colour parity", () => {
  const src = readFileSync(PAGE, "utf8");

  it("does not redefine a local STATUS_COLOR map", () => {
    expect(src).not.toMatch(/(?:const|let|var)\s+STATUS_COLOR\b/);
  });

  it("does not redefine a local statusColor helper", () => {
    expect(src).not.toMatch(/function\s+statusColor\b/);
    expect(src).not.toMatch(/(?:const|let|var)\s+statusColor\b/);
  });

  it("imports statusColor from the facility map component", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*\bstatusColor\b[^}]*\}\s*from\s*["']@\/components\/DataCentreFacilityMap["']/,
    );
  });
});
