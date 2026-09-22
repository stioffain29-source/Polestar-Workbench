import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/lib/regionalAi", () => ({ regionalJson: jest.fn() }));

import {
  extractRegionalForwardEvents,
  prescreenRegionalForwardSources,
  resolveRegionalForwardDate,
  validateRegionalForwardExtraction,
  type RegionalForwardExtraction,
  type RegionalForwardSource,
} from "../src/lib/regionalReportForward";
import { regionalJson } from "../src/lib/regionalAi";

const mockedRegionalJson = jest.mocked(regionalJson);

beforeEach(() => mockedRegionalJson.mockReset());

const source: RegionalForwardSource = {
  id: "me-1",
  title: "Port authority schedules navigation restriction",
  summary: "The UAE port authority said a navigation restriction will begin on September 22, 2026 in Fujairah for a naval exercise.",
  source: "Port Authority",
  url: "https://authority.example/notices/1",
  publishedAt: "2026-09-18T08:00:00Z",
  domain: "authority.example",
  country: "United Arab Emirates",
};

const included = (
  overrides: Partial<RegionalForwardExtraction["candidates"][number]> = {},
): RegionalForwardExtraction => ({
  candidates: [{
    sourceId: "me-1",
    decision: "include",
    reason: "",
    eventDate: "2026-09-22",
    country: "United Arab Emirates",
    location: "Fujairah",
    eventIdentity: "Fujairah naval exercise navigation restriction",
    trigger: "Fujairah navigation restriction begins",
    whyItMatters: "Vessel movements could face delays during the exercise.",
    whatToWatch: "Watch for published restriction boundaries and a lifting notice.",
    currentSeverity: "Moderate",
    dateQuote: "September 22, 2026",
    eventQuote: "a navigation restriction will begin on September 22, 2026 in Fujairah for a naval exercise",
    ...overrides,
  }],
  rejected: [],
});

describe("regional forward-event validation", () => {
  it("accepts grounded next-seven-day events and keeps evidence outside rendered fields", () => {
    const result = validateRegionalForwardExtraction(
      included(), [source], "middle_east_weekly", "2026-09-18",
    );
    expect(result.events).toEqual([{
      date: "2026-09-22",
      location: "Fujairah",
      trigger: "Fujairah navigation restriction begins",
      whyItMatters: "Vessel movements could face delays during the exercise.",
      whatToWatch: "Watch for published restriction boundaries and a lifting notice.",
      currentSeverity: "Moderate",
    }]);
    expect(result.evidence[0]).toMatchObject({
      sourceId: "me-1",
      url: source.url,
      status: "extracted",
      dateQuote: "September 22, 2026",
    });
    expect(JSON.stringify(result.events)).not.toContain(source.url);
    expect(JSON.stringify(result.events)).not.toContain(source.source);
  });

  it("resolves only unambiguous relative dates from publication time", () => {
    expect(resolveRegionalForwardDate("tomorrow", "2026-09-18T23:00:00Z")).toBe("2026-09-19");
    expect(resolveRegionalForwardDate("this coming Monday", "2026-09-18T08:00:00Z")).toBe("2026-09-21");
    expect(resolveRegionalForwardDate("on Monday", "2026-09-18T08:00:00Z")).toBeNull();
  });

  it("rejects dates outside the issue-date window", () => {
    expect(() => validateRegionalForwardExtraction(
      included({ eventDate: "2026-09-22" }), [source], "middle_east_weekly", "2026-09-22",
    )).toThrow("unsupported or out-of-window event date");
  });

  it("rejects a date not established by the exact quotation", () => {
    expect(() => validateRegionalForwardExtraction(
      included({ dateQuote: "will begin" }), [source], "middle_east_weekly", "2026-09-18",
    )).toThrow("unsupported or out-of-window event date");
  });

  it("rejects invented locations and off-region countries", () => {
    expect(() => validateRegionalForwardExtraction(
      included({ location: "Dubai" }), [source], "middle_east_weekly", "2026-09-18",
    )).toThrow("unsupported location");
    expect(() => validateRegionalForwardExtraction(
      included({ country: "France" }), [source], "middle_east_weekly", "2026-09-18",
    )).toThrow("unsupported or out-of-region country");
  });

  it("rejects copied publisher/headline text and unsupported numerical consequences", () => {
    expect(() => validateRegionalForwardExtraction(
      included({ trigger: source.title }), [source], "middle_east_weekly", "2026-09-18",
    )).toThrow("raw source copy or invalid rendered prose");
    expect(() => validateRegionalForwardExtraction(
      included({ whyItMatters: "Vessels could face 12-hour delays." }),
      [source], "middle_east_weekly", "2026-09-18",
    )).toThrow("number unsupported");
  });

  it("rejects an unsupported label and a generic watch instruction", () => {
    expect(() => validateRegionalForwardExtraction(
      included({ trigger: "Airport terminal closes" }),
      [source], "middle_east_weekly", "2026-09-18",
    )).toThrow("label unsupported");
    expect(() => validateRegionalForwardExtraction(
      included({ whatToWatch: "Continue monitoring the situation." }),
      [source], "middle_east_weekly", "2026-09-18",
    )).toThrow("specific observable watch signal");
  });

  it("allows a genuine zero while preserving rejected source links", () => {
    const result = validateRegionalForwardExtraction({
      candidates: [],
      rejected: [{ sourceId: "me-1", reason: "No supported future event date." }],
    }, [source], "middle_east_weekly", "2026-09-18");
    expect(result.events).toEqual([]);
    expect(result.evidence).toEqual([expect.objectContaining({
      url: source.url,
      status: "rejected",
      reason: "No supported future event date.",
    })]);
  });

  it("does not cardinally collapse different event identities sharing label, date and location", () => {
    const second = { ...source, id: "me-2", url: "https://authority.example/notices/2" };
    const extraction = included();
    extraction.candidates.push({
      ...extraction.candidates[0],
      sourceId: "me-2",
      eventIdentity: "Fujairah second naval exercise restriction",
    });
    const result = validateRegionalForwardExtraction(
      extraction, [source, second], "middle_east_weekly", "2026-09-18",
    );
    expect(result.events).toHaveLength(2);
  });

  it("requires every searched source to be auditable exactly once", () => {
    const extra = { ...source, id: "me-2" };
    expect(() => validateRegionalForwardExtraction(
      included(), [source, extra], "middle_east_weekly", "2026-09-18",
    )).toThrow("account for every source exactly once");
  });

  it("pre-screens missing and out-of-window date text without using publication dates", () => {
    const undated = {
      ...source,
      id: "undated",
      title: "Restriction planned",
      summary: "A restriction is planned in Fujairah.",
      publishedAt: "2026-09-22T08:00:00Z",
    };
    const old = {
      ...source,
      id: "old",
      summary: "A restriction was announced for September 10, 2026 in Fujairah.",
    };
    const result = prescreenRegionalForwardSources([undated, old, source], "2026-09-18");
    expect(result.eligible.map((row) => row.id)).toEqual(["me-1"]);
    expect(result.excluded).toEqual([
      expect.objectContaining({
        sourceId: "undated",
        reason: expect.stringContaining("publication date was not used"),
      }),
      expect.objectContaining({
        sourceId: "old",
        reason: expect.stringContaining("outside the next-seven-day"),
      }),
    ]);
  });

  it("batches every eligible source and aggregates rather than truncating to the first batch", async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      ...source,
      id: `source-${index}`,
      url: `https://authority.example/notices/${index}`,
    }));
    mockedRegionalJson
      .mockResolvedValueOnce({
        candidates: [],
        rejected: many.slice(0, 24).map((row) => ({ sourceId: row.id, reason: "No material scheduled event." })),
      })
      .mockResolvedValueOnce({
        candidates: [{
          ...included().candidates[0],
          sourceId: "source-24",
        }],
        rejected: [],
      });
    const result = await extractRegionalForwardEvents(many, "middle_east_weekly", "2026-09-18");
    expect(mockedRegionalJson).toHaveBeenCalledTimes(2);
    expect(result.events).toHaveLength(1);
    expect(result.evidence).toHaveLength(25);
    expect(result.evidence.at(-1)).toMatchObject({ sourceId: "source-24", status: "extracted" });
  });

  it("makes one correction attempt when the first batch response is incomplete", async () => {
    mockedRegionalJson
      .mockRejectedValueOnce(new Error("The regional analysis response was incomplete."))
      .mockResolvedValueOnce({
        candidates: [],
        rejected: [{ sourceId: source.id, reason: "No sufficiently grounded material event." }],
      });
    const result = await extractRegionalForwardEvents([source], "middle_east_weekly", "2026-09-18");
    expect(mockedRegionalJson).toHaveBeenCalledTimes(2);
    expect(result.events).toEqual([]);
    expect(result.evidence).toHaveLength(1);
  });
});