import { MAX_PROSE_INCIDENTS } from "../../artifacts/api-server/src/lib/countryProse";
import {
  maxRelatedIncidentsRows,
  FUEL_RELATED_ROW_CAP,
  DEFAULT_RELATED_ROW_CAP,
} from "../../artifacts/workbench/src/lib/relatedIncidents";
import { SHIPPING_RELATED_ROW_CAP } from "../../artifacts/workbench/src/lib/shippingReportDataset";
import { FLASHPOINT_RELATED_ROW_CAP } from "../../artifacts/workbench/src/lib/flashpointReportDataset";

// Lockstep guard between the rendered Related Incidents tables and the server's
// per-incident AI summary generation cap.
//
// The server only ever generates summaries for the first MAX_PROSE_INCIDENTS
// (60) incidents — both the prompt and the fingerprint derive from that capped,
// canonicalised set (see canonicalIncidents in countryProse.ts). Every report's
// Related Incidents table renders the summary keyed by incident id, falling back
// to a deterministic line when none exists. Today every table cap (topic/conflict
// = 10, shipping/flashpoint = 6) sits far below 60, so no rendered row can ever
// outrun a generated summary.
//
// The hazard is the FUTURE: if anyone raises a table cap above the generation
// cap, the rows beyond 60 would silently show the deterministic fallback in both
// the preview and the PDF — a quiet regression with no other failing check.
// This suite makes that drift fail loudly: raising a table cap past
// MAX_PROSE_INCIDENTS breaks the build until the generation cap is raised in
// tandem.

describe("Related Incidents row caps stay within the summary-generation cap", () => {
  it("topic / conflict report cap (selectRelatedIncidents) never exceeds the generation cap", () => {
    expect(maxRelatedIncidentsRows()).toBeLessThanOrEqual(MAX_PROSE_INCIDENTS);
  });

  it("shipping report Related Incidents cap never exceeds the generation cap", () => {
    expect(SHIPPING_RELATED_ROW_CAP).toBeLessThanOrEqual(MAX_PROSE_INCIDENTS);
  });

  it("flashpoint report Related Incidents cap never exceeds the generation cap", () => {
    expect(FLASHPOINT_RELATED_ROW_CAP).toBeLessThanOrEqual(MAX_PROSE_INCIDENTS);
  });

  it("each per-topic component cap also stays within the generation cap", () => {
    // Belt-and-braces: the individual caps that feed maxRelatedIncidentsRows are
    // each bounded too, so a future topic branch reusing one cannot slip past.
    for (const cap of [FUEL_RELATED_ROW_CAP, DEFAULT_RELATED_ROW_CAP]) {
      expect(cap).toBeLessThanOrEqual(MAX_PROSE_INCIDENTS);
    }
  });
});
