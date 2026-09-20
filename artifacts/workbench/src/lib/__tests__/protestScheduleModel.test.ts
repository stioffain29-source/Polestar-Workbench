import {
  buildProtestScheduleModel,
  buildProtestScheduleWatchNext,
  PROTEST_EMPTY_SENTENCE,
  protestScheduleActivity,
  reconcileProtestForecastRead,
} from "../protestScheduleModel";
import type { ProtestEvent } from "@workspace/api-client-react";

function event(
  id: number,
  status: ProtestEvent["status"],
  date: string,
): ProtestEvent {
  return {
    id,
    sourceName: "test",
    sourceUrl: `https://example.test/${id}`,
    sourceTitle: `Event ${id}`,
    sourcePublishedAt: "2026-08-01T00:00:00Z",
    eventDate: date,
    country: "India",
    city: "Delhi",
    venue: "Central square",
    eventType: "rally",
    issue: "wages",
    organiser: "Union",
    description: null,
    startTime: "10:00",
    attendance: null,
    disruptionPotential: "Moderate",
    confidence: "Moderate",
    status,
    collectedAt: "2026-08-01T00:00:00Z",
    searchCompletedAt: "2026-08-01T00:00:00Z",
    dedupKey: String(id),
  };
}

describe("protest schedule model", () => {
  it("orders the active schedule chronologically and keeps Possible in watchlist", () => {
    const model = buildProtestScheduleModel(
      {
        confirmedPlanned: [
          event(2, "Planned", "2026-08-05T00:00:00Z"),
          event(1, "Confirmed", "2026-08-03T00:00:00Z"),
        ],
        possible: [event(3, "Possible", "2026-08-02T00:00:00Z")],
        searchCompletedAt: "2026-08-01T00:00:00Z",
      },
    );
    expect(model.schedule.map((row) => row.id)).toEqual([1, 2]);
    expect(model.watchlist.map((row) => row.id)).toEqual([3]);
  });

  it("does not show the empty sentence before search completion", () => {
    expect(
      buildProtestScheduleModel(undefined).empty,
    ).toBe(false);
    expect(
      buildProtestScheduleModel({ confirmedPlanned: [], possible: [], searchCompletedAt: null }).empty,
    ).toBe(false);
    expect(
      buildProtestScheduleModel({
        confirmedPlanned: [],
        possible: [],
        searchCompletedAt: "2026-08-01T00:00:00Z",
      }).empty,
    ).toBe(true);
    const manual = buildProtestScheduleModel({
      confirmedPlanned: [event(7, "Planned", "2026-08-03T00:00:00Z")],
      possible: [],
      searchCompletedAt: null,
    });
    expect(manual.searchCompleted).toBe(false);
    expect(manual.schedule).toHaveLength(1);
    expect(manual.empty).toBe(false);
    expect(PROTEST_EMPTY_SENTENCE).toBe(
      "No significant planned protest activity identified for the next seven days from currently available credible sources.",
    );
  });

  it("populates Watch Next from the schedule with cautious Possible wording", () => {
    const model = buildProtestScheduleModel(
      { confirmedPlanned: [event(1, "Confirmed", "2026-08-03T00:00:00Z")], possible: [event(2, "Possible", "2026-08-04T00:00:00Z")], searchCompletedAt: "2026-08-01T00:00:00Z" },
    );
    const watchNext = buildProtestScheduleWatchNext(model);
    expect(watchNext).toMatch(/rally — wages.*is scheduled/i);
    expect(watchNext).toMatch(/remains possible/i);
    expect(watchNext).toMatch(/confirm the organiser, venue and route/i);
  });

  it("lets an analyst row supersede an automated duplicate", () => {
    const automated = {
      ...event(1, "Planned", "2026-08-03T00:00:00Z"),
      sourceName: "google_news_protest_schedule",
    };
    const analyst = {
      ...event(2, "Planned", "2026-08-03T00:00:00Z"),
      sourceName: "analyst_schedule_upload",
    };
    const model = buildProtestScheduleModel({
      confirmedPlanned: [automated, analyst],
      possible: [],
      searchCompletedAt: "2026-08-01T00:00:00Z",
    });
    expect(model.schedule.map((row) => row.id)).toEqual([2]);
  });

  it("clusters same mobilisation notices but keeps separate same-day venues", () => {
    const first = {
      ...event(10, "Planned", "2026-08-03T00:00:00Z"),
      description: "Union wages march at Central square",
      sourceTitle: "Union notice",
    };
    const routeNotice = {
      ...event(11, "Planned", "2026-08-03T00:00:00Z"),
      description: "Union wages march from Central square to City Hall",
      venue: "Central square",
      disruptionPotential: "High" as const,
      confidence: "High" as const,
      sourceTitle: "Route notice",
    };
    const separateVenue = {
      ...event(12, "Planned", "2026-08-03T00:00:00Z"),
      venue: "University gate",
      description: "Union wages rally at University gate",
    };
    const model = buildProtestScheduleModel({
      confirmedPlanned: [first, routeNotice, separateVenue],
      possible: [],
      searchCompletedAt: "2026-08-01T00:00:00Z",
    });
    expect(model.schedule.map((row) => row.id)).toEqual([11, 12]);
  });

  it("clusters explicitly multi-stage route notices across adjacent dates", () => {
    const stageOne = {
      ...event(20, "Planned", "2026-08-03T00:00:00Z"),
      venue: "North gate",
      description: "Workers march from North gate to Central square, day 1",
    };
    const stageTwo = {
      ...event(21, "Planned", "2026-08-04T00:00:00Z"),
      venue: "North gate",
      description: "Workers march from North gate to Central square, day 2",
      disruptionPotential: "High" as const,
      confidence: "High" as const,
    };
    const model = buildProtestScheduleModel({
      confirmedPlanned: [stageOne, stageTwo],
      possible: [],
      searchCompletedAt: "2026-08-01T00:00:00Z",
    });
    expect(model.schedule.map((row) => row.id)).toEqual([21]);
  });

  it("clusters one named multi-stage mobilisation from departure through its later gathering", () => {
    const departure = {
      ...event(50, "Planned", "2026-09-15T00:00:00Z"),
      country: "India",
      city: "Mumbai",
      venue: "Regional route to Mumbai",
      eventType: "Mobilisation",
      organiser: null,
      issue: null,
      description:
        "Maratha reservation mobilisation begins movement toward Mumbai. Manoj Jarange supporters depart with staged stops before the main protest.",
    };
    const sourceCopy = {
      ...event(51, "Planned", "2026-09-15T00:00:00Z"),
      country: "India",
      city: "Mumbai",
      venue: null,
      eventType: "march",
      organiser: "Sept 15",
      issue: null,
      description:
        "Jarange-Patil to march to Mumbai from Sept 15, government asks him to call off the stir.",
    };
    const gathering = {
      ...event(52, "Planned", "2026-09-19T00:00:00Z"),
      country: "India",
      city: "Mumbai",
      venue: "Central protest ground",
      eventType: "Protest",
      organiser: null,
      issue: null,
      description:
        "Maratha reservation protest and indefinite hunger strike begins. Supporters arriving from the multi day mobilisation are expected to concentrate in Mumbai.",
    };
    const model = buildProtestScheduleModel({
      confirmedPlanned: [departure, sourceCopy, gathering],
      possible: [],
      searchCompletedAt: "2026-09-13T00:00:00Z",
    });
    expect(model.schedule).toHaveLength(1);
    const watchNext = buildProtestScheduleWatchNext(model);
    expect(watchNext.match(/Mumbai/g)).toHaveLength(1);
  });

  it("ranks Watch Next by operational priority before date", () => {
    const lowEarly = {
      ...event(30, "Planned", "2026-08-02T00:00:00Z"),
      disruptionPotential: "Low" as const,
      attendance: 20,
      venue: "Community hall",
    };
    const highLater = {
      ...event(31, "Planned", "2026-08-06T00:00:00Z"),
      disruptionPotential: "High" as const,
      attendance: 5000,
      venue: "Central station",
      description: "National strike with road closures",
    };
    const model = buildProtestScheduleModel({
      confirmedPlanned: [lowEarly, highLater],
      possible: [],
      searchCompletedAt: "2026-08-01T00:00:00Z",
    });
    const lines = buildProtestScheduleWatchNext(model).split("\n");
    expect(lines[0]).toMatch(/06 Aug 2026/);
    expect(lines[1]).toMatch(/02 Aug 2026/);
  });

  it("treats routine Tokyo demonstrations as attendance-led rather than inherently disruptive", () => {
    const tokyo = {
      ...event(60, "Planned", "2026-08-06T00:00:00Z"),
      country: "Japan",
      city: "Tokyo",
      venue: "Public square",
      disruptionPotential: "High" as const,
      attendance: null,
    };
    const model = buildProtestScheduleModel({
      confirmedPlanned: [tokyo],
      possible: [],
      searchCompletedAt: "2026-08-01T00:00:00Z",
    });
    const watchNext = buildProtestScheduleWatchNext(model);
    expect(watchNext).toMatch(/normally orderly and localised/i);
    expect(watchNext).toMatch(/attendance materially exceeds expectations/i);
  });

  it("contains Bangkok activity to established assembly areas unless turnout or routes spill over", () => {
    const bangkok = {
      ...event(61, "Planned", "2026-08-06T00:00:00Z"),
      country: "Thailand",
      city: "Bangkok",
      venue: "Democracy Monument",
      disruptionPotential: "High" as const,
    };
    const model = buildProtestScheduleModel({
      confirmedPlanned: [bangkok],
      possible: [],
      searchCompletedAt: "2026-08-01T00:00:00Z",
    });
    const watchNext = buildProtestScheduleWatchNext(model);
    expect(watchNext).toMatch(/established Bangkok assembly area/i);
    expect(watchNext).toMatch(/do not infer wider city disruption/i);
  });

  it("does not publish cancelled or postponed stale rows", () => {
    const cancelled = event(40, "Cancelled", "2026-08-03T00:00:00Z");
    const postponed = event(41, "Postponed", "2026-08-04T00:00:00Z");
    const model = buildProtestScheduleModel({
      confirmedPlanned: [cancelled, postponed],
      possible: [],
      searchCompletedAt: "2026-08-01T00:00:00Z",
    });
    expect(model.schedule).toEqual([]);
    expect(model.watchlist).toEqual([]);
  });

  it("removes a publisher suffix from the displayed scheduled activity", () => {
    const row = {
      ...event(4, "Planned", "2026-09-15T00:00:00Z"),
      description:
        "Jarange-Patil to march to Mumbai from Sept 15, govt asks him to call off stir | Mumbai news Hindustan Times",
    };
    expect(protestScheduleActivity(row)).toBe(
      "Jarange-Patil to march to Mumbai from Sept 15, govt asks him to call off stir",
    );
  });

  it("drops empty-forecast boilerplate when the schedule has a row", () => {
    const model = buildProtestScheduleModel({
      confirmedPlanned: [event(5, "Planned", "2026-09-15T00:00:00Z")],
      possible: [],
      searchCompletedAt: "2026-09-13T00:00:00Z",
    });
    expect(
      reconcileProtestForecastRead(
        "No unsupported forecast is presented. Monitor confirmed announcements.",
        model,
      ),
    ).toBe("");
    expect(
      reconcileProtestForecastRead(
        "The planned march may affect access around the venue.",
        model,
      ),
    ).toBe("The planned march may affect access around the venue.");
  });
});
