import {
  routeOfficialSource,
  assignAnalystFlags,
  simulateOfficialSourceIngest,
} from "../../lib/ingest/src/m15";

// Snippets derived from __tests__/fixtures/m15/ content — no live URLs.

const CENTCOM_HOUTHI_STRIKE = {
  title:
    "CENTCOM Conducts Airstrikes Against Iran-Backed Houthi Missile Storage and Command/Control Facilities in Yemen",
  body: `CENTCOM forces conducted precision airstrikes against Houthi facilities in Sana'a, Yemen.
During the operation, CENTCOM forces also shot down multiple one-way attack UAVs and an anti-ship cruise missile (ASCM) over the Red Sea.
Merchant vessels in the Southern Red Sea, Bab al-Mandeb, and Gulf of Aden were at risk.`,
};

const CENTCOM_LAND_ONLY = {
  title: "CENTCOM Statement on Force Posture in Afghanistan",
  body: "U.S. Central Command reviewed training and advisory support to partner forces in Afghanistan. No naval activity was reported.",
};

const UKMTO_ROUTINE_ADVISORY = {
  title: "003-26 Update 002 - ADVISORY",
  body: `UKMTO is aware of elevated maritime security activity across the Arabian Gulf and Gulf of Oman.
Mariners should note potential AIS and GNSS electronic interference.`,
};

const UKMTO_ATTACK = {
  title: "038-26 - ATTACK",
  body: `UKMTO has received a report of an incident 25NM northeast of Oman.
A Container Ship was hit by an unknown projectile which caused damage to some containers.`,
};

const UKMTO_ESCALATION_ADVISORY = {
  title: "003-26 Update 002 - ADVISORY",
  body: `The maritime security environment across the Arabian Gulf and Strait of Hormuz remains highly volatile.
There is significant Iranian military activity and Houthi-linked escalation risk to commercial shipping.`,
};

const PARTNER_ESCALATION = {
  title: "JMIC Escalation Advisory — Arabian Gulf",
  body: "JMIC reports elevated threat to commercial shipping amid regional military activity and kinetic incidents near the Strait of Hormuz.",
};

const PARTNER_THREAT_LEVEL = {
  title: "CMF Threat Assessment Update",
  body: "Combined Maritime Forces issued a threat level update and JMIC guidance to mariners on VHF Channel 16 procedures.",
};

describe("M1.5 routeOfficialSource", () => {
  it("routes a plain CENTCOM military release to Conflict Watch only", () => {
    expect(
      routeOfficialSource({ source: "centcom", ...CENTCOM_LAND_ONLY }),
    ).toEqual({
      primaryWatch: "conflict",
      watchTags: ["conflict"],
    });
  });

  it("routes CENTCOM + maritime terms to Conflict and Shipping watches", () => {
    expect(
      routeOfficialSource({ source: "centcom", ...CENTCOM_HOUTHI_STRIKE }),
    ).toEqual({
      primaryWatch: "conflict",
      watchTags: ["conflict", "shipping"],
    });
  });

  it("routes a UKMTO advisory to Shipping Watch only", () => {
    expect(
      routeOfficialSource({ source: "ukmto", ...UKMTO_ROUTINE_ADVISORY }),
    ).toEqual({
      primaryWatch: "shipping",
      watchTags: ["shipping"],
    });
  });

  it("routes UKMTO + escalation terms to Shipping and Conflict watches", () => {
    expect(
      routeOfficialSource({ source: "ukmto", ...UKMTO_ESCALATION_ADVISORY }),
    ).toEqual({
      primaryWatch: "shipping",
      watchTags: ["shipping", "conflict"],
    });
  });

  it("routes partner escalation advisories to both watches (shipping primary)", () => {
    expect(
      routeOfficialSource({ source: "partner", ...PARTNER_ESCALATION }),
    ).toEqual({
      primaryWatch: "shipping",
      watchTags: ["shipping", "conflict"],
    });
  });

  it("routes partner threat-level updates to Shipping context only", () => {
    expect(
      routeOfficialSource({ source: "partner", ...PARTNER_THREAT_LEVEL }),
    ).toEqual({
      primaryWatch: "shipping",
      watchTags: ["shipping"],
    });
  });
});

describe("M1.5 assignAnalystFlags", () => {
  it("flags CENTCOM operational releases as significant incidents", () => {
    const flags = assignAnalystFlags({
      source: "centcom",
      ...CENTCOM_HOUTHI_STRIKE,
      hasOfficialUrl: true,
      hasPdf: false,
    });
    expect(flags.flagSignificantIncident).toBe(true);
    expect(flags.flagEscalationIndicator).toBe(true);
    expect(flags.flagMaritimeDisruption).toBe(true);
    expect(flags.flagEvidenceAvailable).toBe(true);
  });

  it("flags UKMTO vessel attacks as significant incidents", () => {
    const flags = assignAnalystFlags({
      source: "ukmto",
      ...UKMTO_ATTACK,
      hasOfficialUrl: true,
      hasPdf: true,
    });
    expect(flags.flagSignificantIncident).toBe(true);
    expect(flags.flagEvidenceAvailable).toBe(true);
    expect(flags.flagMaritimeDisruption).toBe(true);
  });

  it("sets Possible Spot Report only for high-confidence official significant + escalation", () => {
    const hot = assignAnalystFlags({
      source: "centcom",
      ...CENTCOM_HOUTHI_STRIKE,
      hasOfficialUrl: true,
      hasPdf: false,
    });
    expect(hot.flagPossibleSpotReport).toBe(true);

    const cold = assignAnalystFlags({
      source: "centcom",
      ...CENTCOM_LAND_ONLY,
      hasOfficialUrl: false,
      hasPdf: false,
    });
    expect(cold.flagPossibleSpotReport).toBe(false);
  });

  it("never sets evidence available without a URL or PDF", () => {
    const flags = assignAnalystFlags({
      source: "ukmto",
      ...UKMTO_ATTACK,
      hasOfficialUrl: false,
      hasPdf: false,
    });
    expect(flags.flagEvidenceAvailable).toBe(false);
    expect(flags.flagPossibleSpotReport).toBe(false);
  });
});

describe("M1.5 fixture ingest simulation (routing + flags composed)", () => {
  it("simulates the Hormuz CENTCOM + UKMTO escalation fixture pair", () => {
    const centcom = simulateOfficialSourceIngest({
      source: "centcom",
      ...CENTCOM_HOUTHI_STRIKE,
      hasOfficialUrl: true,
      hasPdf: false,
    });
    expect(centcom.primaryWatch).toBe("conflict");
    expect(centcom.watchTags).toEqual(["conflict", "shipping"]);
    expect(centcom.flagPossibleSpotReport).toBe(true);

    const ukmto = simulateOfficialSourceIngest({
      source: "ukmto",
      ...UKMTO_ESCALATION_ADVISORY,
      hasOfficialUrl: true,
      hasPdf: true,
    });
    expect(ukmto.primaryWatch).toBe("shipping");
    expect(ukmto.watchTags).toEqual(["shipping", "conflict"]);
    expect(ukmto.flagEscalationIndicator).toBe(true);
    expect(ukmto.flagMaritimeDisruption).toBe(true);
  });
});
