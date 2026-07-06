/**
 * The Data Centres monitor fetches incidents with `useListIncidents({ topic:
 * "data_centres" })`. The api-server validates that query against the generated
 * `ListIncidentsQueryParams` (which references the `Topic` enum) via a
 * `safeParse`, so if `data_centres` is missing from the OpenAPI `Topic` enum the
 * authenticated request 400s and the whole monitor renders zeros — silently,
 * because a `topic: "data_centres" as never` cast used to hide the type error at
 * compile time.
 *
 * This locks in the fix:
 *   1. the generated `Topic` enum must include `data_centres`; and
 *   2. DataCentres.tsx must query that topic WITHOUT re-adding the `as never`
 *      cast (which would re-mask a future enum regression).
 */

import { readFileSync } from "fs";
import { join } from "path";

const GENERATED_TOPIC = join(
  __dirname,
  "../../lib/api-zod/src/generated/types/topic.ts",
);
const PAGE = join(
  __dirname,
  "../../artifacts/workbench/src/pages/DataCentres.tsx",
);

describe("data_centres is a first-class Topic", () => {
  it("generated Topic enum includes data_centres", () => {
    const src = readFileSync(GENERATED_TOPIC, "utf8");
    expect(src).toMatch(/data_centres:\s*['"]data_centres['"]/);
  });

  it("DataCentres.tsx queries the data_centres topic without an `as never` cast", () => {
    const src = readFileSync(PAGE, "utf8");
    expect(src).toMatch(/useListIncidents\(\{\s*topic:\s*["']data_centres["']\s*\}\)/);
    expect(src).not.toMatch(/topic:\s*["']data_centres["']\s+as\s+never/);
  });
});
