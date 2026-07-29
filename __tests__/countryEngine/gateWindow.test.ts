// §33 event_within_window gate semantics (task 474).
//
// The reporting window is a REPORTING window: the brief deliberately keeps an
// event that was reported (published) inside the window even when the event
// itself occurred earlier (or an advisory that runs past the window end) — the
// narrative flags such items and states both dates. The gate must therefore:
//   - warn (never block) on an out-of-window eventDate with in-window reporting,
//   - fail-close only when the event has NO in-window publication at all.
import { checkDatesWithinWindow } from "@workspace/country-engine/gate";
import type { QualityGateReport } from "@workspace/country-engine/gate";
import type { CanonicalEvent } from "@workspace/country-engine/types";

function makeEvent(
  overrides: Partial<CanonicalEvent> & { eventId: string },
): CanonicalEvent {
  return {
    duplicateGroupId: null,
    eventDate: "2026-07-24",
    publicationDates: ["2026-07-24T00:00:00.000Z"],
    physicalCountry: "Thailand",
    inclusionStatus: "included",
    ...overrides,
  } as CanonicalEvent;
}

function makeReport(included: CanonicalEvent[]): QualityGateReport {
  return {
    events: included,
    included,
    narrative: { claims: [] } as never,
    sectionWordCounts: {},
    hasPriorData: false,
    countryName: "Thailand",
    reportingWindow: {
      start: "2026-07-22T00:00:00.000Z",
      end: "2026-07-29T00:00:00.000Z",
    },
  };
}

describe("checkDatesWithinWindow (§33)", () => {
  it("passes an event dated inside the window", () => {
    const failures = checkDatesWithinWindow(makeReport([makeEvent({ eventId: "a" })]));
    expect(failures).toHaveLength(0);
  });

  it("warns (not critical) when the event occurred before the window but was reported inside it", () => {
    const failures = checkDatesWithinWindow(
      makeReport([
        makeEvent({
          eventId: "b",
          eventDate: "2026-07-15",
          publicationDates: ["2026-07-23T08:00:00.000Z"],
        }),
      ]),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].check).toBe("event_within_window");
    expect(failures[0].severity).toBe("warning");
  });

  it("warns (not critical) for an advisory dated past the window end but reported inside it", () => {
    const failures = checkDatesWithinWindow(
      makeReport([
        makeEvent({
          eventId: "c",
          eventDate: "2026-07-31",
          publicationDates: ["2026-07-25T00:00:00.000Z"],
        }),
      ]),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].severity).toBe("warning");
  });

  it("fails critically when the event has no in-window publication", () => {
    const failures = checkDatesWithinWindow(
      makeReport([
        makeEvent({
          eventId: "d",
          eventDate: "2026-07-10",
          publicationDates: ["2026-07-11T00:00:00.000Z"],
        }),
      ]),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].severity).toBe("critical");
  });

  it("fails critically when publicationDates is empty and the date is outside the window", () => {
    const failures = checkDatesWithinWindow(
      makeReport([
        makeEvent({ eventId: "e", eventDate: "2026-07-10", publicationDates: [] }),
      ]),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].severity).toBe("critical");
  });

  it("skips undated events (held/omitted elsewhere)", () => {
    const failures = checkDatesWithinWindow(
      makeReport([makeEvent({ eventId: "f", eventDate: null })]),
    );
    expect(failures).toHaveLength(0);
  });
});
