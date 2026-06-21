import type { MaritimeMovement } from "@workspace/api-client-react";

import {
  RED_SEA_GATEWAYS,
  buildGatewayFlow,
  buildRedSeaDirectionalFlow,
  sharedFlowMax,
  hasAnyFlow,
  gatewayEmptyState,
} from "../../artifacts/workbench/src/lib/maritimeDirectionalFlow";

// ---------------------------------------------------------------------------
// Unit contract for the Red Sea directional-flow model. The Shipping monitor,
// the report preview and the headless PDF all build their bars from these pure
// helpers, so the honesty rules (no fabricated zeros, drop unobserved samples,
// ascending order, shared scale) are pinned here once.
// ---------------------------------------------------------------------------

function row(partial: Partial<MaritimeMovement>): MaritimeMovement {
  return {
    theatre: "Bab el-Mandeb",
    inboundCount: null,
    outboundCount: null,
    dataAsOf: "2026-06-20T00:00:00+00:00",
    createdAt: "2026-06-20T00:00:00+00:00",
    ...partial,
  } as MaritimeMovement;
}

describe("buildGatewayFlow", () => {
  it("keeps only samples with BOTH counts observed (never a fabricated zero)", () => {
    const rows = [
      row({ inboundCount: 4, outboundCount: 6, dataAsOf: "2026-06-19T06:00:00+00:00" }),
      row({ inboundCount: null, outboundCount: 3, dataAsOf: "2026-06-19T12:00:00+00:00" }),
      row({ inboundCount: 2, outboundCount: null, dataAsOf: "2026-06-19T18:00:00+00:00" }),
    ];
    const series = buildGatewayFlow(rows, "Bab el-Mandeb", "South gate");
    expect(series.points).toHaveLength(1);
    expect(series.points[0]).toMatchObject({ inbound: 4, outbound: 6 });
    expect(series.hasData).toBe(true);
  });

  it("ignores rows for other theatres", () => {
    const rows = [
      row({ theatre: "Suez Canal", inboundCount: 5, outboundCount: 5 }),
      row({ theatre: "Bab el-Mandeb", inboundCount: 1, outboundCount: 2 }),
    ];
    const series = buildGatewayFlow(rows, "Bab el-Mandeb", "South gate");
    expect(series.points).toHaveLength(1);
    expect(series.totalInbound).toBe(1);
    expect(series.totalOutbound).toBe(2);
  });

  it("sorts samples ascending by time and sums totals", () => {
    const rows = [
      row({ inboundCount: 3, outboundCount: 1, dataAsOf: "2026-06-20T00:00:00+00:00" }),
      row({ inboundCount: 2, outboundCount: 4, dataAsOf: "2026-06-18T00:00:00+00:00" }),
    ];
    const series = buildGatewayFlow(rows, "Bab el-Mandeb", "South gate");
    expect(series.points.map((p) => p.iso)).toEqual([
      "2026-06-18T00:00:00+00:00",
      "2026-06-20T00:00:00+00:00",
    ]);
    expect(series.totalInbound).toBe(5);
    expect(series.totalOutbound).toBe(5);
    expect(series.latestSampleTotal).toBe(4); // last sample: 3 + 1
  });

  it("upgrades labels to date+time only when two samples share a calendar day", () => {
    const sameDay = buildGatewayFlow(
      [
        row({ inboundCount: 1, outboundCount: 1, dataAsOf: "2026-06-20T06:00:00+00:00" }),
        row({ inboundCount: 1, outboundCount: 1, dataAsOf: "2026-06-20T18:00:00+00:00" }),
      ],
      "Bab el-Mandeb",
      "South gate",
    );
    expect(sameDay.points.every((p) => /\d{2}:\d{2}/.test(p.label))).toBe(true);

    const distinctDays = buildGatewayFlow(
      [
        row({ inboundCount: 1, outboundCount: 1, dataAsOf: "2026-06-19T06:00:00+00:00" }),
        row({ inboundCount: 1, outboundCount: 1, dataAsOf: "2026-06-20T18:00:00+00:00" }),
      ],
      "Bab el-Mandeb",
      "South gate",
    );
    expect(distinctDays.points.every((p) => /\d{2}:\d{2}/.test(p.label))).toBe(false);
  });

  it("returns an empty, honest series when no directional sample exists", () => {
    const series = buildGatewayFlow([], "Suez Canal", "North gate");
    expect(series.hasData).toBe(false);
    expect(series.points).toHaveLength(0);
    expect(series.latestSampleTotal).toBeNull();
    expect(gatewayEmptyState(series.gate)).toContain("north gate");
  });
});

describe("buildRedSeaDirectionalFlow", () => {
  it("builds both gateways in geographic order (south gate first)", () => {
    const series = buildRedSeaDirectionalFlow([]);
    expect(series.map((s) => s.theatre)).toEqual([
      RED_SEA_GATEWAYS[0].theatre,
      RED_SEA_GATEWAYS[1].theatre,
    ]);
    expect(series[0].theatre).toBe("Bab el-Mandeb");
    expect(series[1].theatre).toBe("Suez Canal");
  });
});

describe("sharedFlowMax / hasAnyFlow", () => {
  it("shares the y-axis maximum across gateways and never drops below 1", () => {
    const series = buildRedSeaDirectionalFlow([
      row({ theatre: "Bab el-Mandeb", inboundCount: 4, outboundCount: 9 }),
      row({ theatre: "Suez Canal", inboundCount: 2, outboundCount: 1 }),
    ]);
    expect(sharedFlowMax(series)).toBe(9);
    expect(sharedFlowMax(buildRedSeaDirectionalFlow([]))).toBe(1);
  });

  it("reports whether any gateway has drawable data", () => {
    expect(hasAnyFlow(buildRedSeaDirectionalFlow([]))).toBe(false);
    expect(
      hasAnyFlow(
        buildRedSeaDirectionalFlow([
          row({ theatre: "Suez Canal", inboundCount: 1, outboundCount: 1 }),
        ]),
      ),
    ).toBe(true);
  });
});
