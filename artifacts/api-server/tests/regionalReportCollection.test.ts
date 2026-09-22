import type { RegionalForwardSource } from "@workspace/ingest";
import { regionalSourcesToIncidents } from "../src/lib/regionalReportCollection";

function source(
  id: string,
  title: string,
  domain = "security",
  publishedAt = "2025-02-12T10:30:00Z",
): RegionalForwardSource {
  return {
    id,
    title,
    summary: title,
    source: "Test Wire",
    url: `https://example.test/${id}`,
    publishedAt,
    domain,
    // A deliberately misleading query hint: conversion must ignore it.
    country: "Iran",
  };
}

describe("regionalSourcesToIncidents", () => {
  it("converts source material without promoting publication time to event time", () => {
    const rows = regionalSourcesToIncidents([
      source("israel-attack", "Missile attack hits infrastructure in Israel"),
      source("hormuz", "New shipping restriction announced for Strait of Hormuz", "maritime"),
      source("iraq-protest", "Iraqi protest blocks access to a government site", "political"),
      source("uae-rule", "UAE implements new foreign investment regulation", "regulatory"),
    ], "middle_east_weekly", "2025-02-12");

    expect(rows.map((row) => row.country)).toEqual([
      "Israel",
      null,
      "Iraq",
      "United Arab Emirates",
    ]);
    expect(rows[0]).toMatchObject({
      id: "israel-attack",
      occurredAt: "2025-02-12T10:30:00.000Z",
      incidentDate: null,
      source: "Test Wire",
      sourceUrl: "https://example.test/israel-attack",
      location: null,
      latitude: null,
      longitude: null,
      analystNotes: "regional-collector-domain:security",
    });
    expect(rows[1].analystNotes).toBe("regional-collector-domain:maritime");
  });

  it("preserves cyber and weather provenance in checked-fact candidate metadata", () => {
    const rows = regionalSourcesToIncidents([
      source("cyber", "Cyber attack disrupts Israeli government systems", "cyber"),
      source("weather", "Flood warning issued across Oman", "weather"),
    ], "middle_east_weekly", "2025-02-12");

    expect(rows[0]).toMatchObject({
      topic: "regional_cyber",
      category: "Cyber",
      analystNotes: "regional-collector-domain:cyber",
    });
    expect(rows[1]).toMatchObject({
      topic: "regional_weather",
      category: "Weather & Natural Hazards",
      analystNotes: "regional-collector-domain:weather",
    });
  });

  it("does not turn an Iran-linked actor into an Iran event at a UK venue", () => {
    const [row] = regionalSourcesToIncidents([
      source("uk-attack", "Iran-linked group carries out cyber attack in the UK", "cyber"),
    ], "middle_east_weekly", "2025-02-12");

    expect(row.country).toBe("United Kingdom");
    expect(row.country).not.toBe("Iran");
  });

  it("locally excludes publication dates outside issueDate minus six days through issueDate", () => {
    const rows = regionalSourcesToIncidents([
      source("start", "Attack reported in Israel", "security", "2025-02-06T00:00:00Z"),
      source("old", "Attack reported in Israel", "security", "2025-02-05T23:59:59Z"),
      source("issue", "Attack reported in Israel", "security", "2025-02-12T23:59:59Z"),
      source("future", "Attack reported in Israel", "security", "2025-02-13T00:00:00Z"),
    ], "middle_east_weekly", "2025-02-12");

    expect(rows.map((row) => row.id)).toEqual(["start", "issue"]);
  });
});