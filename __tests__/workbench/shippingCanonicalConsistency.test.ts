import {
  buildShippingReportDataset,
  type ShippingReportIncident,
} from "../../artifacts/workbench/src/lib/shippingReportDataset";
import {
  assertShippingReportConsistency,
  buildMaritimeIntelligence,
} from "../../artifacts/workbench/src/lib/maritimeIntelligence";
import { resolveReportWindow } from "../../artifacts/workbench/src/lib/reportWindow";
import { isConfirmedOperationalIncident } from "../../artifacts/workbench/src/lib/shippingAnalysis";

const issueDate = "2026-06-18";
const incidents: ShippingReportIncident[] = [
  {
    id: 1,
    topic: "shipping",
    title: "Missile struck tanker in Strait of Hormuz",
    severity: "extreme",
    occurredAt: "2026-06-16T08:00:00.000Z",
    country: "Iran",
  },
  // Syndicated copy: final report must fold this rather than count it again.
  {
    id: 2,
    topic: "shipping",
    title: "Missile struck tanker in Strait of Hormuz - Reuters",
    severity: "high",
    occurredAt: "2026-06-16T09:00:00.000Z",
    country: "Iran",
  },
  {
    id: 3,
    topic: "shipping",
    title: "Port closed after collision in Singapore Strait",
    severity: "moderate",
    occurredAt: "2026-06-15T08:00:00.000Z",
    country: "Singapore",
  },
];

function build() {
  const ds = buildShippingReportDataset(incidents, "shipping", issueDate);
  const win = resolveReportWindow("shipping", issueDate);
  const board = buildMaritimeIntelligence({
    incidents: ds.canonicalIncidents,
    movement: [],
    windowStart: win.start,
    windowEnd: win.end,
    inputMode: "prevalidated",
  });
  return { ds, board };
}

describe("Shipping Watch canonical incident invariant", () => {
  it.each([
    "Pirate attacks on ships in the Gulf of Aden are on the rise",
    "Amsterdam tourism shake-up: cruise port closure under review — what global travellers should expect",
    "US gas prices continue sinking as oil tankers transit the Strait of Hormuz",
    "Oil prices are sinking as Iran reveals a draft peace deal to reopen the Strait of Hormuz",
  ])("does not promote a non-incident article into the final set: %s", (title) => {
    expect(isConfirmedOperationalIncident({ title, summary: title })).toBe(false);
  });

  it.each([
    "UK maritime agency reports armed attack on tanker off Yemen",
    "UKMTO: tanker hit by unknown projectile off Oman coast",
    "Port closed after collision in Singapore Strait",
  ])("keeps a discrete operational event: %s", (title) => {
    expect(isConfirmedOperationalIncident({ title, summary: title })).toBe(true);
  });

  it("drives the board and every report derivation from the final folded set", () => {
    const { ds, board } = build();
    expect(ds.canonicalIncidents).toHaveLength(2);
    expect(Number(ds.fastFacts.find((f) => f.label === "Confirmed Incidents")?.value)).toBe(2);
    expect(board.incidentSnapshot.total).toBe(2);
    expect(board.confirmedIncidents.map((i) => String(i.id)).sort())
      .toEqual(ds.canonicalIncidents.map((i) => String(i.id)).sort());
    const ids = new Set(ds.canonicalIncidents.map((i) => String(i.id)));
    for (const row of [...ds.vesselRows, ...ds.piracyRows, ...ds.commercialRows, ...ds.relatedIncidents]) {
      expect(ids.has(String(row.id))).toBe(true);
    }
    expect(() => assertShippingReportConsistency(ds, board)).not.toThrow();
  });

  it("fails closed if a rendered headline or maritime risk is mutated", () => {
    const { ds, board } = build();
    const badDataset = {
      ...ds,
      fastFacts: ds.fastFacts.map((f) =>
        f.label === "Confirmed Incidents" ? { ...f, value: "99" } : f),
    };
    expect(() => assertShippingReportConsistency(badDataset, board))
      .toThrow(/Confirmed Incidents headline/);
    expect(() => assertShippingReportConsistency(ds, {
      ...board,
      risk: { ...board.risk, level: 1, label: "Insignificant" },
    })).toThrow(/overall maritime risk/);
    const overriddenFacts = ds.fastFacts.map((f) =>
      f.label === "Confirmed Incidents" ? { ...f, value: "99" } : f);
    expect(() => assertShippingReportConsistency(ds, board, overriddenFacts))
      .toThrow(/Confirmed Incidents headline/);
  });

  it("fails closed for route, geographic and maritime-total mismatches", () => {
    const { ds, board } = build();
    expect(() => assertShippingReportConsistency({
      ...ds,
      chokepointRows: ds.chokepointRows.map((r, index) =>
        index === 0 ? { ...r, count: r.count + 1 } : r),
    }, board)).toThrow(/chokepoint/);
    expect(() => assertShippingReportConsistency({
      ...ds,
      regionRows: ds.regionRows.map((r, index) =>
        index === 0 ? { ...r, value: r.value + 1 } : r),
    }, board)).toThrow(/regional row/);
    expect(() => assertShippingReportConsistency(ds, {
      ...board,
      incidentSnapshot: { ...board.incidentSnapshot, total: 99 },
    })).toThrow(/maritime confirmed total/);
  });
});