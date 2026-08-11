import {
  buildFuelGulfChokepointWatch,
  buildFuelOperationalRead,
} from "@/lib/fuelNarratives";
import { deriveFlagState } from "@/lib/shippingCountry";
import { joinWithAnd } from "@/lib/proseLists";
import type { TopicFastFactsIncident } from "@/lib/topicFastFacts";

// Regression suite for the three consistency error classes reported against
// Fuel Watch v8 (Aug 2026):
//   Class 1 — stated counts/windows must describe the SAME set the rendered
//             bullets are drawn from ("14 incidents across seven days" above
//             six bullets spanning three days is a self-contradiction).
//   Class 2 — vessel flags derive from the VESSEL named in the prose, never
//             from an attacker's origin stamped in the raw country field
//             ("Houthis attacked Saudi oil tanker" + country=Yemen must be
//             Saudi-flagged, never Yemen-flagged).
//   Class 3 — country/name lists embedded in sentences take "and" before the
//             final item ("Iraq and Saudi Arabia carry", never
//             "Iraq, Saudi Arabia carry").

const ISSUE_DATE = "2026-07-15"; // weekly fuel window: 2026-07-09 .. 2026-07-15

function mk(
  id: number,
  title: string,
  occurredAt: string,
  severity: string,
  country?: string,
): TopicFastFactsIncident {
  return {
    id,
    topic: "fuel",
    title,
    severity,
    country,
    occurredAt: `${occurredAt}T12:00:00+00:00`,
    sourceUrl: `https://example.test/${id}`,
  };
}

describe("Class 1 — chokepoint watch counts match the rendered list", () => {
  it("states the truncation explicitly when more incidents are counted than listed", () => {
    const incidents = [
      mk(1, "Strait of Hormuz closure halts tanker traffic", "2026-07-09", "high"),
      mk(2, "Drone strike hits Persian Gulf oil terminal", "2026-07-10", "high"),
      mk(3, "Hormuz transit advisory issued to LNG operators", "2026-07-10", "moderate"),
      mk(4, "Naval escort convoy formed in Strait of Hormuz", "2026-07-11", "moderate"),
      mk(5, "Persian Gulf bunker premiums spike after strike", "2026-07-12", "moderate"),
      mk(6, "Mine found near Hormuz shipping lane", "2026-07-13", "high"),
      mk(7, "Hormuz insurance rates double for crude cargoes", "2026-07-14", "moderate"),
      mk(8, "Strait of Hormuz partially cleared for transit", "2026-07-15", "low"),
    ];
    const built = buildFuelGulfChokepointWatch({
      issueDate: ISSUE_DATE,
      incidents,
      maxItems: 4,
    });
    expect(built).not.toBeNull();
    const shown = built!.currentItems.length;
    expect(shown).toBe(4); // capped below the counted set

    // The prose must state the full count AND say only a subset is listed.
    const m = built!.read.match(
      /(\d+) distinct chokepoint incidents were logged across (\d+) separate days? in the window; the (\d+) most significant are listed below\./,
    );
    expect(m).not.toBeNull();
    const [, total, days, listed] = m!.map(Number) as unknown as number[];
    expect(Number(m![1])).toBeGreaterThan(shown);
    expect(Number(m![3])).toBe(shown);
    // Days claim describes the counted (deduped) set, never a wider pool.
    expect(Number(m![2])).toBeLessThanOrEqual(7);
    void total; void days; void listed;
  });

  it("makes no subset claim when everything counted is listed", () => {
    const incidents = [
      mk(1, "Strait of Hormuz closure halts tanker traffic", "2026-07-10", "high"),
      mk(2, "Drone strike hits Persian Gulf oil terminal", "2026-07-12", "moderate"),
      mk(3, "Mine found near Hormuz shipping lane", "2026-07-13", "high"),
    ];
    const built = buildFuelGulfChokepointWatch({ issueDate: ISSUE_DATE, incidents });
    expect(built).not.toBeNull();
    expect(built!.currentItems.length).toBe(3);
    expect(built!.read).toMatch(
      /3 distinct chokepoint incidents were logged across 3 separate days in the window\./,
    );
    expect(built!.read).not.toMatch(/most significant are listed below/);
  });
});

describe("Class 2 — flags derive from the vessel, never the attacker", () => {
  it("Houthi attack on a Saudi tanker with country=Yemen is Saudi-flagged", () => {
    expect(
      deriveFlagState({
        title: "Houthis say they attacked Saudi oil tanker in Red Sea",
        country: "Yemen",
      }),
    ).toBe("Saudi Arabia");
  });

  it("attacker-origin country field with no vessel flag in prose yields no flag at all", () => {
    expect(
      deriveFlagState({
        title: "Houthis claim strike on commercial shipping in Red Sea",
        country: "Yemen",
      }),
    ).toBeNull();
  });

  it("prose flag descriptor outranks a mismatched raw field", () => {
    expect(
      deriveFlagState({
        title: "Six Saudi-flagged oil carriers reroute around Hormuz",
        country: "Yemen",
      }),
    ).toBe("Saudi Arabia");
  });

  it("genuine flag-state raw field with no prose mention still surfaces (unchanged behaviour)", () => {
    expect(
      deriveFlagState({
        title: "Vessel seized near Fujairah anchorage",
        country: "Panama",
      }),
    ).toBe("Panama");
  });

});

describe("Class 3 — sentence lists join with 'and'", () => {
  it("joinWithAnd handles 0/1/2/3 items", () => {
    expect(joinWithAnd([])).toBe("");
    expect(joinWithAnd(["Iraq"])).toBe("Iraq");
    expect(joinWithAnd(["Iraq", "Saudi Arabia"])).toBe("Iraq and Saudi Arabia");
    expect(joinWithAnd(["Iraq", "Iran", "Saudi Arabia"])).toBe(
      "Iraq, Iran and Saudi Arabia",
    );
  });

  it("operational read closing line reads 'X and Y carry', never 'X, Y carry'", () => {
    const read = buildFuelOperationalRead({
      issueDate: ISSUE_DATE,
      incidents: [
        mk(1, "Fuel shortage hits Baghdad depots", "2026-07-10", "moderate"),
        mk(2, "Fuel shortage worsens across Basra forecourts", "2026-07-11", "moderate"),
        mk(3, "Fuel shortage reported across Jeddah", "2026-07-12", "moderate"),
        mk(4, "Fuel shortage queues grow in Riyadh", "2026-07-13", "moderate"),
      ],
    });
    expect(read).not.toBeNull();
    expect(read!).toMatch(
      /\b(?:Iraq and Saudi Arabia|Saudi Arabia and Iraq) carry the most activity this week\./,
    );
    expect(read!).not.toMatch(/Iraq, Saudi Arabia carr|Saudi Arabia, Iraq carr/);
  });
});
