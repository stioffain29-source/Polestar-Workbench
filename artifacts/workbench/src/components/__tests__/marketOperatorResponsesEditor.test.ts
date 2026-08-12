// Acceptance behaviors for the compact Market and Operator Responses editor:
// prepopulation from the rendered (effective) values, sparse save (a field
// equal to the generated value is NOT stored, so it keeps following auto
// text), and per-row restore that preserves the include state.

import {
  effectiveFields,
  toOverride,
} from "../MarketOperatorResponsesEditor";
import type { ProducerBuyerActionRow } from "@/lib/fuelNarratives";

const row: ProducerBuyerActionRow = {
  actor: "ADNOC",
  category: "Producer action",
  action: "Pipeline bypassing Hormuz 50% complete",
  operationalRead: "Reduces chokepoint exposure for UAE exports.",
  date: "3 Aug",
};

describe("MarketOperatorResponsesEditor helpers", () => {
  it("prepopulates with generated values when no override is saved", () => {
    expect(effectiveFields(row, {})).toEqual({
      actor: "ADNOC",
      category: "Producer action",
      date: "3 Aug",
      action: "Pipeline bypassing Hormuz 50% complete",
      read: "Reduces chokepoint exposure for UAE exports.",
    });
  });

  it("prepopulates with saved override values where they exist", () => {
    const eff = effectiveFields(row, { category: "Market / supply signal" });
    expect(eff.category).toBe("Market / supply signal");
    expect(eff.actor).toBe("ADNOC"); // untouched fields stay generated
  });

  it("saving one changed field stores ONLY that field (others keep following auto)", () => {
    const draft = { ...effectiveFields(row, {}), category: "Market / supply signal" };
    expect(toOverride(row, draft, undefined)).toEqual({
      category: "Market / supply signal",
    });
  });

  it("saving with no changes stores nothing (fields keep tracking regenerated text)", () => {
    expect(toOverride(row, effectiveFields(row, {}), undefined)).toEqual({});
  });

  it("preserves the exclude state through a save", () => {
    expect(toOverride(row, effectiveFields(row, {}), true)).toEqual({
      suppressed: true,
    });
  });
});
