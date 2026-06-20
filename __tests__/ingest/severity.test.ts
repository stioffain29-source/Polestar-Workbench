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

  // A confirmed fatality overrides the mild fuel topic default, but a single /
  // unspecified toll reads High — Extreme is reserved for a mass-casualty count.
  it("rates a confirmed-fatality incident above the topic default", () => {
    expect(classifySeverity("Refinery fire killed workers", "", "fuel")).toBe("high");
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
  // maritime attack keeps its escalation (it is likely the only record). The
  // confirmed killing reads High; Extreme stays reserved for a mass-casualty toll.
  it("does not apply the reaction guard to commodity/maritime topics", () => {
    expect(
      classifySeverity("Union condemns missile strike that killed two crew", "", "shipping"),
    ).toBe("high");
  });

  // Invariant the one-time severity heal relies on: a reaction-led headline
  // text-rates Low, but a structured fatality count floors it back up — so a
  // confirmed-fatality row is NEVER downgraded by the migration. A single / low
  // toll floors to High; only a mass-casualty count (>= MASS_FATALITY_THRESHOLD)
  // floors to the reserved Extreme tier.
  it("fatality floor lifts a reaction-led headline to at least high", () => {
    const text = classifySeverity("Villagers seek justice for slain farmer", "", "conflict");
    expect(text).toBe("low");
    expect(maxSeverity(text, severityFromFatalities(2)!)).toBe("high");
    expect(maxSeverity(text, severityFromFatalities(8)!)).toBe("extreme");
  });

  // A confirmed killing by a security force is the under-rating that was
  // reported ("killed in military op" reading low) — it must lift to High.
  it("rates a confirmed security-force killing as high", () => {
    expect(
      classifySeverity("Militant killed by security forces in Chhattisgarh encounter", "", "conflict"),
    ).toBe("high");
  });

  // Year guard: a 4-digit dateline year must never be read as a mass body count.
  // A court-process headline citing a 2-fatality shootout reads High, not Extreme.
  it("does not read a dateline year as a mass-casualty count", () => {
    expect(
      classifySeverity(
        "Ambush or self defense? Trial begins in 2025 Lorain shootout that killed 2",
        "",
        "conflict",
      ),
    ).toBe("high");
  });

  // The year guard must not suppress a genuine mass toll alongside a year.
  it("keeps a genuine mass toll Extreme even next to a year", () => {
    expect(
      classifySeverity(
        "Anniversary of 2019 Pulwama attack that killed 40 marked in Kashmir",
        "",
        "conflict",
      ),
    ).toBe("extreme");
  });
});
