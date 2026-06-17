import { classifySeverity, maxSeverity, severityFromFatalities } from "@workspace/ingest";

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

  // Reaction guard: an advocacy / statement headline that REFERENCES a prior
  // killing must not read Extreme — the casualty word is a reference, not a
  // fresh attack. This is the exact live mis-rating that was reported.
  it("does not rate a demand/justice advocacy headline as extreme", () => {
    expect(
      classifySeverity(
        "Zeliangrong Intellectual Group Demands Ban on Kuki Militant Groups, Seeks Justice for Six Slain Nagas",
        "",
        "conflict",
      ),
    ).toBe("low");
  });

  it("does not escalate a 'condemns the killing' reaction headline", () => {
    expect(classifySeverity("Civil society condemns killing of activist", "", "flashpoint")).toBe(
      "low",
    );
  });

  it("does not escalate a 'seeks justice for slain' reaction headline", () => {
    expect(classifySeverity("Villagers seek justice for slain farmer", "", "conflict")).toBe("low");
  });

  // A fresh attack that merely ENDS with a reaction is still the attack.
  it("still rates a fresh armed attack that ends with a reaction as high", () => {
    expect(
      classifySeverity(
        "Three youths injured in armed attack in Manipur, mob protests treatment",
        "",
        "conflict",
      ),
    ).toBe("high");
  });

  // A genuine fresh deadly event is never softened by the guard.
  it("still rates a fresh deadly clash as extreme", () => {
    expect(classifySeverity("Protest turns deadly, dozens killed", "", "conflict")).toBe("extreme");
  });

  // The guard is scoped to civil-unrest / conflict — a reaction-framed deadly
  // maritime attack keeps its escalation (it is likely the only record).
  it("does not apply the reaction guard to commodity/maritime topics", () => {
    expect(
      classifySeverity("Union condemns missile strike that killed two crew", "", "shipping"),
    ).toBe("extreme");
  });

  // Invariant the one-time severity heal relies on: a reaction-led headline
  // text-rates Low, but a structured GDELT fatality count floors it back to
  // Extreme — so a confirmed-fatality row is NEVER downgraded by the migration.
  it("fatality floor keeps a reaction-led headline with confirmed deaths at extreme", () => {
    const text = classifySeverity("Villagers seek justice for slain farmer", "", "conflict");
    expect(text).toBe("low");
    const floored = maxSeverity(text, severityFromFatalities(2)!);
    expect(floored).toBe("extreme");
  });
});
