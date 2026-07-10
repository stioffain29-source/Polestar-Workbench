import {
  simulateOfficialSourceIngest,
  type AssignAnalystFlagsInput,
  type AnalystFlags,
} from "../../lib/ingest/src/m15";
import { OFFICIAL_M15_HEALTH_TOPIC } from "../../lib/ingest/src/m15/health";
import { scanIngestForSpotReportWrites } from "./spotReportGuardLib";

// Snippets from __tests__/fixtures/m15/ — exercises routing + flags without live fetch.

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

type MatrixRow = {
  label: string;
  input: AssignAnalystFlagsInput;
  primaryWatch: "conflict" | "shipping";
  watchTags: ("conflict" | "shipping")[];
  flags?: Partial<AnalystFlags>;
};

/** Product routing matrix (M1.5 § Product routing matrix) — pinned for M1.5-T1. */
const ROUTING_MATRIX: MatrixRow[] = [
  {
    label: "CENTCOM military release → Conflict Watch",
    input: { source: "centcom", ...CENTCOM_LAND_ONLY, hasOfficialUrl: true, hasPdf: false },
    primaryWatch: "conflict",
    watchTags: ["conflict"],
  },
  {
    label: "CENTCOM + maritime terms → Conflict + Shipping",
    input: { source: "centcom", ...CENTCOM_HOUTHI_STRIKE, hasOfficialUrl: true, hasPdf: false },
    primaryWatch: "conflict",
    watchTags: ["conflict", "shipping"],
    flags: {
      flagSignificantIncident: true,
      flagEscalationIndicator: true,
      flagMaritimeDisruption: true,
      flagEvidenceAvailable: true,
      flagPossibleSpotReport: true,
    },
  },
  {
    label: "UKMTO warning/advisory → Shipping Watch",
    input: { source: "ukmto", ...UKMTO_ROUTINE_ADVISORY, hasOfficialUrl: true, hasPdf: false },
    primaryWatch: "shipping",
    watchTags: ["shipping"],
  },
  {
    label: "UKMTO + escalation terms → Shipping + Conflict",
    input: { source: "ukmto", ...UKMTO_ESCALATION_ADVISORY, hasOfficialUrl: true, hasPdf: true },
    primaryWatch: "shipping",
    watchTags: ["shipping", "conflict"],
    flags: {
      flagEscalationIndicator: true,
      flagMaritimeDisruption: true,
      flagEvidenceAvailable: true,
    },
  },
  {
    label: "Partner threat-level update → Shipping context",
    input: { source: "partner", ...PARTNER_THREAT_LEVEL, hasOfficialUrl: true, hasPdf: true },
    primaryWatch: "shipping",
    watchTags: ["shipping"],
  },
  {
    label: "JMIC/CMF escalation advisory → Shipping + Conflict context",
    input: { source: "partner", ...PARTNER_ESCALATION, hasOfficialUrl: true, hasPdf: false },
    primaryWatch: "shipping",
    watchTags: ["shipping", "conflict"],
    flags: {
      flagEscalationIndicator: true,
      flagMaritimeDisruption: true,
      flagEvidenceAvailable: true,
    },
  },
];

type OfficialM15FixtureRow = {
  sourceName: string;
  externalId: string;
  title: string;
  bodyText: string;
  sourceUrl: string;
  classification: "official_military_maritime";
  primaryWatch: string;
  watchTags: string[];
  flagSignificantIncident: boolean;
  flagEscalationIndicator: boolean;
  flagMaritimeDisruption: boolean;
  flagEvidenceAvailable: boolean;
  flagPossibleSpotReport: boolean;
};

/** Compose routing + flags into the shape persisted on official_military_maritime_sources. */
function buildOfficialM15FixtureRow(
  input: AssignAnalystFlagsInput & { externalId: string; sourceUrl: string },
): OfficialM15FixtureRow {
  const routed = simulateOfficialSourceIngest(input);
  return {
    sourceName: input.source,
    externalId: input.externalId,
    title: input.title,
    bodyText: input.body,
    sourceUrl: input.sourceUrl,
    classification: "official_military_maritime",
    primaryWatch: routed.primaryWatch,
    watchTags: routed.watchTags,
    flagSignificantIncident: routed.flagSignificantIncident,
    flagEscalationIndicator: routed.flagEscalationIndicator,
    flagMaritimeDisruption: routed.flagMaritimeDisruption,
    flagEvidenceAvailable: routed.flagEvidenceAvailable,
    flagPossibleSpotReport: routed.flagPossibleSpotReport,
  };
}

const ANALYST_FLAG_KEYS = [
  "flagSignificantIncident",
  "flagEscalationIndicator",
  "flagMaritimeDisruption",
  "flagEvidenceAvailable",
  "flagPossibleSpotReport",
] as const;

describe("M1.5-T1 Phase 1 foundation acceptance", () => {
  it("routes CENTCOM + UKMTO fixture text per the product routing matrix", () => {
    for (const row of ROUTING_MATRIX) {
      const result = simulateOfficialSourceIngest(row.input);
      expect(result.primaryWatch).toBe(row.primaryWatch);
      expect(result.watchTags).toEqual(row.watchTags);
      if (row.flags) {
        expect(result).toMatchObject(row.flags);
      }
    }
  });

  it("flags UKMTO vessel attacks as significant incidents with evidence", () => {
    const result = simulateOfficialSourceIngest({
      source: "ukmto",
      ...UKMTO_ATTACK,
      hasOfficialUrl: true,
      hasPdf: true,
    });
    expect(result.primaryWatch).toBe("shipping");
    expect(result.watchTags).toEqual(["shipping"]);
    expect(result.flagSignificantIncident).toBe(true);
    expect(result.flagMaritimeDisruption).toBe(true);
    expect(result.flagEvidenceAvailable).toBe(true);
    expect(result.flagPossibleSpotReport).toBe(false);
  });

  it("persists all five analyst flags on composed fixture rows (P1-D2)", () => {
    const centcomRow = buildOfficialM15FixtureRow({
      source: "centcom",
      ...CENTCOM_HOUTHI_STRIKE,
      hasOfficialUrl: true,
      hasPdf: false,
      externalId: "4015365",
      sourceUrl: "https://www.centcom.mil/MEDIA/PRESS-RELEASES/Press-Release-View/Article/4015365/",
    });
    const ukmtoRow = buildOfficialM15FixtureRow({
      source: "ukmto",
      ...UKMTO_ESCALATION_ADVISORY,
      hasOfficialUrl: true,
      hasPdf: true,
      externalId: "003-26-update-002",
      sourceUrl: "https://www.ukmto.org/",
    });

    for (const row of [centcomRow, ukmtoRow]) {
      for (const key of ANALYST_FLAG_KEYS) {
        expect(typeof row[key]).toBe("boolean");
      }
      expect(row.classification).toBe("official_military_maritime");
      expect(row.watchTags.length).toBeGreaterThan(0);
    }

    expect(centcomRow.primaryWatch).toBe("conflict");
    expect(centcomRow.watchTags).toEqual(["conflict", "shipping"]);
    expect(centcomRow.flagPossibleSpotReport).toBe(true);

    expect(ukmtoRow.primaryWatch).toBe("shipping");
    expect(ukmtoRow.watchTags).toEqual(["shipping", "conflict"]);
    expect(ukmtoRow.flagEscalationIndicator).toBe(true);
  });

  it("registers the Primary Military and Maritime Sources health topic (P1-D1)", () => {
    expect(OFFICIAL_M15_HEALTH_TOPIC).toBe("official_military_maritime");
  });

  it("Spot Report guard still passes — ingest never writes spot_reports (P1-D5)", () => {
    expect(scanIngestForSpotReportWrites()).toEqual([]);
  });
});
