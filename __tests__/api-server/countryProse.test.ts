import {
  computeProseFingerprint,
  MAX_PROSE_INCIDENTS,
  type ProseIncidentInput,
} from "../../artifacts/api-server/src/lib/countryProse";

// Guards the country-report prose cache contract. The fingerprint is the cache
// KEY: it must be STABLE for the same grounded data (so identical data never
// pays for a regeneration), yet FLIP the moment any fact the prompt renders
// changes (so cached prose can never describe data the incident no longer
// holds). This pins the regression that caused a regeneration loop — two
// fingerprints racing into the cache from the same logical window — and the
// canonical/capped invariants that keep the cache key and the prompt input in
// lockstep.

const BASE = {
  slug: "indonesia",
  countryName: "Indonesia",
  basisDays: 90,
};

function inc(over: Partial<ProseIncidentInput> & { id: string }): ProseIncidentInput {
  return {
    topic: "flashpoint",
    title: "Protest in Jakarta",
    summary: "Demonstrators gathered in the capital.",
    location: "Jakarta",
    country: "Indonesia",
    severity: "Moderate",
    occurredAt: "2026-06-10T08:00:00+00:00",
    source: "Reuters",
    ...over,
  };
}

const SAMPLE: ProseIncidentInput[] = [
  inc({ id: "a", occurredAt: "2026-06-12T00:00:00+00:00", title: "Clash in Papua" }),
  inc({ id: "b", occurredAt: "2026-06-10T00:00:00+00:00", title: "Protest in Jakarta" }),
  inc({ id: "c", occurredAt: "2026-06-08T00:00:00+00:00", title: "Strike in Surabaya" }),
];

const fp = (incidents: ProseIncidentInput[], over: Partial<typeof BASE> = {}) =>
  computeProseFingerprint({ ...BASE, ...over, incidents });

describe("computeProseFingerprint — stability", () => {
  it("is deterministic for the same input", () => {
    expect(fp(SAMPLE)).toBe(fp(SAMPLE));
  });

  it("is unchanged when the incidents are reordered", () => {
    const reversed = [...SAMPLE].reverse();
    const shuffled = [SAMPLE[1], SAMPLE[2], SAMPLE[0]];
    expect(fp(reversed)).toBe(fp(SAMPLE));
    expect(fp(shuffled)).toBe(fp(SAMPLE));
  });

  it("is stable for syndicated duplicates sharing title and date (id tiebreak)", () => {
    const dupes: ProseIncidentInput[] = [
      inc({ id: "z", occurredAt: "2026-06-11T00:00:00+00:00", title: "Same headline" }),
      inc({ id: "y", occurredAt: "2026-06-11T00:00:00+00:00", title: "Same headline" }),
      inc({ id: "x", occurredAt: "2026-06-11T00:00:00+00:00", title: "Same headline" }),
    ];
    expect(fp([...dupes].reverse())).toBe(fp(dupes));
  });

  it("ignores whitespace and case differences in rendered fields", () => {
    const noisy = SAMPLE.map((i) =>
      inc({
        ...i,
        id: i.id!,
        title: `  ${(i.title ?? "").toUpperCase()}  `,
        summary: `  ${i.summary}\t\n `,
        source: ` ${(i.source ?? "").toLowerCase()} `,
      }),
    );
    expect(fp(noisy)).toBe(fp(SAMPLE));
  });

  it("treats a missing date as a stable empty value", () => {
    const a = [inc({ id: "1", occurredAt: null })];
    const b = [inc({ id: "1", occurredAt: undefined })];
    expect(fp(a)).toBe(fp(b));
  });

  it("hashes only the day component of occurredAt", () => {
    const morning = [inc({ id: "1", occurredAt: "2026-06-10T01:00:00+00:00" })];
    const evening = [inc({ id: "1", occurredAt: "2026-06-10T23:30:00+00:00" })];
    expect(fp(morning)).toBe(fp(evening));
  });
});

describe("computeProseFingerprint — sensitivity to prompt-rendered fields", () => {
  const fields: Array<[string, Partial<ProseIncidentInput>]> = [
    ["title", { title: "A different headline" }],
    ["summary", { summary: "A correction to the body text." }],
    ["source", { source: "AFP" }],
    ["country", { country: "Malaysia" }],
    ["topic", { topic: "conflict" }],
    ["severity", { severity: "High" }],
    ["location", { location: "Bandung" }],
    ["occurredAt (day)", { occurredAt: "2026-06-09T08:00:00+00:00" }],
    ["id", { id: "different-id" }],
  ];

  for (const [name, change] of fields) {
    it(`changes when ${name} changes`, () => {
      const before = [inc({ id: "a" })];
      const after = [inc({ id: "a", ...change })];
      expect(fp(after)).not.toBe(fp(before));
    });
  }

  it("changes when an incident is added or removed", () => {
    expect(fp(SAMPLE.slice(0, 2))).not.toBe(fp(SAMPLE));
  });
});

describe("computeProseFingerprint — key dimensions outside the incidents", () => {
  it("changes with slug", () => {
    expect(fp(SAMPLE, { slug: "malaysia" })).not.toBe(fp(SAMPLE));
  });

  it("changes with countryName", () => {
    expect(fp(SAMPLE, { countryName: "Malaysia" })).not.toBe(fp(SAMPLE));
  });

  it("changes with basisDays", () => {
    expect(fp(SAMPLE, { basisDays: 30 })).not.toBe(fp(SAMPLE));
  });

  it("changes with variant", () => {
    const country = computeProseFingerprint({ ...BASE, incidents: SAMPLE, variant: "country" });
    const png = computeProseFingerprint({ ...BASE, incidents: SAMPLE, variant: "png" });
    expect(country).not.toBe(png);
  });

  it("defaults an unset variant to 'country'", () => {
    const unset = computeProseFingerprint({ ...BASE, incidents: SAMPLE });
    const explicit = computeProseFingerprint({ ...BASE, incidents: SAMPLE, variant: "country" });
    expect(unset).toBe(explicit);
  });
});

describe("computeProseFingerprint — capping", () => {
  // Build a fixed window of exactly MAX_PROSE_INCIDENTS recent incidents, with a
  // distinct (older) date per index so the canonical sort is deterministic.
  const capped: ProseIncidentInput[] = Array.from({ length: MAX_PROSE_INCIDENTS }, (_, i) => {
    const day = String(28 - (i % 28)).padStart(2, "0");
    return inc({ id: `cap-${i}`, occurredAt: `2026-06-${day}T00:00:00+00:00`, title: `Event ${i}` });
  });

  it("ignores incidents beyond the cap (older rows fall outside the top set)", () => {
    const older: ProseIncidentInput[] = Array.from({ length: 20 }, (_, i) =>
      inc({ id: `extra-${i}`, occurredAt: "2020-01-01T00:00:00+00:00", title: `Old ${i}` }),
    );
    expect(fp([...capped, ...older])).toBe(fp(capped));
  });

  it("still reacts to a change WITHIN the capped set", () => {
    const mutated = capped.map((i, idx) =>
      idx === 0 ? inc({ ...i, id: i.id!, severity: "Extreme" }) : i,
    );
    expect(fp(mutated)).not.toBe(fp(capped));
  });
});
