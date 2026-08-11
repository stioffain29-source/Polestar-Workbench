import {
  classifyScope,
  attributedCountriesAreDestinationOnly,
} from "../../artifacts/workbench/src/lib/cargoAnalysis";
import {
  buildCargoPatternModel,
  NO_ARREST_RE,
  type CargoAppendixRow,
  type CargoPatternModelInput,
} from "../../artifacts/workbench/src/lib/cargoPatternModel";
import { validateCargoReport } from "../../artifacts/workbench/src/lib/cargoReportValidation";

// Regression tripwires for the shared Cargo Watch generator root-fix (spec pt2/
// pt7). Every check is DISPLAY-side — no relevance-rule change, no ingest edit —
// and locks in behaviour that applies to EVERY cargo Watch report because it
// rides the one shared classifyScope / buildCargoPatternModel / validateCargoReport
// pipeline.

function inc(p: Partial<CargoPatternModelInput>): CargoPatternModelInput {
  return {
    title: "",
    summary: "",
    occurredAt: "2026-06-23",
    topic: "cargo_watch",
    severity: "moderate",
    country: "Malaysia",
    ...p,
  };
}

// ---------------------------------------------------------------------------
// pt2 — destination-attribution guard: a row whose ONLY in-scope country mention
// is a shipping DESTINATION did not occur there, so it is out of geographic
// scope and must never count as an in-region cargo incident.
// ---------------------------------------------------------------------------
describe("cargo scope — destination-only attribution is out of geographic scope", () => {
  it("flags a '-bound' vessel whose attributed country is the destination", () => {
    expect(
      attributedCountriesAreDestinationOnly({
        title: "India-bound cargo vessel intercepted with stowaways off West Africa",
        country: "India",
      }),
    ).toBe(true);
  });

  it("flags a 'bound for' destination phrase", () => {
    expect(
      attributedCountriesAreDestinationOnly({
        title: "Cargo ship bound for Bangladesh seized off West Africa",
        country: "Bangladesh",
      }),
    ).toBe(true);
  });

  it("classifyScope demotes a destination-only row to out_of_scope_geo", () => {
    expect(
      classifyScope(
        { title: "India-bound cargo vessel intercepted with stowaways off West Africa", country: "India" },
        "APAC",
      ),
    ).toBe("out_of_scope_geo");
  });

  it("keeps a row when the attributed country is the incident location, not a destination", () => {
    expect(
      attributedCountriesAreDestinationOnly({
        title: "Container truck hijacked in Malaysia en route to Singapore",
        country: "Malaysia",
      }),
    ).toBe(false);
    expect(
      classifyScope(
        { title: "Container truck hijacked in Malaysia en route to Singapore", country: "Malaysia" },
        "APAC",
      ),
    ).toBe("in_scope");
  });
});

// ---------------------------------------------------------------------------
// pt2 — non-cargo stowaway guard: animal / cruise-passenger / P&I-statistics
// "stowaway" pieces are human-interest or commentary, not cargo-crime events. A
// GENUINE human stowaway in a container / hold at an in-scope port still counts.
// ---------------------------------------------------------------------------
describe("cargo scope — non-cargo stowaway pieces are excluded", () => {
  it("drops an animal stowaway story", () => {
    expect(
      classifyScope(
        { title: "Squirrel stowaway rescued from a container ship at Singapore", country: "Singapore" },
        "APAC",
      ),
    ).toBe("excluded_non_cargo");
  });

  it("drops a cruise-passenger stowaway scare", () => {
    expect(
      classifyScope(
        { title: "Stowaway scare aboard a cruise liner off Malaysia, all passengers safe", country: "Malaysia" },
        "APAC",
      ),
    ).toBe("excluded_non_cargo");
  });

  it("keeps a genuine human stowaway found in a cargo container at an in-scope port", () => {
    expect(
      classifyScope(
        { title: "Human stowaways found hidden inside a shipping container at Port Klang", country: "Malaysia" },
        "APAC",
      ),
    ).toBe("in_scope");
  });
});

// ---------------------------------------------------------------------------
// pt7 — a client status of "Suspects arrested" must not sit on a source that
// reports NO arrest / active pursuit. deriveClientStatus vetoes this over the
// title+summary corpus.
// ---------------------------------------------------------------------------
describe("NO_ARREST_RE — active-pursuit cues", () => {
  it.each([
    "Police say no arrests have been made",
    "The suspects are still at large",
    "A manhunt is under way for the gang",
    "An arrest warrant was issued",
    "The robbers fled the scene",
    "Police are hunting for the culprits",
  ])("matches an active-pursuit cue: %s", (s) => {
    expect(NO_ARREST_RE.test(s)).toBe(true);
  });

  it.each([
    "Police arrested three suspects",
    "Three men were detained overnight",
  ])("does not match a genuine arrest: %s", (s) => {
    expect(NO_ARREST_RE.test(s)).toBe(false);
  });
});

describe("client status — NO_ARREST veto in the built model", () => {
  const rows: CargoPatternModelInput[] = [
    inc({
      id: 501,
      title: "Container truck of electronics hijacked on the North-South Highway in Malaysia",
      summary:
        "Police say the robbers are still at large and a manhunt is under way; no arrests have been made.",
      severity: "high",
      country: "Malaysia",
      source: "Reuters",
      sourceUrl: "https://example.test/501",
      occurredAt: "2026-06-22",
    }),
    inc({
      id: 502,
      title: "Container truck robbers arrested in Johor, Malaysia",
      summary: "Police arrested three suspects over the electronics consignment theft.",
      severity: "moderate",
      country: "Malaysia",
      source: "Local Daily",
      sourceUrl: "https://example.test/502",
      occurredAt: "2026-06-20",
    }),
  ];
  const model = buildCargoPatternModel(rows, { issueDate: "2026-06-24" });

  it("does NOT report 'Suspects arrested' when the source says no arrest", () => {
    const veto = model.appendix.find((r) => r.id === "501");
    expect(veto).toBeDefined();
    expect(veto?.clientStatus).not.toBe("Suspects arrested");
  });

  it("reports 'Suspects arrested' when the source confirms an arrest", () => {
    const positive = model.appendix.find((r) => r.id === "502");
    expect(positive).toBeDefined();
    expect(positive?.clientStatus).toBe("Suspects arrested");
  });
});

// ---------------------------------------------------------------------------
// pt2 — weekly-matrix range labels are CLIPPED to the report window, so the last
// column never advertises days after the issue date.
// ---------------------------------------------------------------------------
describe("weekly matrix labels — clipped to the report window", () => {
  it("clips the final week's range at the issue date", () => {
    const rows = [
      inc({ id: 1, title: "Container truck hijacked in Malaysia", occurredAt: "2026-06-22", country: "Malaysia" }),
      inc({ id: 2, title: "Bonded warehouse raided in Jakarta, Indonesia", occurredAt: "2026-06-23", country: "Indonesia" }),
    ];
    const model = buildCargoPatternModel(rows, { issueDate: "2026-06-24" });
    expect(model.activity.weeks.length).toBeGreaterThan(0);
    const last = model.activity.weeks[model.activity.weeks.length - 1];
    // Range format "22 Jun–24 Jun*" (en-dash; * marks a partial week clipped to
    // the issue date) — never the natural Sunday week-end (28 Jun).
    expect(last.label).toContain("24 Jun");
    expect(last.label).not.toContain("28 Jun");
    expect(last.label).toMatch(/^\d{1,2} \w{3}(\u2013\d{1,2} \w{3})?\*?$/);
  });
});

// ---------------------------------------------------------------------------
// pt7 — validation gate check 11: STATUS_CONTRADICTS_SOURCE. Passes by
// construction on a clean model; fires on a regression / bad edit that leaves a
// "Suspects arrested" row over a no-arrest summary.
// ---------------------------------------------------------------------------
describe("validateCargoReport — status-contradicts-source tripwire", () => {
  const rows: CargoPatternModelInput[] = [
    inc({
      id: 601,
      title: "Container truck of electronics hijacked on the North-South Highway in Malaysia",
      summary: "Police recovered part of the electronics consignment near Johor.",
      severity: "high",
      country: "Malaysia",
      source: "Reuters",
      sourceUrl: "https://example.test/601",
      occurredAt: "2026-06-22",
    }),
  ];
  const issueDate = "2026-06-24";

  it("a clean model does not trip check 11", () => {
    const model = buildCargoPatternModel(rows, { issueDate });
    const issues = validateCargoReport(model, {}, issueDate);
    expect(issues.some((i) => i.code === "STATUS_CONTRADICTS_SOURCE")).toBe(false);
  });

  it("fires when a row is marked 'Suspects arrested' over a no-arrest source", () => {
    const model = buildCargoPatternModel(rows, { issueDate });
    const appendix = model.appendix as CargoAppendixRow[];
    expect(appendix.length).toBeGreaterThan(0);
    appendix[0].clientStatus = "Suspects arrested";
    appendix[0].summary = "The robbers are still at large; no arrests have been made.";
    const issues = validateCargoReport(model, {}, issueDate);
    expect(issues.some((i) => i.code === "STATUS_CONTRADICTS_SOURCE")).toBe(true);
  });
});
