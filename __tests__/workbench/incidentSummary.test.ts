import {
  deterministicIncidentSummary,
  resolveIncidentSummary,
  type DeterministicSummaryInput,
} from "../../artifacts/workbench/src/lib/incidentSummary";

// Guards the CLIENT-SIDE fallback shown under a Related Incidents row when the
// per-incident AI summary route returns available:false. resolveIncidentSummary
// must prefer the AI/edited summary keyed by incident id and otherwise fall back
// to deterministicIncidentSummary, which is grounded ONLY on the incident's own
// fields (derived type, location, date, severity) — never on fabricated facts.

// A cargo_watch record whose title routes cleanly to "Cargo theft / loss" via
// the shared classifier, so the asserted type label is stable.
const CARGO: DeterministicSummaryInput & { id: number } = {
  id: 42,
  topic: "cargo_watch",
  title: "Cargo theft on highway",
  summary: null,
  source: null,
  sourceUrl: null,
  location: "Lae",
  severity: "high",
  occurredAt: "2026-03-15T08:00:00.000Z",
};

describe("deterministicIncidentSummary", () => {
  it("builds a one-line summary from the incident's own fields", () => {
    expect(deterministicIncidentSummary(CARGO)).toBe(
      "Cargo theft / loss in Lae, reported 15 Mar 2026, assessed at High severity.",
    );
  });

  it("omits the location clause when location is missing or empty", () => {
    expect(deterministicIncidentSummary({ ...CARGO, location: null })).toBe(
      "Cargo theft / loss, reported 15 Mar 2026, assessed at High severity.",
    );
    expect(deterministicIncidentSummary({ ...CARGO, location: "   " })).toBe(
      "Cargo theft / loss, reported 15 Mar 2026, assessed at High severity.",
    );
  });

  it("omits the severity clause when severity is missing or unrecognised", () => {
    expect(deterministicIncidentSummary({ ...CARGO, severity: null })).toBe(
      "Cargo theft / loss in Lae, reported 15 Mar 2026.",
    );
    expect(deterministicIncidentSummary({ ...CARGO, severity: "" })).toBe(
      "Cargo theft / loss in Lae, reported 15 Mar 2026.",
    );
    expect(deterministicIncidentSummary({ ...CARGO, severity: "catastrophic" })).toBe(
      "Cargo theft / loss in Lae, reported 15 Mar 2026.",
    );
  });

  it("normalises the severity label to the five-tier vocabulary regardless of case", () => {
    expect(deterministicIncidentSummary({ ...CARGO, severity: "EXTREME" })).toBe(
      "Cargo theft / loss in Lae, reported 15 Mar 2026, assessed at Extreme severity.",
    );
  });

  it("leaves the date string raw when occurredAt cannot be parsed", () => {
    expect(deterministicIncidentSummary({ ...CARGO, occurredAt: "not-a-date" })).toBe(
      "Cargo theft / loss in Lae, reported not-a-date, assessed at High severity.",
    );
  });

  it("falls back to the generic type when the incident has no classifying cue", () => {
    expect(
      deterministicIncidentSummary({
        ...CARGO,
        topic: "unknown-topic",
        title: "Something happened",
        location: null,
        severity: null,
      }),
    ).toBe("Other operational incident, reported 15 Mar 2026.");
  });
});

describe("resolveIncidentSummary", () => {
  it("returns the supplied AI/edited summary when one exists for the incident id", () => {
    expect(
      resolveIncidentSummary(CARGO, { "42": "A vetted analyst summary." }),
    ).toBe("A vetted analyst summary.");
  });

  it("the supplied summary takes precedence over the deterministic fallback", () => {
    const supplied = resolveIncidentSummary(CARGO, { "42": "Edited override." });
    expect(supplied).toBe("Edited override.");
    expect(supplied).not.toBe(deterministicIncidentSummary(CARGO));
  });

  it("trims surrounding whitespace from the supplied summary", () => {
    expect(
      resolveIncidentSummary(CARGO, { "42": "  Padded summary.  " }),
    ).toBe("Padded summary.");
  });

  it("falls back to the deterministic line when no summary map is provided", () => {
    expect(resolveIncidentSummary(CARGO, undefined)).toBe(
      deterministicIncidentSummary(CARGO),
    );
  });

  it("falls back when the map has no entry for this incident id", () => {
    expect(resolveIncidentSummary(CARGO, { "99": "Other incident." })).toBe(
      deterministicIncidentSummary(CARGO),
    );
  });

  it("falls back when the supplied summary is empty or whitespace-only", () => {
    expect(resolveIncidentSummary(CARGO, { "42": "" })).toBe(
      deterministicIncidentSummary(CARGO),
    );
    expect(resolveIncidentSummary(CARGO, { "42": "   " })).toBe(
      deterministicIncidentSummary(CARGO),
    );
  });

  it("falls back when the incident id is null or undefined", () => {
    expect(
      resolveIncidentSummary({ ...CARGO, id: null }, { "": "Should not be used." }),
    ).toBe(deterministicIncidentSummary(CARGO));
    expect(
      resolveIncidentSummary({ ...CARGO, id: undefined }, { "42": "Keyed elsewhere." }),
    ).toBe(deterministicIncidentSummary(CARGO));
  });

  it("matches a numeric id against its stringified map key", () => {
    expect(
      resolveIncidentSummary({ ...CARGO, id: 7 }, { "7": "By string key." }),
    ).toBe("By string key.");
  });
});
