import { classifySeverity } from "@workspace/ingest";

describe("classifySeverity", () => {
  it("rates cargo pilferage as low", () => {
    expect(classifySeverity("Minor pilferage at depot", "", "cargo_watch")).toBe("low");
  });

  it("rates substantive cargo theft as moderate", () => {
    expect(classifySeverity("Cargo stolen from warehouse", "", "cargo_watch")).toBe("moderate");
  });

  it("rates mass-casualty language as extreme", () => {
    expect(classifySeverity("Protest turns deadly, dozens killed", "", "flashpoint")).toBe("extreme");
  });

  it("rates forward-looking protest calls as insignificant", () => {
    expect(classifySeverity("Union plans to strike next week", "", "flashpoint")).toBe("insignificant");
  });

  it("rates shipping kinetic strikes as high", () => {
    expect(classifySeverity("Vessel struck by missile off coast", "", "shipping")).toBe("high");
  });

  it("rates shipping seizures as moderate", () => {
    expect(classifySeverity("Tanker seized by naval forces", "", "shipping")).toBe("moderate");
  });

  it("rates energy grid outages as moderate", () => {
    expect(classifySeverity("Nationwide blackout hits major cities", "", "energy")).toBe("moderate");
  });

  it("rates fuel shortages as moderate", () => {
    expect(classifySeverity("Fuel shortage forces rationing at pumps", "", "fuel")).toBe("moderate");
  });

  it("rates fertiliser supply crises as moderate", () => {
    expect(classifySeverity("Fertiliser shortage sparks supply crisis", "", "fertiliser")).toBe(
      "moderate",
    );
  });

  it("prefers extreme tier over topic defaults", () => {
    expect(classifySeverity("Refinery fire killed workers", "", "fuel")).toBe("extreme");
  });
});
