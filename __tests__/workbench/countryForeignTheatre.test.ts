import { isForeignTheatreContext } from "../../artifacts/workbench/src/lib/countryMatch";

// The aggressive cross-country filter strips a record anchored to a named
// foreign maritime theatre from a report whose country is not a member of that
// theatre. The live case: the Strait of Hormuz / Persian Gulf war is
// cross-tagged onto every nationality it names, so a South-Korean-flagged
// tanker attacked in Hormuz must NOT populate the South Korea report — it
// happened in the Gulf — but the UAE / Iran reports keep it. Mention-count and
// tag-order both fail (the peripheral country is named most and listed first);
// the reliable signal is the named geography.

const SK_VESSEL =
  "Gov't verifying report of possible attack on S. Korean vessel in Strait of Hormuz; Seoul weighs response";
const INDIA_FUJAIRAH = "India Condemns Iran Attack on Fujairah as Oil Prices Surge";
const INDIA_DOMESTIC =
  "Petrol, diesel prices today: How much does fuel refill cost in Delhi, Mumbai, Kolkata, Bengaluru";

describe("isForeignTheatreContext", () => {
  it("strips a Hormuz vessel story from the South Korea report (happened in the Gulf)", () => {
    expect(isForeignTheatreContext(SK_VESSEL, "South Korea")).toBe(true);
  });

  it("keeps the same Hormuz story in a Gulf-littoral report (United Arab Emirates)", () => {
    expect(isForeignTheatreContext(SK_VESSEL, "United Arab Emirates")).toBe(false);
  });

  it("keeps the same Hormuz story in the Iran report", () => {
    expect(isForeignTheatreContext(SK_VESSEL, "Iran")).toBe(false);
  });

  it("strips a Fujairah strike story from the India report", () => {
    expect(isForeignTheatreContext(INDIA_FUJAIRAH, "India")).toBe(true);
  });

  it("keeps a genuinely domestic story that names no foreign theatre", () => {
    expect(isForeignTheatreContext(INDIA_DOMESTIC, "India")).toBe(false);
  });

  it("recognises the bare 'UAE' alias as a Gulf member (folds in the raw report key)", () => {
    expect(isForeignTheatreContext(SK_VESSEL, "UAE")).toBe(false);
  });

  it("keeps the Hormuz story in the Oman report (Gulf-littoral member)", () => {
    expect(isForeignTheatreContext(SK_VESSEL, "Oman")).toBe(false);
  });

  it("strips a Gulf of Aden / Bab-el-Mandeb story from a non-littoral report", () => {
    const aden =
      "Houthi drones target merchant shipping in the Gulf of Aden near Bab-el-Mandeb";
    expect(isForeignTheatreContext(aden, "South Korea")).toBe(true);
    // ...but keeps it for an Aden/Mandeb littoral state's own report.
    expect(isForeignTheatreContext(aden, "Somalia")).toBe(false);
    expect(isForeignTheatreContext(aden, "Djibouti")).toBe(false);
    expect(isForeignTheatreContext(aden, "Yemen")).toBe(false);
  });

  it("never fires on empty narrative", () => {
    expect(isForeignTheatreContext("", "South Korea")).toBe(false);
    expect(isForeignTheatreContext(null, "South Korea")).toBe(false);
  });
});
