/**
 * Daily tracker quality refresh — coverage map and per-record checks.
 *
 * Replays known sports/noise drops and genuine-event keeps across every
 * covered product, and pins the behaviour that makes the daily pass safe: it
 * can only remove or flag, never re-admit, re-rate or rewrite.
 */
import {
  DAILY_QUALITY_COVERAGE,
  DAILY_QUALITY_INTERVAL_MS,
  checkIncidentQuality,
  countryAttributionForTopic,
  coverageEntry,
  coveredIncidentTopics,
  findDuplicateEventFindings,
  hasProvenanceAdmission,
  isDailyQualityDue,
  nextDailyQualityDueAt,
  type DailyQualityCandidate,
} from "../../lib/ingest/src/dailyQuality";
import { RELEVANCE_RULE_VERSION } from "../../lib/relevance/src/evaluate";

const NOW = new Date("2026-09-22T09:00:00.000Z");
const RECENT = new Date("2026-09-20T09:00:00.000Z");

function row(overrides: Partial<DailyQualityCandidate> = {}): DailyQualityCandidate {
  return {
    id: 1,
    topic: "flashpoint",
    title: "Protesters block the main highway in Jakarta",
    summary: "Police dispersed a crowd blocking the toll road.",
    country: "Indonesia",
    occurredAt: RECENT,
    relevanceStatus: "relevant",
    ...overrides,
  };
}

describe("daily quality coverage map", () => {
  it("covers every tracker in scope, each with an explicit kind", () => {
    const keys = DAILY_QUALITY_COVERAGE.map((e) => e.key);
    for (const required of [
      "flashpoint",
      "conflict",
      "shipping",
      "energy",
      "fuel",
      "fertiliser",
      "cargo_watch",
      "crime",
      "data_centres",
      "strikes",
      "fuel_prices",
      "maritime_movement",
      "maritime_security",
      "apac_weekly",
      "middle_east_weekly",
      "country_briefs",
    ]) {
      expect(keys).toContain(required);
    }
  });

  it("maps Civil Unrest onto the live flashpoint topic and its legacy alias", () => {
    expect(coverageEntry("flashpoint")?.topics).toEqual(["flashpoint", "protests"]);
  });

  it("discloses that Crime has no dedicated collector instead of claiming a refresh", () => {
    const crime = coverageEntry("crime")!;
    expect(crime.collector).toBeNull();
    expect(crime.note).toMatch(/no dedicated crime collector/i);
  });

  it("keeps prices, vessels and strike records out of the ordinary incident sweep", () => {
    for (const key of ["fuel_prices", "maritime_movement", "maritime_security", "strikes"]) {
      const entry = coverageEntry(key)!;
      expect(entry.kind).not.toBe("incidents");
      expect(entry.topics).toEqual([]);
    }
    expect(coveredIncidentTopics()).not.toContain("strikes");
  });
});

describe("daily quality — sports and non-event exclusions", () => {
  const SPORTS_DROPS: string[] = [
    "Harimau Malaya fall to Vietnam in Asean Cup semis, face tough return leg",
    "Late injury-time winner sends Thailand into the Sea Games final",
    "Australia win dead rubber as tournament group stage closes",
    "Keeper saves last-minute shot as Malaysia edge past Laos in Suzuki Cup semi-final",
  ];

  // Every covered incident tracker, so a fixture result cannot survive by
  // landing in a bucket whose own topic rules happen to be permissive.
  const INCIDENT_TOPICS = coveredIncidentTopics();

  it.each(SPORTS_DROPS)("excludes the sports fixture %s", (title) => {
    for (const topic of INCIDENT_TOPICS) {
      const verdict = checkIncidentQuality(row({ topic, title, summary: "" }), NOW);
      expect(verdict.kind).toBe("exclude");
      expect(verdict.checkName).toBe("sports_noise");
    }
  });

  it("excludes a stored sports record already carrying the CURRENT rule version", () => {
    // A version-gated backfill skips this row entirely; the daily pass does not.
    const verdict = checkIncidentQuality(
      row({
        title: "Australia win dead rubber as tournament group stage closes",
        summary: "",
        relevanceStatus: "relevant",
      }),
      NOW,
    );
    expect(verdict.kind).toBe("exclude");
    expect(verdict.checkName).toBe("sports_noise");
    expect(verdict.ruleVersion).toBe(RELEVANCE_RULE_VERSION);
    expect(verdict.beforeStatus).toBe("relevant");
    expect(verdict.afterStatus).toBe("irrelevant");
  });

  it("keeps a genuine security incident at a sporting venue", () => {
    const verdict = checkIncidentQuality(
      row({
        title: "One dead as fans riot after Asean Cup semi-final in Hanoi",
        summary: "",
        country: "Vietnam",
      }),
      NOW,
    );
    expect(verdict.kind).not.toBe("exclude");
  });

  it("keeps a labour stoppage despite the fixture gate's stoppage-time cue", () => {
    const verdict = checkIncidentQuality(
      row({
        topic: "flashpoint",
        title: "Port workers begin indefinite strike at Tanjung Priok",
        summary: "A work stoppage has halted container handling at the terminal.",
      }),
      NOW,
    );
    expect(verdict.kind).toBe("keep");
    expect(verdict.checkName).not.toBe("sports_noise");
  });

  it("judges the SOURCE text, not the translation, so a translated non-event is kept", () => {
    // Real stored row shape: Bahasa source, English display title. The fixture
    // regex matches a bare sport name, so judging the translation would drop a
    // corruption prosecution that merely names a football field.
    const verdict = checkIncidentQuality(
      row({
        topic: "indonesia_local",
        title: "Kejari Dompu gandeng inspektorat hitung kerugian korupsi lapangan sepak bola",
        displayTitle:
          "Dompu district prosecutor partners with inspectorate to calculate losses from football field corruption",
        summary: "",
      }),
      NOW,
    );
    expect(verdict.kind).not.toBe("exclude");
  });

  it("flags — never drops — a record whose rendered English alone reads as a fixture", () => {
    const verdict = checkIncidentQuality(
      row({
        topic: "indonesia_local",
        title: "Prediksi Persib vs Arema FC di Piala Presiden 2026",
        displayTitle: "Prediction: Persib vs Arema FC in the 2026 President's Cup",
        summary: "",
      }),
      NOW,
    );
    expect(verdict.kind).toBe("review");
    expect(verdict.checkName).toBe("sports_noise");
    // A review must not change the record's standing.
    expect(verdict.afterStatus).toBe(verdict.beforeStatus);
  });
});

describe("daily quality — conservative corrections", () => {
  it("never re-admits a record that is already excluded", () => {
    const verdict = checkIncidentQuality(row({ relevanceStatus: "irrelevant" }), NOW);
    expect(verdict.kind).toBe("keep");
    expect(verdict.afterStatus).toBe("irrelevant");
  });

  it("preserves a structured provider's own admission", () => {
    expect(hasProvenanceAdmission("gdelt_cloud:12345")).toBe(true);
    expect(hasProvenanceAdmission("tapa_offline:2026-01")).toBe(true);
    expect(hasProvenanceAdmission(null)).toBe(false);

    const verdict = checkIncidentQuality(
      row({
        title: "Harimau Malaya fall to Vietnam in Asean Cup semis, face tough return leg",
        analystNotes: "gdelt_cloud:12345",
      }),
      NOW,
    );
    // Even a fixture headline is left to the lane that admitted it, rather than
    // being re-scored by text rules that know nothing about that coding.
    expect(verdict.kind).toBe("keep");
  });

  it("flags an unattributed country for review rather than guessing one", () => {
    const verdict = checkIncidentQuality(row({ country: "Unknown" }), NOW);
    expect(verdict.kind).toBe("review");
    expect(verdict.checkName).toBe("geography");
    expect(verdict.afterStatus).toBe(verdict.beforeStatus);
  });

  it("flags an event dated after its own publication without inventing a date", () => {
    const verdict = checkIncidentQuality(
      row({ occurredAt: RECENT, incidentDate: new Date("2026-10-05T00:00:00.000Z") }),
      NOW,
    );
    expect(verdict.kind).toBe("review");
    expect(verdict.checkName).toBe("event_date");
  });

  it("accepts an event that occurred before it was reported", () => {
    const verdict = checkIncidentQuality(
      row({ occurredAt: RECENT, incidentDate: new Date("2026-09-10T00:00:00.000Z") }),
      NOW,
    );
    expect(verdict.kind).toBe("keep");
  });

  it("flags a future publication date", () => {
    const verdict = checkIncidentQuality(
      row({ occurredAt: new Date("2026-10-20T00:00:00.000Z") }),
      NOW,
    );
    expect(verdict.kind).toBe("review");
    expect(verdict.checkName).toBe("event_date");
  });
});

describe("daily quality — duplicate identity", () => {
  it("flags later records in a cluster and keeps the earliest as the event", () => {
    const findings = findDuplicateEventFindings([
      row({ id: 1, eventClusterKey: "riot-hanoi", occurredAt: new Date("2026-09-19T00:00:00.000Z") }),
      row({ id: 2, eventClusterKey: "riot-hanoi", occurredAt: new Date("2026-09-20T00:00:00.000Z") }),
      row({ id: 3, eventClusterKey: "riot-hanoi", occurredAt: new Date("2026-09-21T00:00:00.000Z") }),
    ]);
    expect(findings.map((f) => f.incidentId)).toEqual([2, 3]);
    expect(findings.every((f) => f.duplicateOf === 1)).toBe(true);
    // Corroborating sources are retained, not deleted.
    expect(findings[0]!.reason).toMatch(/corroborating source retained/i);
  });

  it("does not guess at duplicates for records with no cluster key", () => {
    expect(
      findDuplicateEventFindings([row({ id: 1 }), row({ id: 2 }), row({ id: 3, eventClusterKey: "" })]),
    ).toEqual([]);
  });
});

describe("daily quality — due-time arithmetic", () => {
  it("measures the next due time from the last SUCCESSFUL completion", () => {
    const success = new Date("2026-09-21T09:00:00.000Z");
    expect(nextDailyQualityDueAt(success).getTime()).toBe(success.getTime() + DAILY_QUALITY_INTERVAL_MS);
  });

  it("treats a database with no successful run as immediately due", () => {
    expect(isDailyQualityDue(null, NOW)).toBe(true);
  });

  it("is not due 23 hours after a success, and is due at 24", () => {
    const success = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);
    expect(isDailyQualityDue(success, NOW)).toBe(false);
    expect(isDailyQualityDue(new Date(NOW.getTime() - DAILY_QUALITY_INTERVAL_MS), NOW)).toBe(true);
  });
});

describe("Crime Watch parity with the monitor's candidate set", () => {
  const crime = DAILY_QUALITY_COVERAGE.find((e) => e.key === "crime")!;

  it("covers exactly what the Crime Watch monitor reads, judged under the crime rule", () => {
    // Topic.tsx merges topic `crime` with the apac_local feed and filters the
    // result through the crime relevance rule. The sweep must do the same.
    expect(crime.topics).toEqual(["crime", "apac_local"]);
    expect(crime.borrowedTopics).toEqual(["apac_local"]);
    expect(crime.policyTopic).toBe("crime");
    // Crime still has no collector of its own; that stays disclosed.
    expect(crime.collector).toBeNull();
  });

  it("flags a record stored AS crime that the crime rule rejects", () => {
    const verdict = checkIncidentQuality(
      row({
        topic: "crime",
        title: "Central bank holds interest rates steady for a third quarter",
        summary: "Policymakers voted to keep the benchmark rate unchanged.",
        country: "Indonesia",
      }),
      NOW,
      { policyTopic: crime.policyTopic },
    );
    expect(verdict.kind).toBe("exclude");
    expect(verdict.checkName).toBe("relevance");
  });

  it("never excludes a borrowed local-feed record merely for not being crime", () => {
    // The same row feeds the Indonesia/APAC briefs. Crime Watch simply does not
    // show it; excluding it here would strip it from the surfaces that own it.
    const verdict = checkIncidentQuality(
      row({
        topic: "apac_local",
        title: "Central bank holds interest rates steady for a third quarter",
        summary: "Policymakers voted to keep the benchmark rate unchanged.",
        country: "Indonesia",
      }),
      NOW,
      { policyTopic: crime.policyTopic, borrowed: true },
    );
    expect(verdict.kind).toBe("keep");
  });

  it("still excludes definite sports noise inside the borrowed candidate set", () => {
    const verdict = checkIncidentQuality(
      row({
        topic: "apac_local",
        title: "Australia win dead rubber as tournament group stage closes",
        summary: "",
      }),
      NOW,
      { policyTopic: crime.policyTopic, borrowed: true },
    );
    expect(verdict.kind).toBe("exclude");
    expect(verdict.checkName).toBe("sports_noise");
  });

  it("treats the local feeds as region-feed for country attribution", () => {
    // Crime Watch borrows apac_local; the feed's OWN entry must decide, or
    // every legitimately multi-country row becomes a geography finding.
    expect(countryAttributionForTopic("apac_local")).toBe("region-feed");
    expect(countryAttributionForTopic("indonesia_local")).toBe("region-feed");
  });
});
