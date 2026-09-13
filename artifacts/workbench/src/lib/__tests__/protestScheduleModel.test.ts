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
    expect(watchNext).toMatch(/Monitor confirmed protest activity/);
    expect(watchNext).toMatch(/Possible mobilisation/);
    expect(watchNext).toMatch(/monitor for confirmation before changing plans/);
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
