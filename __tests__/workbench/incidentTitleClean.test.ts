import { stripWireCruft } from "../../artifacts/workbench/src/lib/incidentTitle";
import {
  selectRelatedIncidents,
  type RelatedIncidentInput,
} from "../../artifacts/workbench/src/lib/relatedIncidents";
import {
  computeCountryFastFacts,
  type CountryFastFactsIncident,
} from "../../artifacts/workbench/src/lib/countryFastFacts";

// The shared cleaner now backs flashpoint, shipping, cargo, fuel, conflict and
// the country briefs. These assert the behaviour on the SINGLE exported copy so
// a regression anywhere is caught once.
describe("stripWireCruft (shared cleaner)", () => {
  it("strips a leading 'Watch:' video call-to-action", () => {
    expect(stripWireCruft("Watch: Tanker seized off Hormuz")).toBe(
      "Tanker seized off Hormuz",
    );
  });

  it("strips a trailing 'VIDEO BY <credit>' attribution", () => {
    expect(stripWireCruft("Cargo lorry hijacked on the N3 VIDEO BY ALLEN LIMOS")).toBe(
      "Cargo lorry hijacked on the N3",
    );
  });

  it("strips trailing '(VIDEO)' / ' - WATCH' / ' | VIDEO' tags", () => {
    expect(stripWireCruft("Fuel depot fire spreads (VIDEO)")).toBe("Fuel depot fire spreads");
    expect(stripWireCruft("Strike on Kharkiv substation - WATCH")).toBe(
      "Strike on Kharkiv substation",
    );
    expect(stripWireCruft("Clashes in Port Moresby | VIDEO")).toBe("Clashes in Port Moresby");
  });

  it("does NOT touch a real headline that merely contains watch/video", () => {
    expect(stripWireCruft("Watch out for fuel shortages this week")).toBe(
      "Watch out for fuel shortages this week",
    );
    expect(stripWireCruft("Protest video goes viral after clashes")).toBe(
      "Protest video goes viral after clashes",
    );
  });

  it("does NOT strip a natural lowercase 'video by ...' prose clause", () => {
    expect(stripWireCruft("Seizure video by citizen journalist goes viral")).toBe(
      "Seizure video by citizen journalist goes viral",
    );
  });

  it("is idempotent", () => {
    const once = stripWireCruft("Watch: Tanker seized off Hormuz (VIDEO)");
    expect(stripWireCruft(once)).toBe(once);
    expect(once).toBe("Tanker seized off Hormuz");
  });
});

// selectRelatedIncidents is the single row-selection authority shared by the
// cargo, fuel and conflict reports (preview + PDF). Cleaning happens on its
// input rows, so cruft is stripped from rendered titles AND cruft-only copies of
// the same event collapse into one row.
describe("selectRelatedIncidents — video-cruft cleaning + dedupe", () => {
  function row(over: Partial<RelatedIncidentInput> & { title: string }): RelatedIncidentInput {
    return {
      topic: "shipping",
      occurredAt: "2026-06-26T00:00:00Z",
      severity: "moderate",
      ...over,
    };
  }

  it("strips wire cruft from the rendered title", () => {
    const out = selectRelatedIncidents(
      [row({ title: "Watch: Tanker seized off Hormuz (VIDEO)" })],
      "shipping",
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Tanker seized off Hormuz");
  });

  it("collapses a 'Watch:' copy and a 'VIDEO BY' copy of the SAME event into one row", () => {
    const out = selectRelatedIncidents(
      [
        row({
          title: "Tanker seized off Hormuz VIDEO BY ALLEN LIMOS",
          occurredAt: "2026-06-27T00:00:00Z",
        }),
        row({
          title: "Watch: Tanker seized off Hormuz",
          occurredAt: "2026-06-26T00:00:00Z",
        }),
      ],
      "shipping",
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Tanker seized off Hormuz");
  });

  it("keeps two genuinely different events apart", () => {
    const out = selectRelatedIncidents(
      [
        row({ title: "Tanker seized off Hormuz" }),
        row({ title: "Bulk carrier grounded in the Singapore Strait" }),
      ],
      "shipping",
    );
    expect(out).toHaveLength(2);
  });

  it("cleans the English displayTitle when present (conflict/cargo render it)", () => {
    const out = selectRelatedIncidents(
      [
        {
          ...row({ title: "asli" }),
          displayTitle: "Watch: Drone strike on Kharkiv substation (VIDEO)",
        } as RelatedIncidentInput & { displayTitle: string },
      ],
      "conflict",
    );
    expect(out).toHaveLength(1);
    expect((out[0] as { displayTitle?: string }).displayTitle).toBe(
      "Drone strike on Kharkiv substation",
    );
  });
});

// The generic country report (every non-structured country) shares one source of
// truth: computeCountryFastFacts. The on-screen preview (CountryReport.tsx) and
// the headless PDF (exportCountryReportPdf) BOTH read its windowIncidents, so
// cleaning there keeps preview == PDF while stripping cruft from the country
// incident table.
describe("computeCountryFastFacts (generic country report) — video-cruft cleaning", () => {
  function inc(
    over: Partial<CountryFastFactsIncident> & { title: string },
  ): CountryFastFactsIncident {
    return {
      topic: "country",
      severity: "moderate",
      occurredAt: "2026-06-26T00:00:00Z",
      country: "Papua New Guinea",
      ...over,
    };
  }

  it("strips cruft from windowIncidents title + displayTitle", () => {
    const facts = computeCountryFastFacts({
      issueDate: "2026-06-29",
      windowIncidents: [
        inc({ title: "Watch: Clashes erupt in Port Moresby (VIDEO)" }),
        inc({
          title: "asli",
          displayTitle: "Looting spreads in Lae VIDEO BY ALLEN LIMOS",
        }),
      ],
    });
    const titles = facts.windowIncidents.map((i) => i.title);
    expect(titles).toContain("Clashes erupt in Port Moresby");
    const cleanedDisplay = facts.windowIncidents.find(
      (i) => i.title === "asli",
    )?.displayTitle;
    expect(cleanedDisplay).toBe("Looting spreads in Lae");
  });
});
