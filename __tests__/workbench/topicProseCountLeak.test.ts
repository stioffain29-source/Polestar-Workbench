import {
  stableDraftTopicReportProse,
  type TopicAiProse,
  resolveSimpleProse,
  aiOr,
} from "../../artifacts/workbench/src/lib/topicProseResolution";
import type { DraftableIncident } from "../../artifacts/workbench/src/lib/draftReportProse";

// User preference (replit.md): report PROSE must NEVER carry parenthetical
// record/incident count annotations like "(2 records)" or "(12 of 30
// incidents)". Counts belong only on Fast Facts tiles and chart captions.
//
// P4 wires a deterministic draft (stableDraftTopicReportProse) in beneath the
// AI narrative as the labelled fallback for EVERY topic report, feeding both the
// on-screen preview and the PDF. This guard runs that fallback for every topic,
// over both a quiet (zero) and a populated window, and asserts none of the
// seven narrative sections leaks a count annotation — so a future edit to any
// per-topic template cannot silently reintroduce one.

const FORBIDDEN_COUNT = /\(\s*\d+(\s+of\s+\d+)?\s+(records?|incidents?|events?)\s*\)/i;

const ISSUE_DATE = "2026-06-20";

const TOPICS = [
  "shipping",
  "conflict",
  "fuel",
  "cargo_watch",
  "energy",
  "fertiliser",
  "flashpoint",
  "protests",
] as const;

function makeIncidents(topic: string): DraftableIncident[] {
  // A small, deliberately count-rich populated window. Titles carry the topic
  // keyword so topic-relevance gates admit them and the populated template
  // branches (not just the zero branch) are exercised.
  const base = [
    { country: "Indonesia", location: "Jakarta", severity: "High" },
    { country: "Philippines", location: "Manila", severity: "Moderate" },
    { country: "Indonesia", location: "Surabaya", severity: "Low" },
    { country: "Malaysia", location: "Port Klang", severity: "Moderate" },
    { country: "Singapore", location: "Singapore Strait", severity: "High" },
  ];
  return base.map((b, i) => ({
    id: i + 1,
    topic,
    title: `${topic} incident ${i + 1} reported near ${b.location}`,
    summary: `A ${topic} event affecting ${b.country}; 3 vehicles and 12 containers involved.`,
    source: "Test Wire",
    sourceUrl: `https://example.test/${topic}/${i + 1}`,
    location: b.location,
    severity: b.severity,
    occurredAt: `2026-06-1${i}T08:00:00+00:00`,
    country: b.country,
  }));
}

function sectionsOf(prose: Record<string, string>): Array<[string, string]> {
  return Object.entries(prose).map(([k, v]) => [k, v]);
}

describe("topic report prose never leaks count annotations", () => {
  for (const topic of TOPICS) {
    it(`quiet window — ${topic}`, () => {
      const prose = stableDraftTopicReportProse({
        topic,
        issueDate: ISSUE_DATE,
        incidents: [],
      });
      for (const [section, text] of sectionsOf(prose)) {
        expect(`${topic}.${section}: ${text}`).not.toMatch(FORBIDDEN_COUNT);
      }
    });

    it(`populated window — ${topic}`, () => {
      const prose = stableDraftTopicReportProse({
        topic,
        issueDate: ISSUE_DATE,
        incidents: makeIncidents(topic),
      });
      for (const [section, text] of sectionsOf(prose)) {
        expect(`${topic}.${section}: ${text}`).not.toMatch(FORBIDDEN_COUNT);
      }
    });
  }
});

describe("prose resolver precedence", () => {
  const det = "Deterministic fallback line.";
  const ai: TopicAiProse = { situation: "AI situation narrative." };

  it("analyst edit wins over AI and deterministic", () => {
    expect(resolveSimpleProse("Edited.", ai.situation, det)).toBe("Edited.");
  });

  it("AI wins over deterministic when no edit", () => {
    expect(resolveSimpleProse("  ", ai.situation, det)).toBe(
      "AI situation narrative.",
    );
  });

  it("deterministic is the floor when neither edit nor AI present", () => {
    expect(resolveSimpleProse(null, null, det)).toBe(det);
    expect(resolveSimpleProse("", undefined, det)).toBe(det);
  });

  it("aiOr returns deterministic for blank AI, AI when present", () => {
    expect(aiOr("   ", det)).toBe(det);
    expect(aiOr(null, det)).toBe(det);
    expect(aiOr("AI line.", det)).toBe("AI line.");
  });
});
